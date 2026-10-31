(function () {
  'use strict';
  const data = window.ASTERION_DATA;
  const source = window.ASTERION_FACEBOOK_PUBLIC;
  if (!data || !source || !source.verification.anonymous) return;

  const group = 'Heraldika';
  const existing = new Set(data.catalog.map(item => item.id));
  source.resources.forEach(function (resource) {
    const id = 'pinterest-' + resource.id;
    const announcement = source.items.find(post => post.id === resource.announcement_id);
    if (existing.has(id) || !announcement) return;
    existing.add(id);
    data.catalog.push({
      id, title: resource.title, group, tags: resource.tags, extension: 'web', size: null,
      href: resource.href, source: 'Pinterest', announcement_date: announcement.date,
      description: resource.title, summary: resource.summary, search_text: resource.summary,
      resource_links: [{ label: 'Oznámení na Facebooku', url: announcement.url }]
    });
  });
  data.groups = data.groups.filter(pair => pair[0] !== group);
  data.groups.push([group, data.catalog.filter(item => item.group === group).length]);

  const newsIds = new Set(data.config.news.map(item => item.id).filter(Boolean));
  source.items.forEach(function (post) {
    const id = 'facebook-' + post.id;
    if (!newsIds.has(id)) data.config.news.push({ id, title: post.title, date: post.date, route: post.url, source: 'Facebook', text: post.summary });
  });
  data.config.news.sort((a, b) => (b.published_at || b.date).localeCompare(a.published_at || a.date));

  const social = data.social && data.social.sources.find(item => item.id === 'facebook');
  if (social) {
    social.in_news = false;
    social.update_mode = 'anonymous-public-badge-verified';
    social.items = source.items.map(post => ({ date: post.date, title: post.title, url: post.url, links: post.links || [] }));
    social.extra_links = [{ label: 'Všechny erby na Pinterestu', url: 'https://cz.pinterest.com/asterionrpg/erby/' }];
  }
}());
