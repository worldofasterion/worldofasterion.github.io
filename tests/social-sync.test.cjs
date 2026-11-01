const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const sync = require('../tools/social-sync.cjs');
const repo = path.resolve(__dirname,'..');
const env = {PATREON_ACCESS_TOKEN:'test-patreon-token',FACEBOOK_PAGE_ACCESS_TOKEN:'test-facebook-token',FACEBOOK_PAGE_ID:'42'};
const resource = {id:'199999999',attributes:{title:'Veřejný test',url:'https://www.patreon.com/posts/verejny-test-199999999',published_at:'2026-10-31T12:00:00Z',is_public:true}};
const fb = {id:'42_22',from:{id:'42'},message:'Erby měst\n\nVeřejný popis.',created_time:'2026-10-31T13:00:00Z',permalink_url:'https://www.facebook.com/AsterionSvet/posts/testpost',is_published:true,is_hidden:false,privacy:{value:'EVERYONE'}};
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'asterion-social-test-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'data'));
  fs.copyFileSync(path.join(repo,'data/patreon-public.js'),path.join(root,'data/patreon-public.js'));
  fs.writeFileSync(path.join(root,'data/social-cloud.js'),'window.ASTERION_SOCIAL_CLOUD={"schema_version":1,"patreon":[],"facebook":[]};\n');
  fs.writeFileSync(path.join(root,'index.html'),'<script src="data/social-cloud.js?v=test"></script>');
  return root;
}
function mock(options = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url); calls.push({url:u,init});
    const reply = data => new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
    if (u.pathname.endsWith('/campaigns')) return reply({data:[{id:'100',attributes:{url:'https://www.patreon.com/AsterionRPG'}}]});
    if (u.pathname.endsWith('/campaigns/100/posts')) return reply({data:[resource,{id:'188888888',attributes:{...resource.attributes,title:'Zamčený test',url:'https://www.patreon.com/posts/zamceny-test-188888888',is_public:false}},{id:'177777777',attributes:{...resource.attributes,published_at:null}}]});
    if (u.pathname.endsWith('/posts/199999999')) return reply({data:{attributes:{is_public:true,content:'<p>Veřejný obsah.</p><a href="https://www.patreon.com/file?h=199&amp;m=1">Dokument</a>'}}});
    if (u.pathname.endsWith('/posts/188888888')) throw new Error('A locked body must never be requested');
    if (u.pathname === '/v26.0/42') return reply({id:'42',name:'Asterion – svět',link:'https://www.facebook.com/AsterionSvet'});
    if (u.pathname.endsWith('/42/published_posts')) {
      if (options.facebookError) return new Response('{}',{status:403});
      return reply({data:[options.noPrivacy ? {...fb,privacy:null} : fb]});
    }
    if (u.pathname === '/file') return new Response(Buffer.from('%PDF-1.4\nPublic fixture'),{headers:{'content-type':'application/pdf'}});
    throw new Error('Unexpected test request: ' + u.pathname);
  };
  return {fetcher,calls};
}

test('published Patreon metadata never gives permission to mirror locked or unknown content', () => {
  assert.equal(sync.normalizedPatreon(resource).access,'public');
  assert.equal(sync.normalizedPatreon({...resource,attributes:{...resource.attributes,is_public:false}}).access,'members');
  assert.equal(sync.normalizedPatreon({...resource,attributes:{...resource.attributes,is_public:null}}).access,'unknown');
  assert.equal(sync.normalizedPatreon({...resource,attributes:{...resource.attributes,published_at:null}}),null);
  assert.equal(sync.normalizedPatreon({...resource,attributes:{...resource.attributes,published_at:'2099-01-01T00:00:00Z'}}),null);
});
test('Facebook requires the intended owner, explicit public privacy and published, visible state', () => {
  assert.equal(sync.normalizedFacebook(fb,'42').access,'public');
  for (const patch of [{from:{id:'17'}},{is_published:false},{is_hidden:true},{privacy:{value:'ALL_FRIENDS'}},{privacy:null}]) assert.equal(sync.normalizedFacebook({...fb,...patch},'42'),null);
});
test('only approved HTTPS media hosts are fetched, and HTML is never saved as a PDF', () => {
  for (const url of ['http://www.patreon.com/file?h=1','https://www.patreon.com.evil.test/file','http://127.0.0.1/x','https://graph.facebook.com/me','file:///etc/passwd']) assert.throws(() => sync.assetUrl(url));
  assert.equal(sync.assetUrl('https://c10.patreonusercontent.com/example.jpg').hostname,'c10.patreonusercontent.com');
  assert.throws(() => sync.fileExtension(Buffer.from('<html>Log in</html>'),'application/pdf'));
});
test('HTML text, offline pages and source URLs are safe and use original Prague dates', () => {
  assert.equal(sync.day('2026-10-31T23:30:00Z'),'2026-11-01');
  assert.equal(sync.plain('<script>bad()</script><p>A &amp; B</p>'),'A & B');
  const html = sync.htmlArticle({provider:'facebook',date:'2026-10-31',title:'<img onerror=bad()>',search_text:'<script>raw text</script>',url:fb.permalink_url},[{label:'PDF',href:'assets/social-materials/files/test.pdf',extension:'pdf'}]);
  assert.ok(html.includes('&lt;img onerror=bad()&gt;'));
  assert.ok(html.includes('href="../files/test.pdf"'));
  assert.ok(!html.includes('<script>'));
});
test('check reads official APIs without publishing or requesting locked post bodies', async t => {
  const root = temporary(t), {fetcher,calls} = mock();
  const before = fs.readFileSync(path.join(root,'data/social-cloud.js'),'utf8');
  const result = await sync.sync(env,{root,fetcher});
  assert.equal(result.changed,true);
  assert.equal(fs.readFileSync(path.join(root,'data/social-cloud.js'),'utf8'),before);
  assert.equal(fs.existsSync(path.join(root,'assets')),false);
  assert.ok(!calls.some(c => c.url.pathname.endsWith('/posts/188888888')));
  const download = calls.find(c => c.url.pathname === '/file');
  assert.equal(download.init.headers.Authorization,undefined);
});
test('source failure or missing privacy never partially overwrites an existing catalogue', async t => {
  for (const settings of [{facebookError:true},{noPrivacy:true}]) {
    const root = temporary(t), before = fs.readFileSync(path.join(root,'data/social-cloud.js'),'utf8');
    await assert.rejects(sync.sync(env,{root,fetcher:mock(settings).fetcher,apply:true}));
    assert.equal(fs.readFileSync(path.join(root,'data/social-cloud.js'),'utf8'),before);
    assert.equal(fs.existsSync(path.join(root,'assets')),false);
  }
});
test('apply archives real files and safe articles, redacts secrets and is idempotent', async t => {
  const root = temporary(t), first = mock();
  await sync.sync(env,{root,fetcher:first.fetcher,apply:true});
  const data = sync.readData('data/social-cloud.js','ASTERION_SOCIAL_CLOUD',root);
  const locked = data.patreon.find(p => p.access === 'members');
  for (const field of ['search_text','attachments','content','article_href']) assert.equal(locked[field],undefined);
  assert.ok(data.patreon.find(p => p.access === 'public').attachments.some(f => f.extension === 'pdf'));
  for (const p of [...data.patreon,...data.facebook]) for (const f of p.attachments || []) assert.equal(fs.statSync(path.join(root,f.href)).size,f.size);
  const raw = fs.readFileSync(path.join(root,'data/social-cloud.js'),'utf8');
  for (const secret of Object.values(env)) if (secret !== '42') assert.ok(!raw.includes(secret));
  assert.ok(!raw.includes('www.patreon.com/file?'));
  const second = mock();
  assert.equal((await sync.sync(env,{root,fetcher:second.fetcher,apply:true})).changed,false);
  assert.equal(second.calls.filter(c => c.url.pathname === '/file').length,0);
});
test('pagination cannot leak Authorization to another host', async () => {
  await assert.rejects(sync.collect('https://www.patreon.com/api/oauth2/v2/campaigns','test', 'https://www.patreon.com/api/oauth2/v2/',async () => new Response(JSON.stringify({data:[],links:{next:'https://evil.test/steal'}}))),/pagination/);
});
test('token renewal writes secrets through a private writer, not into public data', async () => {
  const saved = [];
  const e = {...env,PATREON_AUTO_REFRESH:'true',PATREON_CLIENT_ID:'test-client',PATREON_CLIENT_SECRET:'test-secret',PATREON_REFRESH_TOKEN:'test-refresh',SOCIAL_SECRETS_WRITER:'test-writer',GITHUB_REPOSITORY:'worldofasterion/worldofasterion.github.io'};
  const token = await sync.refreshPatreon(e,async url => new Response(JSON.stringify(new URL(url).hostname === 'api.github.com' ? {key:'public-encryption-key'} : {access_token:'new-test-access',refresh_token:'new-test-refresh'})),async (name,value) => saved.push([name,value]));
  assert.equal(token,'new-test-access');
  assert.deepEqual(saved.map(p => p[0]),['PATREON_REFRESH_TOKEN','PATREON_ACCESS_TOKEN']);
  await assert.rejects(sync.refreshPatreon({...e,SOCIAL_SECRETS_WRITER:''}),/SOCIAL_SECRETS_WRITER/);
});
test('cloud browser import separates announcements and public material, without duplicate application', () => {
  const window = {}, context = vm.createContext({window,URL});
  for (const file of ['data/site-data.js','data/patreon-public.js','assets/patreon-catalog.js','data/facebook-public.js','assets/facebook-catalog.js']) vm.runInContext(fs.readFileSync(path.join(repo,file),'utf8'),context);
  const before = window.ASTERION_DATA.catalog.length;
  const alias = window.ASTERION_PATREON_PUBLIC.items.flatMap(p => p.related_posts || [])[0];
  const aliasId = alias.url.match(/-(\d+)$/)[1];
  window.ASTERION_SOCIAL_CLOUD = {schema_version:1,patreon:[{...sync.normalizedPatreon(resource),summary:'Veřejný obsah',attachments:[],search_text:'Vyhledatelné slovo'}, {...sync.normalizedPatreon(resource),id:'188888888',title:'Uzamčený text',url:'https://www.patreon.com/posts/188888888',access:'members',summary:'Příspěvek pro členy'}, {id:aliasId,provider:'patreon',url:alias.url,title:alias.title,date:'2024-11-01',published_at:'2024-11-01T12:00:00Z',legacy:true,access:'public'}],facebook:[{...sync.normalizedFacebook(fb,'42'),attachments:[]}]};
  const code = fs.readFileSync(path.join(repo,'assets/social-cloud.js'),'utf8'); vm.runInContext(code,context);
  const data = window.ASTERION_DATA;
  assert.equal(data.catalog.length,before+2);
  assert.ok(data.config.news.some(n => n.id === 'patreon-188888888'));
  assert.ok(!data.catalog.some(n => n.id === 'patreon-188888888'));
  assert.ok(!data.config.news.some(n => n.id === 'patreon-' + aliasId));
  assert.equal(data.catalog.find(n => n.id === 'facebook-42_22').group,'Z Facebooku');
  const snapshot = JSON.stringify(data); vm.runInContext(code,context); assert.equal(JSON.stringify(data),snapshot);
});
