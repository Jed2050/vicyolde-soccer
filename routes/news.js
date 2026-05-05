'use strict';
const router = require('express').Router();
const Parser = require('rss-parser');
const db     = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

const rss = new Parser({
  timeout: 12000,
  headers: { 'User-Agent': 'VICYOLDE-SOCCER-Blog/2.0' },
  customFields: { item: [['media:content','mediaContent'],['media:thumbnail','mediaThumbnail']] }
});

const FEEDS = [
  { url: 'https://feeds.bbci.co.uk/sport/football/teams/liverpool/rss.xml',         name: 'BBC Sport' },
  { url: 'https://www.liverpoolecho.co.uk/sport/football/football-news/rss.xml',    name: 'Liverpool Echo' },
  { url: 'https://www.thisisanfield.com/feed/',                                      name: 'This Is Anfield' },
  { url: 'https://www.anfieldwatch.co.uk/feed/',                                     name: 'Anfield Watch' },
];

async function fetchLiverpoolNews() {
  console.log('[News] Refreshing Liverpool news feeds…');
  for (const feed of FEEDS) {
    try {
      const parsed = await rss.parseURL(feed.url);
      for (const item of (parsed.items || []).slice(0, 15)) {
        const img = item.enclosure?.url
          || item.mediaContent?.$.url
          || item.mediaThumbnail?.$.url
          || '';
        try {
          db.prepare(
            `INSERT OR IGNORE INTO news (title,link,description,source,image_url,pub_date) VALUES (?,?,?,?,?,?)`
          ).run(
            (item.title || '').trim().slice(0, 250),
            (item.link  || '').trim(),
            (item.contentSnippet || item.summary || '').slice(0, 500),
            feed.name,
            img,
            item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
          );
        } catch { /* duplicate link — skip */ }
      }
    } catch (e) {
      console.log(`[News] ⚠  ${feed.name}: ${e.message}`);
    }
  }
  // Keep only 80 most recent
  db.prepare(`DELETE FROM news WHERE id NOT IN (SELECT id FROM news ORDER BY pub_date DESC LIMIT 80)`).run();
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM news').get();
  console.log(`[News] Done — ${c} items in database.`);

  // Trigger AI article generation for new items (non-blocking)
  setImmediate(async () => {
    try {
      const { autoGenerateArticles } = require('../ai-writer');
      await autoGenerateArticles();
    } catch (e) {
      console.log('[AI] Error during auto-generate:', e.message);
    }
  });
}

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || 12), 50);
  res.json(db.prepare('SELECT * FROM news ORDER BY pub_date DESC LIMIT ?').all(limit));
});

router.post('/refresh', auth, adminOnly, async (req, res) => {
  await fetchLiverpoolNews();
  const count   = db.prepare('SELECT COUNT(*) AS c FROM news').get().c;
  const pending = db.prepare('SELECT COUNT(*) AS c FROM news WHERE article_generated=0').get().c;
  res.json({ success: true, count, pending });
});

module.exports = { router, fetchLiverpoolNews };
