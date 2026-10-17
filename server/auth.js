const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const { SESSION_DAYS } = require('./config');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'pi_session';
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, now, now + SESSION_MS);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_MS,
    path: '/',
  });
}

function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

function currentSessionHash(req) {
  const token = readCookie(req, COOKIE);
  return token ? sha256(token) : null;
}

// Attaches req.user when the session cookie is valid.
function loadUser(req, _res, next) {
  const hash = currentSessionHash(req);
  if (hash) {
    const row = db.prepare(`
      SELECT u.id, u.username, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(hash, Date.now());
    if (row) req.user = row;
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in' });
  next();
}

// Small in-memory limiter for failed sign-ins: 10 failures per IP per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW_MS) return false;
  return f.count >= 10;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(ip, { first: Date.now(), count: 1 });
  else f.count++;
}
const clearFailures = ip => failures.delete(ip);
setInterval(() => {
  for (const [ip, f] of failures) if (Date.now() - f.first > WINDOW_MS) failures.delete(ip);
}, WINDOW_MS).unref();

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  currentSessionHash,
  loadUser,
  requireUser,
  tooManyFailures,
  recordFailure,
  clearFailures,
};
