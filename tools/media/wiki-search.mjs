// usage: node wiki-search.mjs "query" [limit]  -> lists Wikimedia Commons audio files with license/author/url/duration
const q = process.argv[2], n = process.argv[3] || 12;
const api = 'https://commons.wikimedia.org/w/api.php?format=json&';
const j = async (p) => (await fetch(api + p)).json();
const s = await j(`action=query&list=search&srnamespace=6&srlimit=${n}&srsearch=${encodeURIComponent(q + ' filetype:audio')}`);
const titles = s.query.search.map((x) => x.title).join('|');
if (!titles) process.exit(0);
const r = await j(`action=query&prop=imageinfo&iiprop=url|extmetadata|size|mime&titles=${encodeURIComponent(titles)}`);
for (const p of Object.values(r.query.pages)) {
  const ii = p.imageinfo?.[0]; if (!ii) continue;
  const m = ii.extmetadata || {};
  console.log([p.title, m.LicenseShortName?.value, (m.Artist?.value || '').replace(/<[^>]*>/g, '').slice(0, 50), ii.size, ii.url].join(' | '));
}
