'use strict';
// Official read APIs only. Never persist raw API responses, OAuth tokens or signed URLs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const UA = 'WorldOfAsterion - Website Public Content Sync';
const GRAPH = 'https://graph.facebook.com/v26.0/';
const PATREON = 'https://www.patreon.com/api/oauth2/v2/';
const REQUIRED = ['PATREON_ACCESS_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID'];
const requestTimes = new Map();
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function readData(file, name, root = ROOT) {
  const raw = fs.readFileSync(path.join(root, file), 'utf8').trim();
  const match = raw.match(new RegExp('^window\\.' + name + '\\s*=\\s*([\\s\\S]*?);?$'));
  if (!match) throw new Error('Unexpected data wrapper: ' + file);
  return JSON.parse(match[1]);
}
function plain(html = '') {
  return String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (m, n) => { const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : ''; })
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (m, n) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[n]))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}
function day(value) {
  if (!Number.isFinite(Date.parse(value))) throw new Error('Missing valid publication date');
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}
function publicUrl(value, provider) {
  const u = new URL(value);
  const hosts = provider === 'patreon' ? ['www.patreon.com','patreon.com'] : ['www.facebook.com','facebook.com'];
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname) || u.username || u.password || !u.pathname.includes('/posts/')) throw new Error('Unexpected public post URL');
  u.search = ''; u.hash = '';
  return u.href;
}
function canonicalUrl(value) {
  try { const u = new URL(value); const post = u.pathname.match(/\/posts\/([^/]+)/); return u.hostname.replace(/^www\./,'') + (post ? '/posts/' + post[1] : u.pathname.replace(/\/$/,'')); } catch { return ''; }
}
function summary(text) {
  const value = text.replace(/\s+/g,' ').trim();
  return (value.length > 240 ? value.slice(0,237).replace(/\s+\S*$/,'') + '…' : value) || 'Veřejný příspěvek Asterionu.';
}
function tags(text) {
  const result = [];
  for (const [pattern, tag] of [[/erb|herald/i,'heraldika'],[/herbář|bylin/i,'herbář'],[/map[ayěu]|plán/i,'mapy'],[/ilustr|obráz/i,'ilustrace'],[/pravid|aplikac/i,'aplikace pravidel'],[/dobrodruž/i,'dobrodružství']]) if (pattern.test(text)) result.push(tag);
  if (/\bAI\b|vygenerovan|nagenerovan/i.test(text)) result.push('AI ilustrace', 'pracovní ukázka');
  return result;
}
function assetUrl(value) {
  const u = new URL(value);
  const host = u.hostname;
  const allowed = host === 'www.patreon.com' && u.pathname === '/file' || ['patreonusercontent.com','fbcdn.net','fbsbx.com'].some(s => host === s || host.endsWith('.' + s));
  if (u.protocol !== 'https:' || !allowed || u.username || u.password) throw new Error('Unapproved attachment host');
  return u;
}
function assetId(value) {
  const u = assetUrl(value);
  return sha(u.origin + u.pathname + (u.searchParams.has('h') ? '?h=' + u.searchParams.get('h') + '&m=' + (u.searchParams.get('m') || '') : '')).slice(0,24);
}
function fileExtension(bytes, type = '') {
  if (bytes.subarray(0,5).toString() === '%PDF-') return 'pdf';
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (/^GIF8[79]a/.test(bytes.subarray(0,6).toString())) return 'gif';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'webp';
  if (bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])) && /zip|wordprocessingml/.test(type)) return /wordprocessingml/.test(type) ? 'docx' : 'zip';
  throw new Error('Attachment is not a supported validated file');
}
async function json(url, token, base, fetcher = fetch, options = {}) {
  const u = new URL(url);
  if (u.origin !== new URL(base).origin || !u.pathname.startsWith(new URL(base).pathname)) throw new Error('API pagination left its allowed endpoint');
  u.searchParams.delete('access_token');
  if (fetcher === fetch && u.hostname === 'www.patreon.com') {
    const pause = 700 - (Date.now() - (requestTimes.get(u.hostname) || 0));
    if (pause > 0) await new Promise(resolve => setTimeout(resolve,pause));
    requestTimes.set(u.hostname,Date.now());
  }
  const response = await fetcher(u, {redirect:'error',signal:AbortSignal.timeout(30000),...options,headers:{'User-Agent':UA,Accept:'application/json',...(token ? {Authorization:'Bearer ' + token} : {}),...options.headers}});
  if (!response.ok) throw new Error('Read API returned HTTP ' + response.status + ' (check token and read permissions)');
  const body = await response.json();
  if (body.error || body.errors) throw new Error('Read API rejected the request; no response body was logged');
  return body;
}
async function collect(url, token, base, fetcher) {
  const result = [], seen = new Set();
  for (let page = 0; url; page++) {
    if (page >= 30 || seen.has(String(url))) throw new Error('Incomplete or cyclic API pagination');
    seen.add(String(url));
    const body = await json(url, token, base, fetcher);
    if (!Array.isArray(body.data)) throw new Error('Unexpected API list schema');
    result.push(...body.data);
    if (result.length > 1500) throw new Error('History exceeds the safe batch limit; narrow the sync interval');
    url = body.links?.next || body.paging?.next;
  }
  return result;
}
function htmlArticle(post, attachments) {
  const paragraphs = escape(post.search_text || post.summary).split(/\n\s*\n/).map(p => '<p>' + p.replace(/\n/g,'<br>') + '</p>').join('\n');
  const files = attachments.map(a => `<li><a href="${escape(path.posix.relative('assets/social-materials/' + post.provider,a.href))}" download>${escape(a.label)} (${(a.extension || path.extname(a.href).slice(1)).toUpperCase()})</a></li>`).join('');
  return `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(post.title)} – Asterion</title><style>body{max-width:48rem;margin:3rem auto;padding:0 1.3rem;background:#202321;color:#e6e5d9;font:17px/1.6 Georgia,serif}h1,a{color:#d4c568}small{color:#b5b8ac}</style><h1>${escape(post.title)}</h1><small>${escape(post.date)} · ${escape(post.provider === 'patreon' ? 'Patreon' : 'Facebook')}</small>${paragraphs}${files ? '<h2>Přílohy</h2><ul>' + files + '</ul>' : ''}<p><a href="${escape(post.url)}">Původní příspěvek</a> · <a href="../../../index.html#/home">Asterion</a></p></html>\n`;
}
function inlineAssets(html = '') {
  const out = new Map();
  for (const match of String(html).matchAll(/(?:href|src)=["']([^"']+)["']/gi)) {
    try { const u = assetUrl(match[1].replace(/&amp;/g,'&')); out.set(assetId(u.href), {url:u.href,label:'Příloha'}); } catch { /* External links remain in the source article; never fetch arbitrary hosts. */ }
  }
  return [...out.values()];
}
function normalizedPatreon(resource, now = Date.now()) {
  const a = resource.attributes || {};
  if (!/^\d+$/.test(resource.id) || !a.published_at || Date.parse(a.published_at) > now) return null;
  const access = a.is_public === true ? 'public' : a.is_public === false ? 'members' : 'unknown';
  return {id:resource.id,provider:'patreon',title:plain(a.title).slice(0,160) || 'Příspěvek Asterionu',url:publicUrl(a.url,'patreon'),published_at:new Date(a.published_at).toISOString(),date:day(a.published_at),access};
}
function normalizedFacebook(resource, pageId, now = Date.now()) {
  if (resource.from?.id !== pageId || resource.is_published !== true || resource.is_hidden !== false || resource.privacy?.value !== 'EVERYONE') return null;
  if (!resource.created_time || Date.parse(resource.created_time) > now || !/^\d+_\d+$/.test(resource.id)) return null;
  const text = plain(resource.message || resource.story || 'Veřejná obrazová ukázka Asterionu.');
  const title = text.split('\n').find(line => /[\p{L}\p{N}]/u.test(line))?.replace(/^[^\p{L}\p{N}]+/u,'').slice(0,110).trim() || 'Obrazová ukázka Asterionu';
  const assets = [];
  function visit(attachment) {
    if (attachment.type === 'photo' && attachment.media?.image?.src) assets.push({url:attachment.media.image.src,label:'Obrázek'});
    for (const child of attachment.subattachments?.data || []) visit(child);
  }
  for (const a of resource.attachments?.data || []) visit(a);
  return {id:resource.id,provider:'facebook',title,url:publicUrl(resource.permalink_url,'facebook'),published_at:new Date(resource.created_time).toISOString(),date:day(resource.created_time),access:'public',summary:summary(text),search_text:text,tags:tags(text),_assets:assets};
}
async function refreshPatreon(env, fetcher = fetch, persist = persistToken) {
  if (env.PATREON_AUTO_REFRESH !== 'true') return env.PATREON_ACCESS_TOKEN;
  for (const key of ['PATREON_CLIENT_ID','PATREON_CLIENT_SECRET','PATREON_REFRESH_TOKEN','SOCIAL_SECRETS_WRITER']) if (!env[key]) throw new Error('Automatic token renewal requires ' + key);
  // Check writer access before rotating the single-use refresh token.
  await json(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/secrets/public-key`, env.SOCIAL_SECRETS_WRITER, 'https://api.github.com/', fetcher);
  const body = await json('https://www.patreon.com/api/oauth2/token', null, 'https://www.patreon.com/api/oauth2/', fetcher, {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:env.PATREON_REFRESH_TOKEN,client_id:env.PATREON_CLIENT_ID,client_secret:env.PATREON_CLIENT_SECRET}).toString()});
  if (!body.access_token || !body.refresh_token) throw new Error('Token renewal returned an incomplete result');
  // Refresh token first: it is required for recovery if the next secret write fails.
  await persist('PATREON_REFRESH_TOKEN', body.refresh_token, env);
  await persist('PATREON_ACCESS_TOKEN', body.access_token, env);
  return body.access_token;
}
async function persistToken(name, value, env) {
  const r = spawnSync('gh',['secret','set',name,'--repo',env.GITHUB_REPOSITORY],{input:value,encoding:'utf8',env:{...process.env,GH_TOKEN:env.SOCIAL_SECRETS_WRITER},stdio:['pipe','pipe','pipe']});
  if (r.status !== 0) throw new Error('Could not persist renewed token. Reconnect Patreon; secret output was suppressed.');
}
async function fetchPatreon(env, fetcher = fetch) {
  const token = await refreshPatreon(env, fetcher);
  const campaigns = await collect(PATREON + 'campaigns?fields%5Bcampaign%5D=url',token,PATREON,fetcher);
  const campaign = campaigns.find(c => /\/AsterionRPG\/?$/i.test(c.attributes?.url || ''));
  if (!campaign || !/^\d+$/.test(campaign.id)) throw new Error('The authorized campaign is not AsterionRPG');
  const url = new URL(PATREON + `campaigns/${campaign.id}/posts`);
  url.searchParams.set('fields[post]','title,url,published_at,is_public');
  url.searchParams.set('page[count]','100');
  const resources = await collect(url,token,PATREON,fetcher);
  if (!resources.length) throw new Error('Unexpected empty Patreon response; keeping previous catalogue');
  const posts = [];
  for (const resource of resources) {
    const post = normalizedPatreon(resource);
    if (post) posts.push(post);
  }
  return {posts,token};
}
async function fetchFacebook(env, fetcher = fetch) {
  if (!/^\d+$/.test(env.FACEBOOK_PAGE_ID || '')) throw new Error('FACEBOOK_PAGE_ID must be the numeric page ID');
  const identity = await json(GRAPH + env.FACEBOOK_PAGE_ID + '?fields=id,name,link',env.FACEBOOK_PAGE_ACCESS_TOKEN,GRAPH,fetcher);
  if (identity.id !== env.FACEBOOK_PAGE_ID || !/asterion/i.test(identity.name || '')) throw new Error('Facebook token does not identify the intended Asterion page');
  const url = new URL(GRAPH + env.FACEBOOK_PAGE_ID + '/published_posts');
  url.searchParams.set('limit','100');
  url.searchParams.set('fields','id,from{id},message,story,created_time,permalink_url,is_published,is_hidden,privacy,attachments{type,media,target,subattachments{type,media,target}}');
  const resources = await collect(url,env.FACEBOOK_PAGE_ACCESS_TOKEN,GRAPH,fetcher);
  if (resources.some(r => r.from?.id === env.FACEBOOK_PAGE_ID && r.is_published === true && r.is_hidden === false && !r.privacy?.value)) throw new Error('Facebook privacy evidence is missing; no content will be published');
  const posts = resources.map(r => normalizedFacebook(r,env.FACEBOOK_PAGE_ID)).filter(Boolean);
  if (resources.length && !posts.length) throw new Error('Facebook did not return explicitly public published posts; check privacy fields and read permissions');
  return posts;
}
async function sync(env, {root = ROOT, fetcher = fetch, apply = false} = {}) {
  for (const key of REQUIRED) if (!env[key]) throw new Error('Missing connection: ' + key);
  const previous = readData('data/social-cloud.js','ASTERION_SOCIAL_CLOUD',root);
  const legacyPatreon = readData('data/patreon-public.js','ASTERION_PATREON_PUBLIC',root);
  const legacyIds = new Set(legacyPatreon.items.flatMap(p => [p.id, ...(p.related_posts || []).map(q => q.url.match(/-(\d+)$/)?.[1])]).filter(Boolean));
  const pending = new Map(), knownFiles = new Map();
  const byHash = new Map();
  for (const post of [...legacyPatreon.items,...previous.patreon,...previous.facebook]) for (const file of post.attachments || []) {
    if (file.asset_id) knownFiles.set(file.asset_id,file);
    if (file.sha256) byHash.set(file.sha256,file);
  }
  let downloaded = 0, totalBytes = 0;
  async function download(asset) {
    const key = assetId(asset.url), old = knownFiles.get(key);
    if (old && fs.existsSync(path.join(root,old.href)) && sha(fs.readFileSync(path.join(root,old.href))) === old.sha256) return old;
    if (++downloaded > 100) throw new Error('More than 100 new attachments in one batch; nothing was published');
    let u = assetUrl(asset.url), response;
    for (let i=0;i<5;i++) {
      response = await fetcher(u,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'User-Agent':UA}});
      if (response.status < 300 || response.status >= 400) break;
      u = assetUrl(new URL(response.headers.get('location'),u).href);
    }
    if (!response.ok) throw new Error('A public attachment could not be downloaded anonymously');
    if (Number(response.headers.get('content-length')) > 15 * 1024 * 1024) throw new Error('Attachment exceeds 15 MB safety limit');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 15 * 1024 * 1024 || totalBytes + length > 100 * 1024 * 1024) throw new Error('Attachment batch exceeds safety limits');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks); totalBytes += length;
    const extension = fileExtension(bytes,response.headers.get('content-type') || '');
    const hash = sha(bytes), duplicate = byHash.get(hash);
    const file = duplicate || {label:asset.label || 'Příloha',href:`assets/social-materials/files/${hash}.${extension}`,size:bytes.length,sha256:hash,extension,asset_id:key};
    if (!duplicate) pending.set(file.href,bytes);
    byHash.set(hash,file); knownFiles.set(key,file);
    return file;
  }
  // Read both sources before staging a single public file. Failure preserves the last complete snapshot.
  const patreon = await fetchPatreon(env,fetcher);
  const facebook = await fetchFacebook(env,fetcher);
  for (const post of patreon.posts) {
    const old = previous.patreon.find(p => p.id === post.id);
    if (post.access !== 'public') {
      post.summary = post.access === 'members' ? 'Nový příspěvek pro členy Patreonu.' : 'Příspěvek na Patreonu; přístupnost obsahu není potvrzená.';
      continue; // Never request the body or attachments of a gated/unknown post.
    }
    if (legacyIds.has(post.id)) { post.legacy = true; continue; }
    const detail = await json(PATREON + `posts/${post.id}?fields%5Bpost%5D=content,is_public`,patreon.token,PATREON,fetcher);
    if (detail.data?.attributes?.is_public !== true) throw new Error('Patreon access changed while reading; retry after verifying the post');
    const content = detail.data.attributes.content || '';
    post.search_text = plain(content); post.summary = summary(post.search_text); post.tags = tags(post.title + '\n' + post.search_text);
    post._assets = inlineAssets(content);
    if (old?.access === 'public' && old.search_text === post.search_text && old.title === post.title && old.date === post.date) {
      post.attachments = old.attachments || []; post.article_href = old.article_href;
      // Still inspect inline asset identities so newly added files are not missed.
    }
  }
  const out = {schema_version:1,patreon:patreon.posts,facebook};
  for (const provider of ['patreon','facebook']) {
    for (const post of out[provider]) {
      if (post.access !== 'public' || post.legacy) continue;
      const files = [];
      for (const asset of post._assets || []) files.push(await download(asset));
      delete post._assets;
      const unique = [...new Map(files.map(f => [f.sha256,f])).values()];
      post.attachments = unique;
      const article = Buffer.from(htmlArticle(post,unique));
      post.article_href = `assets/social-materials/${provider}/${post.id}.html`;
      post.attachments.push({label:'Text příspěvku',href:post.article_href,size:article.length,sha256:sha(article),extension:'html'});
      pending.set(post.article_href,article);
    }
    out[provider].sort((a,b) => b.published_at.localeCompare(a.published_at) || a.id.localeCompare(b.id));
  }
  // API outages/empty pages are never interpreted as deletion of old entries.
  for (const provider of ['patreon','facebook']) {
    const ids = new Set(out[provider].map(p => p.id));
    out[provider].push(...previous[provider].filter(p => !ids.has(p.id)));
    out[provider].sort((a,b) => b.published_at.localeCompare(a.published_at) || a.id.localeCompare(b.id));
  }
  out.verified_via = {patreon:'API v2: published_at and is_public',facebook:'Graph API v26.0: page owner, published, not hidden, privacy EVERYONE'};
  const previousContent = {...previous}; delete previousContent.updated_at;
  const changed = JSON.stringify(previousContent) !== JSON.stringify(out);
  if (changed) out.updated_at = new Date().toISOString(); else if (previous.updated_at) out.updated_at = previous.updated_at;
  if (apply && changed) {
    for (const [relative,bytes] of pending) { const target = path.join(root,relative); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,bytes); }
    fs.writeFileSync(path.join(root,'data/social-cloud.js'),'window.ASTERION_SOCIAL_CLOUD=' + JSON.stringify(out).replace(/</g,'\\u003c') + ';\n');
    const htmlFile = path.join(root,'index.html');
    fs.writeFileSync(htmlFile,fs.readFileSync(htmlFile,'utf8').replace(/data\/social-cloud\.js\?v=[^"']+/g,'data/social-cloud.js?v=' + sha(JSON.stringify(out)).slice(0,12)));
    // Remove only managed public copies explicitly revoked at the source; Git retains recovery history.
    const retained = new Set([...out.patreon,...out.facebook].filter(p => p.access === 'public').flatMap(p => (p.attachments || []).map(f => f.href)));
    const revoked = previous.patreon.filter(old => old.access === 'public' && out.patreon.some(p => p.id === old.id && p.access === 'members'));
    const managedRoot = path.resolve(root,'assets/social-materials') + path.sep;
    for (const file of revoked.flatMap(p => p.attachments || [])) {
      const target = path.resolve(root,file.href);
      if (!retained.has(file.href) && target.startsWith(managedRoot) && fs.existsSync(target)) fs.unlinkSync(target);
    }
  }
  return {changed,patreon_posts:out.patreon.length,facebook_posts:out.facebook.length,downloaded_files:downloaded,downloaded_bytes:totalBytes,legacy_access_changes:out.patreon.filter(p => legacyIds.has(p.id) && p.access === 'members').length};
}
function output(name, value) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`${name}=${value}\n`); }
async function main() {
  const missing = REQUIRED.filter(key => !process.env[key]);
  if (process.argv.includes('--check-config')) {
    output('ready',String(!missing.length));
    const message = missing.length ? 'Čeká na propojení účtů: ' + missing.join(', ') + '. Web se nemění.' : 'Povinné přístupy jsou vyplněné; jejich platnost ověří až čtecí test API.';
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Propojení sociálních zdrojů\n\n' + message + '\n');
    if (missing.length && process.env.STRICT_CONFIG === 'true') throw new Error('Scheduled sync is enabled but connection settings are missing');
    return;
  }
  const result = await sync(process.env,{apply:process.argv.includes('--apply')});
  output('changed',String(result.changed));
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Výsledek čtecí kontroly\n\n```json\n' + JSON.stringify(result,null,2) + '\n```\n');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {readData,plain,day,canonicalUrl,assetUrl,assetId,fileExtension,normalizedPatreon,normalizedFacebook,refreshPatreon,htmlArticle,inlineAssets,collect,sync,REQUIRED};
