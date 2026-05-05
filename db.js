'use strict';
// Uses Node.js built-in sqlite (stable in Node 22+, no compilation needed)
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path   = require('path');

const db = new DatabaseSync(path.join(__dirname, 'blog.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
    email         TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member',
    bio           TEXT NOT NULL DEFAULT '',
    created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS articles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    slug       TEXT UNIQUE NOT NULL,
    excerpt    TEXT NOT NULL DEFAULT '',
    content    TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT 'ANALYSIS',
    read_time  INTEGER NOT NULL DEFAULT 5,
    cover_url  TEXT NOT NULL DEFAULT '',
    author_id  INTEGER NOT NULL REFERENCES users(id),
    published  INTEGER NOT NULL DEFAULT 0,
    featured   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    parent_id  INTEGER          REFERENCES comments(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    emoji      TEXT NOT NULL,
    UNIQUE(comment_id, user_id, emoji)
  );

  CREATE TABLE IF NOT EXISTS news (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT NOT NULL,
    link             TEXT UNIQUE NOT NULL,
    description      TEXT DEFAULT '',
    source           TEXT DEFAULT '',
    image_url        TEXT DEFAULT '',
    pub_date         TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    fetched_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    article_generated INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`);

// Migrations for existing databases (safe to run every time)
try { db.exec('ALTER TABLE news ADD COLUMN article_generated INTEGER NOT NULL DEFAULT 0'); } catch {}

// Default settings
const defaultSettings = {
  anthropic_api_key: '',
  auto_generate:     '0',
  max_per_refresh:   '3',
  auto_publish:      '1',
};
for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(key, value);
}

// Normalize lastInsertRowid to plain Number (node:sqlite returns BigInt)
const _prep = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = _prep(sql);
  const _run = stmt.run.bind(stmt);
  stmt.run = (...args) => {
    const r = _run(...args);
    return { ...r, lastInsertRowid: Number(r.lastInsertRowid) };
  };
  return stmt;
};

// Seed admin on first run
if (!db.prepare('SELECT id FROM users WHERE role=?').get('admin')) {
  const password = 'Vicyolde2026!';
  db.prepare('INSERT INTO users (username,email,password_hash,role) VALUES (?,?,?,?)')
    .run('VICYOLDE', 'emmanueldesronvil@gmail.com', bcrypt.hashSync(password, 10), 'admin');
  console.log('\n══════════════════════════════════════════════');
  console.log('  ADMIN ACCOUNT CREATED — FIRST TIME SETUP');
  console.log('  Username : VICYOLDE');
  console.log('  Password : ' + password);
  console.log('  → Change your password in the Dashboard!');
  console.log('══════════════════════════════════════════════\n');
}

module.exports = db;
