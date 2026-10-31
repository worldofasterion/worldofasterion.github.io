(function () {
  'use strict';
  const data = window.ASTERION_DATA;
  const source = window.ASTERION_PATREON_PUBLIC;
  if (!data || !source || !source.verification.anonymous || source.verification.filter !== 'Public') return;
  const group = 'Veřejně z Patreonu';
  const existing = new Set(data.catalog.map(item => item.id));
  const fileHashes = new Set(data.catalog.map(item => item.sha256).filter(Boolean));
  source.items.forEach(function (post) {
    const id = 'patreon-' + post.id;
    if (existing.has(id)) return;
    existing.add(id);
    data.catalog.push({ id, title: post.title, group, tags: post.tags, extension: 'web', size: null, description: post.original_title, summary: post.summary, href: post.url, source: 'Patreon', published_date: post.date, published_at: post.published_at, search_text: post.search_text, attachments: post.attachments, related_posts: post.related_posts });
    post.attachments.forEach(function (file) {
      if (!fileHashes.has(file.sha256)) { data.stats.catalog_items += 1; fileHashes.add(file.sha256); }
    });
  });
  data.groups = data.groups.filter(pair => pair[0] !== group);
  data.groups.push([group, source.items.length]);
  data.stats.public_patreon_posts = source.verification.public_posts;
  data.stats.patreon_catalogue_entries = source.items.length;
  data.stats.patreon_pdfs = source.items.reduce((count, post) => count + post.attachments.length, 0);
  const newsIds = new Set(data.config.news.map(item => item.id).filter(Boolean));
  source.items.forEach(function (post) {
    const id = 'patreon-' + post.id;
    if (!newsIds.has(id)) data.config.news.push({ id, title: post.title, date: post.date, published_at: post.published_at, route: post.url, source: 'Patreon', text: post.summary });
  });
  data.config.news.sort((a, b) => (b.published_at || b.date).localeCompare(a.published_at || a.date));
  const social = data.social && data.social.sources.find(item => item.id === 'patreon');
  if (social) {
    social.in_news = false;
    social.update_mode = 'anonymous-public-filter-verified';
    social.items = source.items.map(post => ({ date: post.date, title: post.title, url: post.url }));
  }
}());
