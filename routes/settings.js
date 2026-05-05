'use strict';
const router = require('express').Router();
const db     = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { generateOne, getApiKey } = require('../ai-writer');

// GET all settings (admin only)
router.get('/', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out  = {};
  for (const r of rows) out[r.key] = r.key === 'anthropic_api_key' ? (r.value ? '••••••••' : '') : r.value;
  res.json(out);
});

// PUT update one or many settings
router.put('/', auth, adminOnly, (req, res) => {
  const allowed = ['anthropic_api_key','auto_generate','max_per_refresh','auto_publish'];
  const updates = req.body || {};
  for (const key of allowed) {
    if (key in updates) {
      db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, String(updates[key]));
    }
  }
  res.json({ success: true });
});

// GET: check whether API key is set (without exposing it)
router.get('/ai-status', auth, adminOnly, (req, res) => {
  const hasKey = !!getApiKey();
  const rows   = db.prepare('SELECT key,value FROM settings WHERE key IN (?,?,?)').all('auto_generate','max_per_refresh','auto_publish');
  const cfg    = {};
  for (const r of rows) cfg[r.key] = r.value;
  res.json({ hasKey, ...cfg });
});

// POST: generate article from a single news item
router.post('/generate-one/:newsId', auth, adminOnly, async (req, res) => {
  try {
    const article = await generateOne(req.params.newsId);
    res.json({ success: true, article });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: list news items not yet converted, latest first
router.get('/pending-news', auth, adminOnly, (req, res) => {
  const items = db.prepare(
    'SELECT id,title,source,pub_date,image_url FROM news WHERE article_generated=0 ORDER BY pub_date DESC LIMIT 30'
  ).all();
  res.json(items);
});

// GET: list recently auto-generated articles
router.get('/generated-articles', auth, adminOnly, (req, res) => {
  const items = db.prepare(
    `SELECT a.id,a.title,a.slug,a.published,a.created_at,u.username AS author
     FROM articles a JOIN users u ON a.author_id=u.id
     ORDER BY a.created_at DESC LIMIT 20`
  ).all();
  res.json(items);
});

module.exports = router;
