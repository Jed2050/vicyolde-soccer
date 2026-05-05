'use strict';
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const cron    = require('node-cron');

// Init DB (creates file + seeds admin on first run)
const db = require('./db');
const { router: newsRouter, fetchLiverpoolNews } = require('./routes/news');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/articles', require('./routes/articles'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/news',     newsRouter);
app.use('/api/settings', require('./routes/settings'));

app.get('/api/stats', (_req, res) => {
  res.json({
    articles: db.prepare('SELECT COUNT(*) AS c FROM articles WHERE published=1').get().c,
    comments: db.prepare('SELECT COUNT(*) AS c FROM comments').get().c,
    members:  db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    news:     db.prepare('SELECT COUNT(*) AS c FROM news').get().c,
  });
});

// ── HTML pages ────────────────────────────────────────────
const pub = (f) => (_req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get('/dashboard*',    pub('dashboard/index.html'));
app.get('/article/*',    pub('article.html'));
app.get('/login',        pub('login.html'));
app.get('/admin-access', pub('admin-access.html'));
app.get('/',             pub('index.html'));

// ── Scheduled news refresh (every 6 hours) ────────────────
fetchLiverpoolNews();
cron.schedule('0 */6 * * *', fetchLiverpoolNews);

app.listen(PORT, () => {
  console.log(`\n⚽  VICYOLDE SOCCER Blog  →  http://localhost:${PORT}`);
  console.log(`📊  Admin Dashboard       →  http://localhost:${PORT}/dashboard`);
  console.log(`🔄  News auto-refresh every 6 hours\n`);
});
