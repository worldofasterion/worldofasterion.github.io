const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const window = {};
const context = vm.createContext({window});
for (const file of ['data/site-data.js', 'data/patreon-public.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
const data = window.ASTERION_DATA;
const source = window.ASTERION_PATREON_PUBLIC;
const baseCount = data.catalog.length;
const baseFiles = data.stats.catalog_items;
const code = fs.readFileSync(path.join(root, 'assets/patreon-catalog.js'), 'utf8');
vm.runInContext(code, context);

test('all 38 anonymous Public posts remain traceable, with one merged duplicate', () => {
  assert.equal(source.verification.anonymous, true);
  assert.equal(source.verification.filter, 'Public');
  assert.equal(source.items.length, 37);
  const urls = source.items.flatMap(p => [p.url, ...p.related_posts.map(p => p.url)]);
  assert.equal(new Set(urls).size, 38);
  assert.equal(data.catalog.length, baseCount + 37);
  assert.equal(data.stats.public_patreon_posts, 38);
  for (const locked of ['153072762', '148076500', '173839364']) assert.ok(!urls.some(url => url.endsWith(locked)));
});

test('original dates are preserved in Prague time and sorted, including old news', () => {
  assert.equal(source.items.find(p => p.id === '173839715').date, '2026-10-30');
  assert.equal(source.items.find(p => p.id === '147990789').date, '2026-01-12');
  assert.equal(source.items.find(p => p.id === '59146376').date, '2021-11-26');
  assert.equal(source.items.find(p => p.id === '47650344').date, '2021-02-17');
  assert.equal(data.config.news.filter(p => p.source === 'Patreon').length, 37);
  for (let i = 1; i < data.config.news.length; i++) assert.ok((data.config.news[i-1].published_at || data.config.news[i-1].date) >= (data.config.news[i].published_at || data.config.news[i].date));
});

test('four real public PDF files have verified digests and are not counted as 37 files', () => {
  const files = source.items.flatMap(post => post.attachments);
  assert.equal(files.length, 4);
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(root, file.href));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(bytes.length, file.size);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.match(file.original_url, /^https:\/\/www\.patreon\.com\/file\?/);
  }
  assert.equal(data.stats.catalog_items, baseFiles + 4);
});

test('import is idempotent, searchable, and replaces the unverified social cache', () => {
  const before = JSON.stringify(data);
  vm.runInContext(code, context);
  assert.equal(JSON.stringify(data), before);
  assert.ok(data.catalog.find(p => p.id === 'patreon-147991323').search_text.includes('modernizovat informace o měnách'));
  const social = data.social.sources.find(p => p.id === 'patreon');
  assert.equal(social.in_news, false);
  assert.equal(social.items.length, 37);
});
