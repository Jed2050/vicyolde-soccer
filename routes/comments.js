'use strict';
const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');

const J = `SELECT c.*,u.username,u.role FROM comments c JOIN users u ON c.user_id=u.id`;

function getReactions(cid) {
  return db.prepare('SELECT emoji,COUNT(*) AS count FROM reactions WHERE comment_id=? GROUP BY emoji').all(cid);
}

// List comments for an article
router.get('/:articleId', (req, res) => {
  const tops = db.prepare(`${J} WHERE c.article_id=? AND c.parent_id IS NULL ORDER BY c.created_at DESC`)
    .all(req.params.articleId);
  res.json(tops.map(c => ({
    ...c,
    reactions: getReactions(c.id),
    replies: db.prepare(`${J} WHERE c.parent_id=? ORDER BY c.created_at ASC`).all(c.id)
      .map(r => ({ ...r, reactions: getReactions(r.id) }))
  })));
});

// Post a comment (requires auth)
router.post('/:articleId', auth, (req, res) => {
  const { body, parent_id } = req.body || {};
  if (!body?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
  if (!db.prepare('SELECT id FROM articles WHERE id=? AND published=1').get(req.params.articleId))
    return res.status(404).json({ error: 'Article not found' });
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO comments (article_id,user_id,parent_id,body) VALUES (?,?,?,?)'
  ).run(req.params.articleId, req.user.id, parent_id||null, body.trim());
  const c = db.prepare(`${J} WHERE c.id=?`).get(lastInsertRowid);
  res.json({ ...c, replies: [], reactions: [] });
});

// Delete comment (own or admin)
router.delete('/:id', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.user_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });
  db.prepare('DELETE FROM comments WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Toggle reaction
router.post('/:commentId/react', auth, (req, res) => {
  const { emoji } = req.body || {};
  const VALID = ['🔥','🎯','💬','❤️','👏','🤔','💯','🙌','👀','❌'];
  if (!emoji || !VALID.includes(emoji))
    return res.status(400).json({ error: 'Invalid emoji' });
  const existing = db.prepare(
    'SELECT id FROM reactions WHERE comment_id=? AND user_id=? AND emoji=?'
  ).get(req.params.commentId, req.user.id, emoji);
  if (existing) {
    db.prepare('DELETE FROM reactions WHERE id=?').run(existing.id);
  } else {
    db.prepare('INSERT INTO reactions (comment_id,user_id,emoji) VALUES (?,?,?)')
      .run(req.params.commentId, req.user.id, emoji);
  }
  res.json({ reactions: getReactions(req.params.commentId), active: !existing });
});

// Admin: all recent comments
router.get('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const comments = db.prepare(
    `SELECT c.*,u.username,ar.title AS article_title,ar.slug AS article_slug
     FROM comments c
     JOIN users u ON c.user_id=u.id
     JOIN articles ar ON c.article_id=ar.id
     ORDER BY c.created_at DESC LIMIT 200`
  ).all();
  res.json(comments);
});

module.exports = router;
