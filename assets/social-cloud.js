(function () {
  'use strict';
  const data = window.ASTERION_DATA;
  const cloud = window.ASTERION_SOCIAL_CLOUD;
  if (!data || !cloud || cloud.schema_version !== 1 || data._cloudSyncApplied) return;
  data._cloudSyncApplied = true;
  const files = new Set();
  data.catalog.forEach(item => {
    if (item.sha256) files.add(item.sha256);
    (item.attachments || []).forEach(file => files.add(file.sha256));
  });
  function key(url) {
    try {
      const u = new URL(url);
      const post = u.pathname.match(/\/posts\/([^/]+)/);
      const id = /patreon\.com$/.test(u.hostname) ? post && post[1].match(/\d+$/)?.[0] : post && post[1];
      return u.hostname.replace(/^www\./,'') + (id ? '/posts/' + id : u.pathname.replace(/\/$/,''));
    } catch (_error) { return url; }
  }
  for (const provider of ['patreon','facebook']) {
    const label = provider === 'patreon' ? 'Patreon' : 'Facebook';
    const group = provider === 'patreon' ? 'Veřejně z Patreonu' : 'Z Facebooku';
    const source = data.social.sources.find(item => item.id === provider);
    const socialItems = new Map((source && source.items || []).map(item => [key(item.url),item]));
    for (const post of cloud[provider] || []) {
      const id = provider + '-' + post.id;
      const existingIndex = data.catalog.findIndex(item => item.id === id || key(item.href) === key(post.url));
      const original = existingIndex >= 0 ? data.catalog[existingIndex] : null;
      if (post.access === 'public') {
        if (!original && !post.legacy) data.catalog.push({
          id,title:post.title,group,tags:[label,...(post.tags || [])],extension:'web',size:null,
          href:post.article_href || post.url,source:label,published_date:post.date,published_at:post.published_at,
          summary:post.summary || '',search_text:post.search_text || '',description:post.title,
          attachments:post.attachments || [],resource_links:[{label:'Původní příspěvek',url:post.url}]
        });
        (post.attachments || []).forEach(file => { if (file.sha256 && !files.has(file.sha256)) { files.add(file.sha256); data.stats.catalog_items++; } });
      } else if (provider === 'patreon' && post.access === 'members' && original) {
        data.catalog.splice(existingIndex,1); // A previously public post must no longer expose its body here.
      }
      const title = original && post.legacy ? original.title : post.title + (post.access === 'members' ? ' (pro členy)' : '');
      const newsIndex = data.config.news.findIndex(item => item.id === id || key(item.route) === key(post.url));
      const news = {id,title,date:post.date,published_at:post.published_at,route:post.url,source:label,text:post.summary || original && original.summary || ''};
      if (newsIndex >= 0) data.config.news[newsIndex] = news; else data.config.news.push(news);
      const previous = socialItems.get(key(post.url));
      socialItems.set(key(post.url),{...previous,title:previous && post.legacy ? previous.title : title,date:post.date,url:post.url});
    }
    if (source) { source.in_news = false; source.items = [...socialItems.values()].sort((a,b) => b.date.localeCompare(a.date)); }
    const catalogue = data.catalog.filter(item => item.group === group);
    data.groups = data.groups.filter(pair => pair[0] !== group);
    if (catalogue.length) data.groups.push([group,catalogue.length]);
    if (provider === 'patreon') {
      data.stats.patreon_catalogue_entries = catalogue.length;
      data.stats.public_patreon_posts = catalogue.length + catalogue.reduce((n,p) => n + (p.related_posts || []).length,0);
      data.stats.patreon_pdfs = catalogue.reduce((n,p) => n + (p.attachments || []).filter(f => /\.pdf$/i.test(f.href)).length,0);
    }
  }
  data.config.news.sort((a,b) => (b.published_at || b.date).localeCompare(a.published_at || a.date));
}());
