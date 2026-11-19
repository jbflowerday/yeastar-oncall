'use strict';

/**
 * Every CHECK_INTERVAL_SECONDS: work out which changeover is in effect and,
 * if it differs from what was last pushed to the PBX, update the inbound route.
 *
 * - target 'mobile'  -> route destination = external number
 * - target 'default' -> route destination restored from the snapshot taken
 *                       just before we first redirected it
 */

const { db, getSetting, setSetting, audit } = require('./db');
const config = require('./config');
const yeastar = require('./yeastar');

let running = false;

const routeId = () => getSetting('route_id', config.yeastar.defaultRouteId || '') || '';

function activeChangeover(now = Date.now()) {
  return db.prepare(`
    SELECT c.*, u.display_name AS user_name, u.username AS user_username
    FROM changeovers c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.start_at <= ? ORDER BY c.start_at DESC, c.id DESC LIMIT 1`).get(now) || null;
}

function desiredState(now = Date.now()) {
  const c = activeChangeover(now);
  if (!c || c.target === 'default') return { target: 'default', mobile: '', changeover_id: c?.id ?? null };
  return { target: 'mobile', mobile: c.mobile, changeover_id: c.id };
}

async function ensureSnapshot(rid) {
  const snap = getSetting('snapshot');
  if (snap && snap.route_id === rid) return snap;
  const route = await yeastar.getInboundRoute(rid);
  const fields = yeastar.destinationSnapshot(route);
  const warning = fields[config.yeastar.destField] === config.yeastar.externalDestType
    ? 'Route already pointed at an external number when the snapshot was taken' : null;
  const fresh = { route_id: rid, route_name: route?.name || '', fields, captured_at: Date.now(), warning };
  setSetting('snapshot', fresh);
  audit(null, 'snapshot.captured', fresh);
  return fresh;
}

async function recaptureSnapshot() {
  setSetting('snapshot', null);
  const rid = routeId();
  if (!rid) throw new Error('No inbound route selected');
  return ensureSnapshot(rid);
}

/**
 * @param {{force?: boolean, actor?: number}} opts
 */
async function tick({ force = false, actor = null } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    const rid = routeId();
    const want = desiredState();
    const applied = getSetting('applied');
    const same = applied && applied.route_id === rid && applied.target === want.target && applied.mobile === want.mobile;
    if (same && !force) return { changed: false };

    if (!rid) throw new Error('No inbound route selected (Settings → Inbound route)');

    let fields;
    if (want.target === 'mobile') {
      await ensureSnapshot(rid);
      fields = yeastar.externalDestinationFields(want.mobile);
    } else {
      const snap = getSetting('snapshot');
      if (!snap || snap.route_id !== rid) {
        // We never redirected this route, so there is nothing to restore.
        setSetting('applied', { route_id: rid, ...want, at: Date.now(), note: 'no snapshot – left unchanged' });
        setSetting('last_error', null);
        return { changed: false };
      }
      fields = snap.fields;
    }

    await yeastar.updateInboundRoute(rid, fields);
    setSetting('applied', { route_id: rid, ...want, at: Date.now(), dry_run: config.yeastar.dryRun });
    setSetting('last_error', null);
    const msg = want.target === 'mobile' ? `forwarding to ${want.mobile}` : 'restored normal routing';
    console.log(`[scheduler] route ${rid}: ${msg}`);
    audit(actor, 'route.updated', { route_id: rid, ...want, fields });
    return { changed: true };
  } catch (err) {
    const prev = getSetting('last_error');
    setSetting('last_error', { message: err.message, at: Date.now() });
    if (!prev || prev.message !== err.message) {
      console.error(`[scheduler] ${err.message}`);
      audit(actor, 'route.error', err.message);
    }
    if (force) throw err;
    return { error: err.message };
  } finally {
    running = false;
    setSetting('last_check', Date.now());
  }
}

function start() {
  const run = () => tick().catch(() => {});
  setTimeout(run, 2000);
  setInterval(run, config.checkIntervalSec * 1000);
}

module.exports = { start, tick, activeChangeover, desiredState, routeId, recaptureSnapshot };
