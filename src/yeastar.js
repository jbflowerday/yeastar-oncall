'use strict';

/**
 * Minimal client for the Yeastar P-Series Open API.
 * Docs: https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/
 *
 *  POST {base}/openapi/v1.0/get_token        {username: client_id, password: client_secret}
 *  POST {base}/openapi/v1.0/refresh_token    {refresh_token}
 *  GET  {base}/openapi/v1.0/inbound_route/list?access_token=...
 *  GET  {base}/openapi/v1.0/inbound_route/get?id=..&access_token=...
 *  POST {base}/openapi/v1.0/inbound_route/update?access_token=...  {id, ...fields}
 *
 * The PBX requires the header "User-Agent: OpenAPI" on every request.
 */

const config = require('./config');

const y = config.yeastar;
let token = null; // { access, accessExp, refresh, refreshExp }

class YeastarError extends Error {
  constructor(message, errcode) {
    super(message);
    this.errcode = errcode;
  }
}

const isConfigured = () => !!(y.baseUrl && y.clientId && y.clientSecret);

async function rawRequest(method, endpoint, { query = {}, body } = {}) {
  if (!isConfigured()) throw new YeastarError('Yeastar API is not configured (check YEASTAR_* in .env)');
  const url = new URL(`${y.baseUrl}${y.apiPath}/${endpoint}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'OpenAPI' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new YeastarError(`Cannot reach PBX: ${err.cause?.message || err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new YeastarError(`PBX returned non-JSON response (HTTP ${res.status})`);
  }
  if (data.errcode !== 0) {
    throw new YeastarError(`PBX error ${data.errcode}: ${data.errmsg || 'unknown'}`, data.errcode);
  }
  return data;
}

async function getAccessToken() {
  const now = Date.now();
  if (token && token.accessExp - 60_000 > now) return token.access;

  let data;
  if (token && token.refreshExp - 60_000 > now) {
    try {
      data = await rawRequest('POST', 'refresh_token', { body: { refresh_token: token.refresh } });
    } catch {
      data = null;
    }
  }
  if (!data) {
    data = await rawRequest('POST', 'get_token', { body: { username: y.clientId, password: y.clientSecret } });
  }
  token = {
    access: data.access_token,
    accessExp: now + (Number(data.access_token_expire_time) || 1800) * 1000,
    refresh: data.refresh_token,
    refreshExp: now + (Number(data.refresh_token_expire_time) || 86400) * 1000,
  };
  return token.access;
}

async function call(method, endpoint, opts = {}, retried = false) {
  const access = await getAccessToken();
  try {
    return await rawRequest(method, endpoint, { ...opts, query: { ...(opts.query || {}), access_token: access } });
  } catch (err) {
    // Token rejected (e.g. PBX restarted) — get a fresh one and retry once.
    if (!retried && err.errcode && /token/i.test(err.message)) {
      token = null;
      return call(method, endpoint, opts, true);
    }
    throw err;
  }
}

// In dry-run mode without PBX credentials, return placeholder data so the UI can be tried out.
const offlineDryRun = () => y.dryRun && !isConfigured();

async function listInboundRoutes() {
  if (offlineDryRun()) return [{ id: '1', name: 'Demo inbound route (dry run)' }];
  const data = await call('GET', 'inbound_route/list', { query: { page: 1, page_size: 200 } });
  return (data.data || []).map((r) => ({ ...r, id: String(r.id), name: r.name }));
}

async function getInboundRoute(id) {
  if (offlineDryRun()) return { id, name: 'Demo inbound route (dry run)', [y.destField]: 'extension', [y.destValueField]: '1000' };
  const data = await call('GET', 'inbound_route/get', { query: { id } });
  return data.data || data;
}

async function updateInboundRoute(id, fields) {
  if (y.dryRun) {
    console.log(`[yeastar] DRY RUN inbound_route/update id=${id}`, fields);
    return { dryRun: true };
  }
  const idValue = /^\d+$/.test(String(id)) ? Number(id) : id;
  return call('POST', 'inbound_route/update', { body: { id: idValue, ...fields } });
}

/** Fields that describe the route's destination, captured so we can restore them later. */
function destinationSnapshot(route) {
  const keys = new Set([y.destField, y.destValueField, ...Object.keys(y.extraFields)]);
  const snap = {};
  for (const k of keys) if (route && route[k] !== undefined) snap[k] = route[k];
  return snap;
}

function externalDestinationFields(mobile) {
  return {
    [y.destField]: y.externalDestType,
    [y.destValueField]: `${y.numberPrefix}${mobile}`,
    ...y.extraFields,
  };
}

module.exports = {
  isConfigured,
  listInboundRoutes,
  getInboundRoute,
  updateInboundRoute,
  destinationSnapshot,
  externalDestinationFields,
  YeastarError,
};
