const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const window = {};
const context = vm.createContext({ window });
for (const file of ['data/site-data.js', 'data/patreon-public.js', 'assets/patreon-catalog.js', 'data/facebook-public.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
const data = window.ASTERION_DATA;
const source = window.ASTERION_FACEBOOK_PUBLIC;
const baseFiles = data.stats.catalog_items;
const baseCount = data.catalog.length;
const code = fs.readFileSync(path.join(root, 'assets/facebook-catalog.js'), 'utf8');
vm.runInContext(code, context);

test('both verified social sources are shown, with dated public Facebook posts', () => {
  assert.equal(source.verification.anonymous, true);
  assert.equal(source.items.length, 5);
  for (const id of ['patreon', 'facebook']) {
    const social = data.social.sources.find(item => item.id === id);
    assert.equal(social.in_news, false);
    assert.ok(social.items.length >= 3);
  }
  assert.equal(data.social.sources.find(item => item.id === 'facebook').items[0].date, '2026-07-01');
  for (const post of source.items) assert.match(post.url, /^https:\/\/www\.facebook\.com\/AsterionSvet\/posts\/pfbid/);
});

test('two heraldry galleries are catalogued without inflating the file count', () => {
  assert.equal(data.catalog.length, baseCount + 2);
  assert.equal(data.stats.catalog_items, baseFiles);
  assert.equal(data.groups.find(pair => pair[0] === 'Heraldika')[1], 2);
  for (const item of data.catalog.filter(item => item.group === 'Heraldika')) {
    assert.equal(item.source, 'Pinterest');
    assert.match(item.href, /^https:\/\/cz\.pinterest\.com\/asterionrpg\/erby\//);
    assert.ok(item.announcement_date);
    assert.equal(item.published_date, undefined);
    assert.equal(item.resource_links.length, 1);
    assert.ok(item.search_text.includes('šlechtických rodů'));
  }
});

test('old Facebook dates remain in news and re-import creates no duplicates', () => {
  assert.equal(data.config.news.filter(item => item.source === 'Facebook').length, 5);
  for (let i = 1; i < data.config.news.length; i++) {
    assert.ok((data.config.news[i-1].published_at || data.config.news[i-1].date) >= (data.config.news[i].published_at || data.config.news[i].date));
  }
  const before = JSON.stringify(data);
  vm.runInContext(code, context);
  assert.equal(JSON.stringify(data), before);
});

test('public source labels and direct resource links are supported by the renderer', () => {
  const app = fs.readFileSync(path.join(root, 'assets/site.js'), 'utf8');
  assert.match(app, /data-social-source=/);
  assert.match(app, /class="social-archive"/);
  assert.match(app, /item\.source \|\| "Web"/);
  assert.match(app, /item\.announcement_date/);
  assert.match(app, /item\.resource_links/);
  assert.match(app, /<strong>Heraldika<\/strong>/);
});
