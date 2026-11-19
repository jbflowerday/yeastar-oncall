'use strict';

const express = require('express');
const { db, getSetting, setSetting, audit } = require('./db');
const auth = require('./auth');
const config = require('./config');
const yeastar = require('./yeastar');
const scheduler = require('./scheduler');

const router = express.Router();
const { requireAuth, requireAdmin } = auth;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const normaliseMobile = (s) => String(s || '').replace(/[\s\-().]/g, '');
const validMobile = (s) => /^\+?\d{6,20}$/.test(s);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

/* ------------------------------------------------------------------ auth */

router.post('/login', (req, res) => {
  const username = str(req.body?.username, 64);
  const password = String(req.body?.password || '');
  const key = `${req.ip}|${username.toLowerCase()}`;
  if (auth.loginThrottled(key)) return bad(res, 'Too many attempts. Try again in a few minutes.', 429);

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    auth.recordFailure(key);
    return bad(res, 'Invalid username or password', 401);
  }
  auth.clearFailures(key);
  auth.createSession(res, user.id);
  audit(user.id, 'login');
  res.json({ user: auth.publicUser(user) });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: auth.publicUser(req.user) }));

router.put('/me', requireAuth, (req, res) => {
  const u = req.user;
  const display_name = req.body.display_name !== undefined ? str(req.body.display_name, 80) : u.display_name;
  const mobile = req.body.mobile !== undefined ? normaliseMobile(req.body.mobile) : u.mobile;
  if (mobile && !validMobile(mobile)) return bad(res, 'Mobile number looks invalid');

  if (req.body.new_password) {
    if (!auth.verifyPassword(String(req.body.current_password || ''), u.password_hash)) {
      return bad(res, 'Current password is incorrect');
    }
    if (String(req.body.new_password).length < 8) return bad(res, 'New password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(req.body.new_password)), u.id);
    auth.destroyUserSessions(u.id, req);
    audit(u.id, 'password.changed');
  }
  db.prepare('UPDATE users SET display_name = ?, mobile = ? WHERE id = ?').run(display_name, mobile, u.id);
  res.json({ user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

/* --------------------------------------------------------------- status */

router.get('/status', requireAuth, (req, res) => {
  const active = scheduler.activeChangeover();
  const next = db.prepare(`
    SELECT c.*, u.display_name AS user_name FROM changeovers c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.start_at > ? ORDER BY c.start_at ASC, c.id ASC LIMIT 1`).get(Date.now()) || null;
  const snap = getSetting('snapshot');
  res.json({
    now: Date.now(),
    active,
    next,
    applied: getSetting('applied'),
    last_error: getSetting('last_error'),
    last_check: getSetting('last_check'),
    route_id: scheduler.routeId(),
    route_name: snap?.route_id === scheduler.routeId() ? snap.route_name : null,
    configured: yeastar.isConfigured(),
    dry_run: config.yeastar.dryRun,
  });
});

/* ----------------------------------------------------------- changeovers */

const changeoverSelect = `
  SELECT c.*, u.display_name AS user_name, u.username AS user_username, cb.display_name AS created_by_name
  FROM changeovers c
  LEFT JOIN users u ON u.id = c.user_id
  LEFT JOIN users cb ON cb.id = c.created_by`;

router.get('/changeovers', requireAuth, (req, res) => {
  const now = Date.now();
  const active = scheduler.activeChangeover(now);
  const upcoming = db.prepare(`${changeoverSelect} WHERE c.start_at > ? ORDER BY c.start_at ASC, c.id ASC LIMIT 500`).all(now);
  const past = db.prepare(`${changeoverSelect} WHERE c.start_at <= ? ${active ? 'AND c.id != ?' : ''}
    ORDER BY c.start_at DESC, c.id DESC LIMIT 20`).all(...(active ? [now, active.id] : [now]));
  const activeFull = active ? db.prepare(`${changeoverSelect} WHERE c.id = ?`).get(active.id) : null;
  res.json({ active: activeFull, upcoming, past });
});

function parseChangeover(body, me) {
  const startAt = body.start_at === 'now' ? Date.now() : Date.parse(body.start_at);
  if (!Number.isFinite(startAt)) return { error: 'Start date/time is required' };
  if (startAt < Date.now() - 5 * 60 * 1000) return { error: 'Start time cannot be in the past' };

  const target = body.target === 'default' ? 'default' : 'mobile';
  let userId = body.user_id ? Number(body.user_id) : me.id;
  if (target === 'default') userId = null;
  if (userId && userId !== me.id && !me.is_admin) return { error: 'Only admins can schedule other users' };

  let user = null;
  if (userId) {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return { error: 'User not found' };
  }

  let mobile = '';
  if (target === 'mobile') {
    mobile = normaliseMobile(body.mobile || user?.mobile);
    if (!mobile) return { error: 'A mobile number is required (or set one on the user profile)' };
    if (!validMobile(mobile)) return { error: 'Mobile number looks invalid' };
  }
  return { start_at: startAt, target, mobile, user_id: userId, note: str(body.note, 200) };
}

const canEdit = (me, c) => me.is_admin || c.created_by === me.id || c.user_id === me.id;

router.post('/changeovers', requireAuth, wrap(async (req, res) => {
  const v = parseChangeover(req.body || {}, req.user);
  if (v.error) return bad(res, v.error);
  const r = db.prepare(`INSERT INTO changeovers (start_at, target, mobile, user_id, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(v.start_at, v.target, v.mobile, v.user_id, v.note, req.user.id, Date.now());
  audit(req.user.id, 'changeover.created', { id: Number(r.lastInsertRowid), ...v });
  scheduler.tick().catch(() => {});
  res.status(201).json({ changeover: db.prepare(`${changeoverSelect} WHERE c.id = ?`).get(r.lastInsertRowid) });
}));

router.put('/changeovers/:id', requireAuth, wrap(async (req, res) => {
  const c = db.prepare('SELECT * FROM changeovers WHERE id = ?').get(req.params.id);
  if (!c) return bad(res, 'Not found', 404);
  if (!canEdit(req.user, c)) return bad(res, 'Not allowed', 403);
  if (c.start_at <= Date.now() && !req.user.is_admin) return bad(res, 'This changeover has already started');
  const v = parseChangeover(req.body || {}, req.user);
  if (v.error) return bad(res, v.error);
  db.prepare('UPDATE changeovers SET start_at = ?, target = ?, mobile = ?, user_id = ?, note = ? WHERE id = ?')
    .run(v.start_at, v.target, v.mobile, v.user_id, v.note, c.id);
  audit(req.user.id, 'changeover.updated', { id: c.id, ...v });
  scheduler.tick().catch(() => {});
  res.json({ changeover: db.prepare(`${changeoverSelect} WHERE c.id = ?`).get(c.id) });
}));

router.delete('/changeovers/:id', requireAuth, wrap(async (req, res) => {
  const c = db.prepare('SELECT * FROM changeovers WHERE id = ?').get(req.params.id);
  if (!c) return bad(res, 'Not found', 404);
  if (!canEdit(req.user, c)) return bad(res, 'Not allowed', 403);
  if (c.start_at <= Date.now() && !req.user.is_admin) return bad(res, 'Only admins can delete a changeover that has started');
  db.prepare('DELETE FROM changeovers WHERE id = ?').run(c.id);
  audit(req.user.id, 'changeover.deleted', c);
  scheduler.tick().catch(() => {});
  res.json({ ok: true });
}));

/* ------------------------------------------------------------- users */

// Everyone can see the roster (to pick who is on call); admins manage it.
router.get('/users', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY display_name COLLATE NOCASE, username').all();
  res.json({ users: rows.map(auth.publicUser) });
});

router.post('/users', requireAdmin, (req, res) => {
  const username = str(req.body.username, 64);
  const password = String(req.body.password || '');
  const mobile = normaliseMobile(req.body.mobile);
  if (!/^[a-zA-Z0-9._@-]{2,64}$/.test(username)) return bad(res, 'Username: 2–64 letters, numbers, . _ @ -');
  if (password.length < 8) return bad(res, 'Password must be at least 8 characters');
  if (mobile && !validMobile(mobile)) return bad(res, 'Mobile number looks invalid');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return bad(res, 'Username already exists');
  const r = db.prepare(`INSERT INTO users (username, password_hash, display_name, mobile, is_admin, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(username, auth.hashPassword(password), str(req.body.display_name, 80) || username,
    mobile, req.body.is_admin ? 1 : 0, Date.now());
  audit(req.user.id, 'user.created', { id: Number(r.lastInsertRowid), username });
  res.status(201).json({ user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
});

router.put('/users/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return bad(res, 'Not found', 404);
  const mobile = req.body.mobile !== undefined ? normaliseMobile(req.body.mobile) : u.mobile;
  if (mobile && !validMobile(mobile)) return bad(res, 'Mobile number looks invalid');
  const isAdmin = req.body.is_admin !== undefined ? (req.body.is_admin ? 1 : 0) : u.is_admin;
  if (!isAdmin && u.is_admin && db.prepare('SELECT COUNT(*) n FROM users WHERE is_admin = 1').get().n <= 1) {
    return bad(res, 'At least one admin is required');
  }
  db.prepare('UPDATE users SET display_name = ?, mobile = ?, is_admin = ? WHERE id = ?')
    .run(req.body.display_name !== undefined ? str(req.body.display_name, 80) : u.display_name, mobile, isAdmin, u.id);
  if (req.body.password) {
    if (String(req.body.password).length < 8) return bad(res, 'Password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(req.body.password)), u.id);
    auth.destroyUserSessions(u.id, u.id === req.user.id ? req : null);
  }
  audit(req.user.id, 'user.updated', { id: u.id, username: u.username });
  res.json({ user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return bad(res, 'Not found', 404);
  if (u.id === req.user.id) return bad(res, 'You cannot delete yourself');
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  audit(req.user.id, 'user.deleted', { id: u.id, username: u.username });
  res.json({ ok: true });
});

/* ------------------------------------------------------- PBX settings */

router.get('/settings', requireAdmin, (req, res) => {
  res.json({
    route_id: scheduler.routeId(),
    snapshot: getSetting('snapshot'),
    configured: yeastar.isConfigured(),
    dry_run: config.yeastar.dryRun,
    base_url: config.yeastar.baseUrl,
    mapping: {
      dest_field: config.yeastar.destField,
      dest_value_field: config.yeastar.destValueField,
      external_dest_type: config.yeastar.externalDestType,
      number_prefix: config.yeastar.numberPrefix,
      extra_fields: config.yeastar.extraFields,
    },
    check_interval_seconds: config.checkIntervalSec,
  });
});

router.get('/yeastar/routes', requireAdmin, wrap(async (req, res) => {
  const routes = await yeastar.listInboundRoutes();
  res.json({ routes: routes.map((r) => ({ id: r.id, name: r.name, did: r.did_pattern || r.did_option || '' })) });
}));

router.put('/settings/route', requireAdmin, wrap(async (req, res) => {
  const newId = str(req.body.route_id, 40);
  const oldId = scheduler.routeId();
  if (newId === oldId) return res.json({ ok: true });

  // If we had redirected the old route, put it back before switching.
  const snap = getSetting('snapshot');
  const applied = getSetting('applied');
  if (oldId && snap?.route_id === oldId && applied?.route_id === oldId && applied.target === 'mobile') {
    await yeastar.updateInboundRoute(oldId, snap.fields);
    audit(req.user.id, 'route.restored', { route_id: oldId, fields: snap.fields });
  }
  setSetting('snapshot', null);
  setSetting('applied', null);
  setSetting('route_id', newId);
  audit(req.user.id, 'settings.route', { from: oldId, to: newId });
  scheduler.tick().catch(() => {});
  res.json({ ok: true });
}));

router.post('/settings/snapshot', requireAdmin, wrap(async (req, res) => {
  const applied = getSetting('applied');
  if (applied?.target === 'mobile') {
    return bad(res, 'Calls are currently being forwarded. Re-capture only while normal routing is active.');
  }
  const snap = await scheduler.recaptureSnapshot();
  audit(req.user.id, 'snapshot.recaptured', snap);
  res.json({ snapshot: snap });
}));

router.post('/apply', requireAdmin, wrap(async (req, res) => {
  await scheduler.tick({ force: true, actor: req.user.id });
  res.json({ ok: true, applied: getSetting('applied') });
}));

router.get('/audit', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.display_name AS user_name FROM audit a
    LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 100`).all();
  res.json({ entries: rows });
});

router.use((err, req, res, _next) => {
  console.error(`[api] ${req.method} ${req.path}: ${err.message}`);
  res.status(err instanceof yeastar.YeastarError ? 502 : 500).json({ error: err.message });
});

module.exports = router;
