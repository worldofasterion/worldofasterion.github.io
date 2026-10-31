// Import only the logged-out Public-filter DOM audit, never authenticated drafts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const auditDir = path.resolve(process.argv[2] || '');
const root = path.resolve(__dirname, '..');
const audit = JSON.parse(fs.readFileSync(path.join(auditDir, 'public-posts-dom.json'), 'utf8'));
if (!audit.logged_out || !audit.public_filter || !new URL(audit.url).searchParams.has('filters[is_public]')) throw new Error('Missing anonymous Public-filter evidence');
const sitemap = fs.readFileSync(path.join(auditDir, 'sitemap.html'), 'utf8');
const pattern = /\{\\"id\\":\\"(\d+)\\",\\"type\\":\\"post\\",\\"title\\":\\".*?\\",\\"url\\":\\".*?\\",\\"publishedAt\\":\\"(.*?)\\"/g;
const dates = new Map(Array.from(sitemap.matchAll(pattern), m => [m[1], m[2]]));
const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
const documentNames = {
  '147991323': ['Meny_Asterionu.pdf', 'Měny Asterionu'],
  '95745908': ['Bozi_sfera_Mirtal_verejna_verze.pdf', 'Božská sféra – Mirtal (veřejná verze)'],
  '93033606': ['Bozi_sfera_Mauril.pdf', 'Božská sféra – Mauril'],
  '72332461': ['Veda_historie_a_Draci_doupe.pdf', 'Věda, historie a Dračí doupě']
};
function titleOf(post) {
  const match = post.title.match(/^ČT img (\d+)\/4$/);
  return match ? `Čas temna – ilustrace (sada ${match[1]})` : post.title.replace(/^kněží/, 'Kněží').replace(/^Boží Víkend/, 'Boží víkend');
}
function conciseSummary(post, content, fallback) {
  const id = post.url.match(/-(\d+)$/)[1];
  if (/^ČT img/.test(post.title)) return 'Pracovní galerie AI ilustrací k Času temna; obrázky nejsou určeny do tištěné knihy.';
  if (/Nedělní herbář/.test(post.title)) return 'Veřejná ukázka z herbáře: ' + post.title.split(/ – | - /).at(-1) + '.';
  if (/^Bylinky\?/.test(post.title)) return 'Zpráva o přípravě herbáře a pravidlových aplikací.';
  if (/^Herbář in progress/.test(post.title)) return 'Pracovní obrazové podklady k herbáři a pravidlovým aplikacím.';
  if (/Namir Atanar/.test(post.title)) return 'Ukázka příběhu z podzemí Namir Atanar. Nefinální text; dvě veřejné verze příspěvku.';
  if (id === '173839715') return 'Veřejná ukázka ilustrací ke Klíčům bytostí.';
  if (id === '147991323') return 'Materiál o asterionských měnách, včetně veřejného PDF ke stažení.';
  if (id === '95745908') return 'Božská sféra – Mirtal: veřejná zkrácená verze v PDF.';
  if (id === '93033606') return 'Božská sféra – Mauril: článek a veřejné PDF ke stažení.';
  if (id === '147990789') return 'Zpráva o pokračování práce na dalších asterionských materiálech.';
  if (id === '47650344') return 'Původní představení odměn pro podporovatele z roku 2021.';
  if (id === '59146376') return 'Představení figurky barbara Hazzhara a video na Patreonu.';
  if (id === '69386290') return 'Archivní připomínka setkání s Asterionem na Gameconu 2022.';
  if (id === '64776939') return 'Archivní pozvánka na přednášku a stánek Asterionu na Gameconu 2022.';
  if (post.image_count > 30 && content.length < 100) return `Veřejná galerie ilustrací (${post.image_count} obrázků).`;
  return fallback;
}
function bodyOf(post) {
  const lines = post.full_text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === post.date_display);
  return lines.slice(start + 1).filter(line => line.trim() !== 'View post' && line.trim() !== 'Share' && !/^\d+$/.test(line.trim()) && !post.attachments.some(a => a.name === line.trim())).join('\n').trim();
}
const posts = audit.posts.map(post => {
  const id = post.url.match(/-(\d+)$/)?.[1];
  if (!id || !dates.has(id) || !post.url.startsWith('https://www.patreon.com/AsterionRPG/posts/')) throw new Error('Missing original post date or wrong creator');
  const content = bodyOf(post);
  const tags = ['Patreon'];
  if (/herbář|bylinky/i.test(post.title)) tags.push('herbář');
  if (/img|ilustrace|kněž|kněží|Boží [Vv]íkend/.test(post.title) || post.image_count > 1) tags.push('ilustrace');
  if (/nagenerovali|vygenerovan|ai obrázk/i.test(content)) tags.push('AI ilustrace', 'pracovní ukázka');
  if (/Namir|Ohnivé pobřeží|ptačí lid|skřeti/i.test(post.title)) tags.push('ukázka z tvorby');
  if (/^Gamecon|^Odměny$|^Plujeme dál$|^Bylinky\?/.test(post.title)) tags.push('zprávy z tvorby');
  let summary = content.split(/\n\s*\n/).find(p => p.length > 55 && !p.startsWith('<censored>'))?.replace(/\s+/g, ' ') || '';
  if (summary.length > 240) summary = summary.slice(0, 237).replace(/\s+\S*$/, '') + '…';
  if (!summary) summary = post.image_count ? `Veřejná obrazová galerie na Patreonu (${post.image_count} obrázků).` : 'Veřejný příspěvek na Patreonu.';
  summary = conciseSummary(post, content, summary);
  const attachments = [];
  if (documentNames[id]) {
    const [filename, label] = documentNames[id];
    const original = post.attachments.find(a => /\.pdf$/i.test(a.name));
    const input = fs.readFileSync(path.join(auditDir, 'downloads', filename));
    if (!original || input.subarray(0, 5).toString() !== '%PDF-') throw new Error('Missing public PDF');
    const destination = path.join(root, 'assets/patreon-materials', filename);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(auditDir, 'downloads', filename), destination);
    attachments.push({ label, href: `assets/patreon-materials/${filename}`, original_url: original.url, size: input.length, sha256: crypto.createHash('sha256').update(input).digest('hex') });
    tags.push('PDF ke stažení');
  }
  return { id, original_title: post.title, title: titleOf(post), url: post.url, published_at: dates.get(id), date: day(dates.get(id)), summary, search_text: content, tags, image_count: post.image_count, attachments, related_posts: [] };
}).sort((a, b) => b.published_at.localeCompare(a.published_at));
if (posts.length !== 38 || new Set(posts.map(p => p.id)).size !== posts.length) throw new Error('Public post count differs from verified filter');
// Both source posts remain traceable; the catalogue does not repeat the same story.
const duplicate = posts.find(p => p.id === '115100162');
const primary = posts.find(p => p.id === '115102678');
primary.related_posts.push({ title: duplicate.title, url: duplicate.url, published_at: duplicate.published_at });
primary.search_text += '\n' + duplicate.search_text;
const items = posts.filter(p => p !== duplicate);
const data = { checked_at: audit.checked_at, verification: { anonymous: true, filter: 'Public', filter_url: audit.url, source_sitemap: 'https://www.patreon.com/AsterionRPG/sitemap', public_posts: posts.length, catalogue_entries: items.length, timezone: 'Europe/Prague', note: 'Only Public posts are included. Free-members-only and paid posts are excluded. Galleries are linked, not mirrored. Original publication dates are preserved.' }, items };
fs.writeFileSync(path.join(root, 'data/patreon-public.js'), 'window.ASTERION_PATREON_PUBLIC=' + JSON.stringify(data) + ';\n');
console.log(JSON.stringify({ public_posts: posts.length, catalogue_entries: items.length, pdfs: items.reduce((n, p) => n + p.attachments.length, 0), oldest: posts.at(-1).date, newest: posts[0].date }));
