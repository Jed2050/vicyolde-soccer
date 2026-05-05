'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

function getApiKey() {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get('anthropic_api_key');
  return (row?.value || '').trim() || process.env.ANTHROPIC_API_KEY || '';
}

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '';
}

function slugify(t) {
  return t.toLowerCase()
    .replace(/[àáâä]/g,'a').replace(/[èéêë]/g,'e').replace(/[ìíî]/g,'i')
    .replace(/[òóôö]/g,'o').replace(/[ùúû]/g,'u').replace(/[^a-z0-9\s-]/g,'')
    .trim().replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,80);
}

function estimateReadTime(html) {
  const text = html.replace(/<[^>]+>/g,' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round(words / 200));
}

// ── Core article generator ─────────────────────────────────────────────────
async function generateArticleFromNews(newsItem) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Anthropic API key not configured. Add it in Dashboard → AI Writer.');

  const client = new Anthropic({ apiKey });

  const prompt = `You are writing for VICYOLDE SOCCER — The Kop Chronicle, a premium Liverpool FC tactical analysis blog run by analyst VICYOLDE.

Here is a Liverpool FC news item to transform into a deep tactical analysis article:

HEADLINE: ${newsItem.title}
SOURCE: ${newsItem.source}
SUMMARY: ${newsItem.description || '(No summary available)'}
ORIGINAL LINK: ${newsItem.link}

Your task: Write a complete, original tactical analysis article (600–900 words) inspired by this news. Do NOT just summarize the news — find a specific tactical or strategic angle and analyze it deeply.

Writing rules:
- Open with a strong, opinionated paragraph (no "In this article..." filler)
- Use at minimum: one <h2> sub-heading, three <p> paragraphs, one <blockquote> for a key tactical insight
- Reference specific Liverpool concepts: pressing triggers, half-spaces, vertical compactness, transitions, etc.
- Be concrete: name formations (4-3-3, 4-2-3-1), positions (right half-space, pivot), game states
- Voice: authoritative, analytical, passionate about Liverpool — like Jonathan Wilson meets a Kop obsessive
- Do NOT start sentences with "It is worth noting", "In conclusion", "Moreover", or similar filler
- Do NOT copy the source article — write original analysis inspired by the news

HTML formatting to use (return ONLY the HTML body, no doctype/html/body tags):
- <p> for paragraphs
- <h2> for section headings
- <h3> for sub-headings
- <blockquote> for a key tactical thesis statement
- <strong> for key tactical terms
- <ul><li> for lists of tactical points

Return ONLY the HTML content starting immediately with the first tag.`;

  const message = await client.messages.create({
    model:      'claude-opus-4-7',
    max_tokens: 1800,
    messages:   [{ role: 'user', content: prompt }],
  });

  const content = message.content[0]?.text?.trim() || '';
  if (!content) throw new Error('Empty response from Claude');
  return content;
}

// ── Derive a sharp article title from the news headline ────────────────────
async function generateTitle(newsItem) {
  const apiKey = getApiKey();
  if (!apiKey) return newsItem.title;

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 80,
    messages:   [{
      role: 'user',
      content: `Rewrite this Liverpool FC news headline as a sharp, analytical blog article title (max 12 words, no quotes, no colon abuse):\n${newsItem.title}\n\nReturn ONLY the title, nothing else.`
    }],
  });
  return (msg.content[0]?.text || newsItem.title).trim().replace(/^["']|["']$/g,'');
}

// ── Generate an excerpt from the article body ──────────────────────────────
function extractExcerpt(html) {
  const text = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  return text.slice(0, 220) + (text.length > 220 ? '…' : '');
}

// ── Auto-generate articles for new unprocessed news items ──────────────────
async function autoGenerateArticles() {
  const autoGenerate = getSetting('auto_generate');
  if (autoGenerate !== '1') return;

  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('[AI] Auto-generate skipped — no API key configured.');
    return;
  }

  const maxPerRefresh = parseInt(getSetting('max_per_refresh') || '3', 10);
  const autoPublish   = getSetting('auto_publish') === '1';

  // Get admin user id for authorship
  const admin = db.prepare('SELECT id FROM users WHERE role=?').get('admin');
  if (!admin) return;

  // Pick unprocessed news items, most recent first
  const pending = db.prepare(
    'SELECT * FROM news WHERE article_generated=0 ORDER BY pub_date DESC LIMIT ?'
  ).all(maxPerRefresh);

  if (!pending.length) {
    console.log('[AI] No new news items to convert.');
    return;
  }

  console.log(`[AI] Generating articles for ${pending.length} news item(s)…`);

  for (const item of pending) {
    try {
      console.log(`[AI] Writing: "${item.title.slice(0,60)}…"`);

      const [title, content] = await Promise.all([
        generateTitle(item),
        generateArticleFromNews(item),
      ]);

      const excerpt   = extractExcerpt(content);
      const read_time = estimateReadTime(content);
      let   slug      = slugify(title);

      // Ensure unique slug
      if (db.prepare('SELECT id FROM articles WHERE slug=?').get(slug)) {
        slug = `${slug}-${Date.now()}`;
      }

      const cover_url = item.image_url || '';

      const { lastInsertRowid } = db.prepare(
        `INSERT INTO articles
           (title, slug, excerpt, content, category, read_time, cover_url, author_id, published, featured)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(
        title, slug, excerpt, content,
        'ANALYSIS', read_time, cover_url,
        admin.id,
        autoPublish ? 1 : 0,
        0
      );

      // Mark news item as processed
      db.prepare('UPDATE news SET article_generated=1 WHERE id=?').run(item.id);

      console.log(`[AI] ✓ Article "${title}" created (id=${lastInsertRowid}, published=${autoPublish})`);
    } catch (err) {
      console.log(`[AI] ✗ Failed for "${item.title.slice(0,50)}": ${err.message}`);
      // Mark as processed even on failure to avoid infinite retry loop
      db.prepare('UPDATE news SET article_generated=1 WHERE id=?').run(item.id);
    }
  }
}

// ── Manual: generate article for ONE specific news item ────────────────────
async function generateOne(newsId) {
  const item = db.prepare('SELECT * FROM news WHERE id=?').get(newsId);
  if (!item) throw new Error('News item not found');

  const admin = db.prepare('SELECT id FROM users WHERE role=?').get('admin');
  if (!admin) throw new Error('No admin user found');

  const autoPublish = getSetting('auto_publish') === '1';

  const [title, content] = await Promise.all([
    generateTitle(item),
    generateArticleFromNews(item),
  ]);

  const excerpt   = extractExcerpt(content);
  const read_time = estimateReadTime(content);
  let   slug      = slugify(title);
  if (db.prepare('SELECT id FROM articles WHERE slug=?').get(slug)) {
    slug = `${slug}-${Date.now()}`;
  }

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO articles
       (title, slug, excerpt, content, category, read_time, cover_url, author_id, published, featured)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    title, slug, excerpt, content,
    'ANALYSIS', read_time, item.image_url || '',
    admin.id,
    autoPublish ? 1 : 0,
    0
  );

  db.prepare('UPDATE news SET article_generated=1 WHERE id=?').run(item.id);

  return db.prepare('SELECT * FROM articles WHERE id=?').get(lastInsertRowid);
}

module.exports = { autoGenerateArticles, generateOne, getApiKey, getSetting };
