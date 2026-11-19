'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');
const config = require('./config');

const COOKIE = 'oncall_sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = config.sessionDays * 86400 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + maxAge);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure === 'auto' ? req.secure : config.cookieSecure,
    maxAge,
    path: '/',
  });
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

function destroyUserSessions(userId, exceptReq) {
  const keep = exceptReq ? parseCookies(exceptReq.headers.cookie)[COOKIE] : null;
  if (keep) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(keep));
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

const publicUser = (u) => u && ({
  id: u.id,
  username: u.username,
  display_name: u.display_name,
  mobile: u.mobile,
  is_admin: !!u.is_admin,
});

/** Attaches req.user if a valid session cookie is present. */
function sessionMiddleware(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), Date.now());
    if (row) req.user = row;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

/** Basic CSRF defence on top of SameSite=Strict: mutating requests must be JSON from our own JS. */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'oncall') return res.status(403).json({ error: 'Bad request origin' });
  next();
}

// Simple in-memory login throttle: 10 failures per 15 min per IP+username.
const failures = new Map();
function loginThrottled(key) {
  const now = Date.now();
  const rec = failures.get(key);
  if (!rec || now - rec.first > 15 * 60 * 1000) return false;
  return rec.count >= 10;
}
function recordFailure(key) {
  const now = Date.now();
  const rec = failures.get(key);
  if (!rec || now - rec.first > 15 * 60 * 1000) failures.set(key, { first: now, count: 1 });
  else rec.count++;
}
const clearFailures = (key) => failures.delete(key);

function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

function ensureAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  let { username, password } = config.admin;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    generated = true;
  }
  db.prepare('INSERT INTO users (username, password_hash, display_name, is_admin, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(username, hashPassword(password), 'Administrator', Date.now());
  console.log(`[auth] created initial admin user "${username}"`);
  if (generated) console.log(`[auth] generated password: ${password}  (set ADMIN_PASSWORD to choose your own)`);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  destroyUserSessions,
  sessionMiddleware,
  requireAuth,
  requireAdmin,
  csrfGuard,
  publicUser,
  loginThrottled,
  recordFailure,
  clearFailures,
  cleanupSessions,
  ensureAdmin,
};
