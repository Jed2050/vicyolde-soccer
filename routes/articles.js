'use strict';
const router = require('express').Router();
const db     = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

function slugify(t) {
  return t.toLowerCase()
    .replace(/[àáâä]/g,'a').replace(/[èéêë]/g,'e').replace(/[ìíî]/g,'i')
    .replace(/[òóôö]/g,'o').replace(/[ùúû]/g,'u').replace(/[^a-z0-9\s-]/g,'')
    .trim().replace(/\s+/g,'-').replace(/-+/g,'-');
}

const COLS = `a.id,a.title,a.slug,a.excerpt,a.category,a.read_time,a.cover_url,
  a.published,a.featured,a.created_at,a.updated_at,
  u.username AS author_name,
  (SELECT COUNT(*) FROM comments WHERE article_id=a.id) AS comment_count`;

// Public list
router.get('/', (req, res) => {
  const { category, featured, page=1, limit=9 } = req.query;
  const off = (parseInt(page)-1)*parseInt(limit);
  const cond = ['a.published=1'];
  const params = [];
  if (category) { cond.push('a.category=?'); params.push(category); }
  if (featured==='true') { cond.push('a.featured=1'); }
  const w = cond.join(' AND ');
  const articles = db.prepare(
    `SELECT ${COLS} FROM articles a JOIN users u ON a.author_id=u.id WHERE ${w} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, parseInt(limit), off);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM articles a WHERE ${w}`).get(...params).c;
  res.json({ articles, total, page:parseInt(page), pages:Math.ceil(total/parseInt(limit)) });
});

// Admin: all articles (including drafts) — must be BEFORE /:slug
router.get('/admin', auth, adminOnly, (req, res) => {
  res.json(db.prepare(
    `SELECT ${COLS} FROM articles a JOIN users u ON a.author_id=u.id ORDER BY a.created_at DESC`
  ).all());
});

// Admin: single article by id for editing
router.get('/admin/:id', auth, adminOnly, (req, res) => {
  const a = db.prepare('SELECT * FROM articles WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

// Public: single article by slug
router.get('/:slug', (req, res) => {
  const a = db.prepare(
    `SELECT a.*,u.username AS author_name,(SELECT COUNT(*) FROM comments WHERE article_id=a.id) AS comment_count
     FROM articles a JOIN users u ON a.author_id=u.id WHERE a.slug=? AND a.published=1`
  ).get(req.params.slug);
  if (!a) return res.status(404).json({ error: 'Article not found' });
  res.json(a);
});

// Create
router.post('/', auth, adminOnly, (req, res) => {
  const { title, excerpt, content, category, read_time, cover_url, published, featured } = req.body || {};
  if (!title?.trim() || !content?.trim())
    return res.status(400).json({ error: 'Title and content are required' });
  let slug = slugify(title);
  if (db.prepare('SELECT id FROM articles WHERE slug=?').get(slug))
    slug = `${slug}-${Date.now()}`;
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO articles (title,slug,excerpt,content,category,read_time,cover_url,author_id,published,featured)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(title.trim(), slug, excerpt||'', content.trim(), category||'ANALYSIS',
        read_time||5, cover_url||'', req.user.id, published?1:0, featured?1:0);
  res.json(db.prepare('SELECT * FROM articles WHERE id=?').get(lastInsertRowid));
});

// Update
router.put('/:id', auth, adminOnly, (req, res) => {
  const { title, excerpt, content, category, read_time, cover_url, published, featured } = req.body || {};
  db.prepare(
    `UPDATE articles SET title=?,excerpt=?,content=?,category=?,read_time=?,cover_url=?,
     published=?,featured=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).run(title, excerpt||'', content, category||'ANALYSIS', read_time||5, cover_url||'',
        published?1:0, featured?1:0, req.params.id);
  res.json(db.prepare('SELECT * FROM articles WHERE id=?').get(req.params.id));
});

// Delete
router.delete('/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM articles WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
