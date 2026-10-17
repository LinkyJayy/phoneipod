const fs = require('fs');
const Database = require('better-sqlite3');
const { DATA_DIR, MEDIA_DIR, TMP_DIR, DB_FILE } = require('./config');

for (const dir of [DATA_DIR, MEDIA_DIR, TMP_DIR]) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    prefs TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    track INTEGER,
    duration REAL NOT NULL DEFAULT 0,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    art_file TEXT,
    art_mime TEXT,
    file_name TEXT NOT NULL DEFAULT '',
    added INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tracks_user ON tracks(user_id);
`);

// Clear expired sessions on startup and once an hour.
const purge = () => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
purge();
setInterval(purge, 60 * 60 * 1000).unref();

module.exports = db;
