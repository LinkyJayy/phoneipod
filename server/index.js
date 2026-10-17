const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');

const app = express();
app.set('trust proxy', 1); // Railway terminates TLS in front of the app
app.disable('x-powered-by');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const AUDIO_EXT = /\.(mp3|m4a|aac|mp4|wav|ogg|oga|opus|flac|webm|aiff?|caf)$/i;
const EXT_MIME = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.webm': 'audio/webm',
  '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.caf': 'audio/x-caf',
};
const ART_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const MAX_ART_BYTES = 10 * 1024 * 1024;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

// Leftovers from interrupted uploads.
for (const f of fs.readdirSync(config.TMP_DIR)) fs.rmSync(path.join(config.TMP_DIR, f), { force: true });

const userDir = userId => path.join(config.MEDIA_DIR, userId);
const removeFile = p => p && fs.promises.rm(p, { force: true }).catch(() => {});

function publicTrack(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    track: t.track,
    duration: t.duration,
    size: t.size,
    mime: t.mime,
    hasArt: !!t.art_file,
    fileName: t.file_name,
    added: t.added,
  };
}

function parsePrefs(json) {
  try { return JSON.parse(json) || {}; } catch { return {}; }
}

// ---------- Middleware ----------
app.use(express.json({ limit: '64kb' }));
app.use(auth.loadUser);

// Reject cross-site writes. Cookies are SameSite=Lax too; this is a second layer.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = new URL(origin).host;
    if (host !== req.headers.host && host !== req.headers['x-forwarded-host']) {
      return res.status(403).json({ error: 'Cross-site request blocked' });
    }
  }
  next();
});

// ---------- Health & config ----------
app.get('/api/health', (_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  res.json({ allowSignups: config.ALLOW_SIGNUPS, maxUploadMb: config.MAX_UPLOAD_MB });
});

// ---------- Auth ----------
function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3–32 letters, numbers, dots, dashes or underscores';
  }
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 200) return 'Password is too long';
  return null;
}

const userJson = (u, prefs) => ({ id: u.id, username: u.username, createdAt: u.created_at, prefs: parsePrefs(prefs) });

app.post('/api/auth/signup', async (req, res) => {
  if (!config.ALLOW_SIGNUPS) return res.status(403).json({ error: 'New accounts are disabled on this server' });
  const { username, password } = req.body || {};
  const problem = validateCredentials(username, password);
  if (problem) return res.status(400).json({ error: problem });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'That username is taken' });
  }
  const user = { id: crypto.randomUUID(), username, created_at: Date.now() };
  const hash = await auth.hashPassword(password);
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(user.id, user.username, hash, user.created_at);
  auth.createSession(req, res, user.id);
  res.status(201).json({ user: userJson(user, '{}') });
});

app.post('/api/auth/login', async (req, res) => {
  if (auth.tooManyFailures(req.ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const { username, password } = req.body || {};
  const row = typeof username === 'string' && db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || typeof password !== 'string' || !(await auth.verifyPassword(password, row.password_hash))) {
    auth.recordFailure(req.ip);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  auth.clearFailures(req.ip);
  auth.createSession(req, res, row.id);
  res.json({ user: userJson(row, row.prefs) });
});

app.post('/api/auth/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/me', auth.requireUser, (req, res) => {
  const { prefs } = db.prepare('SELECT prefs FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: userJson(req.user, prefs) });
});

app.post('/api/auth/password', auth.requireUser, async (req, res) => {
  const { current, next } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (typeof current !== 'string' || !(await auth.verifyPassword(current, row.password_hash))) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  const problem = validateCredentials(req.user.username, next);
  if (problem) return res.status(400).json({ error: problem });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await auth.hashPassword(next), req.user.id);
  // Sign out every other device.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, auth.currentSessionHash(req));
  res.json({ ok: true });
});

app.delete('/api/auth/account', auth.requireUser, async (req, res) => {
  const { password } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (typeof password !== 'string' || !(await auth.verifyPassword(password, row.password_hash))) {
    return res.status(401).json({ error: 'Password is wrong' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  await fs.promises.rm(userDir(req.user.id), { recursive: true, force: true });
  res.clearCookie('pi_session', { path: '/' });
  res.json({ ok: true });
});

// ---------- Preferences (theme, shuffle, repeat, volume) ----------
app.get('/api/prefs', auth.requireUser, (req, res) => {
  const { prefs } = db.prepare('SELECT prefs FROM users WHERE id = ?').get(req.user.id);
  res.json(parsePrefs(prefs));
});

app.put('/api/prefs', auth.requireUser, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid preferences' });
  const { prefs } = db.prepare('SELECT prefs FROM users WHERE id = ?').get(req.user.id);
  const merged = { ...parsePrefs(prefs) };
  for (const key of ['theme', 'settings']) if (body[key] && typeof body[key] === 'object') merged[key] = body[key];
  db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(merged), req.user.id);
  res.json(merged);
});

// ---------- Tracks ----------
const upload = multer({
  dest: config.TMP_DIR,
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 2, fields: 10 },
});

app.get('/api/tracks', auth.requireUser, (req, res) => {
  const rows = db.prepare('SELECT * FROM tracks WHERE user_id = ? ORDER BY added').all(req.user.id);
  res.json({ tracks: rows.map(publicTrack) });
});

app.post('/api/tracks', auth.requireUser, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'art', maxCount: 1 }]), async (req, res) => {
  const audio = req.files?.audio?.[0];
  const art = req.files?.art?.[0];
  const cleanup = () => Promise.all([removeFile(audio?.path), removeFile(art?.path)]);

  if (!audio) {
    await cleanup();
    return res.status(400).json({ error: 'No audio file' });
  }
  const ext = (path.extname(audio.originalname).toLowerCase().match(AUDIO_EXT) || [])[0];
  const isAudio = audio.mimetype.startsWith('audio/') || ext;
  if (!isAudio) {
    await cleanup();
    return res.status(415).json({ error: 'That is not an audio file' });
  }

  if (config.USER_QUOTA_MB) {
    const { used } = db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM tracks WHERE user_id = ?').get(req.user.id);
    if (used + audio.size > config.USER_QUOTA_MB * 1024 * 1024) {
      await cleanup();
      return res.status(413).json({ error: 'Your storage is full' });
    }
  }

  let meta = {};
  try { meta = JSON.parse(req.body.meta || '{}'); } catch { /* use defaults */ }
  const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const id = crypto.randomUUID();
  const dir = userDir(req.user.id);
  await fs.promises.mkdir(dir, { recursive: true });

  const audioExt = ext || '.audio';
  const audioFile = id + audioExt;
  await fs.promises.rename(audio.path, path.join(dir, audioFile));

  let artFile = null;
  let artMime = null;
  if (art && ART_MIME[art.mimetype] && art.size <= MAX_ART_BYTES) {
    artFile = id + ART_MIME[art.mimetype];
    artMime = art.mimetype;
    await fs.promises.rename(art.path, path.join(dir, artFile));
  } else {
    await removeFile(art?.path);
  }

  const track = {
    id,
    user_id: req.user.id,
    title: str(meta.title) || path.basename(audio.originalname, path.extname(audio.originalname)).slice(0, 300) || 'Untitled',
    artist: str(meta.artist),
    album: str(meta.album),
    track: Number.isInteger(meta.track) && meta.track > 0 ? meta.track : null,
    duration: Number.isFinite(meta.duration) && meta.duration > 0 ? meta.duration : 0,
    file: audioFile,
    mime: audio.mimetype.startsWith('audio/') ? audio.mimetype : EXT_MIME[ext] || 'application/octet-stream',
    size: audio.size,
    art_file: artFile,
    art_mime: artMime,
    file_name: audio.originalname.slice(0, 300),
    added: Date.now(),
  };
  db.prepare(`
    INSERT INTO tracks (id, user_id, title, artist, album, track, duration, file, mime, size, art_file, art_mime, file_name, added)
    VALUES (@id, @user_id, @title, @artist, @album, @track, @duration, @file, @mime, @size, @art_file, @art_mime, @file_name, @added)
  `).run(track);
  res.status(201).json({ track: publicTrack(track) });
});

function ownTrack(req, res) {
  const t = db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!t) res.status(404).json({ error: 'Track not found' });
  return t;
}

// sendFile handles Range requests, so seeking works without downloading the whole file.
app.get('/api/tracks/:id/audio', auth.requireUser, (req, res) => {
  const t = ownTrack(req, res);
  if (!t) return;
  res.type(t.mime);
  res.sendFile(path.join(userDir(req.user.id), t.file), { cacheControl: false, headers: { 'Cache-Control': 'private, max-age=86400' } });
});

app.get('/api/tracks/:id/art', auth.requireUser, (req, res) => {
  const t = ownTrack(req, res);
  if (!t) return;
  if (!t.art_file) return res.status(404).json({ error: 'No artwork' });
  res.type(t.art_mime);
  res.sendFile(path.join(userDir(req.user.id), t.art_file), { cacheControl: false, headers: { 'Cache-Control': 'private, max-age=604800' } });
});

app.delete('/api/tracks/:id', auth.requireUser, async (req, res) => {
  const t = ownTrack(req, res);
  if (!t) return;
  db.prepare('DELETE FROM tracks WHERE id = ?').run(t.id);
  const dir = userDir(req.user.id);
  await Promise.all([removeFile(path.join(dir, t.file)), t.art_file && removeFile(path.join(dir, t.art_file))]);
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Front end ----------
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, file) {
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ---------- Errors ----------
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Files must be under ${config.MAX_UPLOAD_MB} MB` : err.message;
    return res.status(status).json({ error: msg });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong' });
});

app.listen(config.PORT, () => {
  console.log(`PhoneiPod listening on port ${config.PORT}`);
  console.log(`Data directory: ${config.DATA_DIR}`);
  if (config.ON_RAILWAY && !config.HAS_VOLUME) {
    console.warn('WARNING: No Railway volume is attached. Accounts and uploaded tracks will be lost on every redeploy.');
  }
});
