'use strict';
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { auth, SECRET } = require('../middleware/auth');

const PUB = 'id,username,email,role,bio,created_at';

router.post('/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username?.trim() || !email?.trim() || !password)
    return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (username,email,password_hash) VALUES (?,?,?)')
      .run(username.trim(), email.trim().toLowerCase(), hash);
    const user  = db.prepare(`SELECT ${PUB} FROM users WHERE id=?`).get(lastInsertRowid);
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: '30d' });
    res.json({ token, user });
  } catch {
    res.status(409).json({ error: 'Username or email already taken' });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });
  const row = db.prepare('SELECT * FROM users WHERE username=? OR email=?')
    .get(username, username.toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });
  const token = jwt.sign({ id: row.id, username: row.username, role: row.role }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: db.prepare(`SELECT ${PUB} FROM users WHERE id=?`).get(row.id) });
});

router.get('/me', auth, (req, res) => {
  res.json(db.prepare(`SELECT ${PUB} FROM users WHERE id=?`).get(req.user.id));
});

router.put('/password', auth, (req, res) => {
  const { current, newPassword } = req.body || {};
  if (!current || !newPassword) return res.status(400).json({ error: 'Both fields required' });
  if (newPassword.length < 6)   return res.status(400).json({ error: 'Min 6 characters' });
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(current, row.password_hash))
    return res.status(401).json({ error: 'Current password incorrect' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?')
    .run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ success: true });
});

// Admin: list all members
router.get('/members', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(db.prepare(`SELECT ${PUB} FROM users ORDER BY created_at DESC`).all());
});

// Admin: delete member
router.delete('/members/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
