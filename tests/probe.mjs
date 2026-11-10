// Live health check: which player client actually yields a playable audio URL
// from this network right now, plus a continuation smoke test.
// Run: npm run probe [videoId]
import { loadExtractor, send, rules, getVisitor } from './lib.mjs';

const T = loadExtractor();
const req = (kind, args) => JSON.parse(T.request(kind, JSON.stringify(args || {})));
const videoId = process.argv[2] || 'lYBUbBu4W08';

const home = await send(req('home'));
const homeParsed = JSON.parse(T.parse('home', home.text, '{}'));
console.log(`home: ${homeParsed.shelves.length} shelves, visitor=${getVisitor() ? 'yes' : 'no'}`);
if (homeParsed.continuation) {
  const more = await send(req('home', { continuation: homeParsed.continuation }));
  const p = JSON.parse(T.parse('home', more.text, '{}'));
  console.log(`home continuation: http=${more.status} shelves=${p.shelves.length} [${p.shelves.map((s) => s.title).join(' | ')}]`);
}
const search = await send(req('search', { query: 'sezen aksu', filter: 'songs' }));
const sp = JSON.parse(T.parse('search', search.text, JSON.stringify({ filter: 'songs' })));
if (sp.continuation) {
  const more = await send(req('search', { continuation: sp.continuation }));
  const p = JSON.parse(T.parse('search', more.text, JSON.stringify({ filter: 'songs' })));
  console.log(`search continuation: http=${more.status} items=${p.items.length}`);
}

let sts;
try {
  const info = JSON.parse(await T.webPlayerInfo());
  sts = info.signatureTimestamp;
  console.log(`player script ${info.playerId} sts=${sts}`);
} catch (e) { console.log('player script failed:', String(e)); }

for (const client of Object.keys(rules.innertube.clients)) {
  const c = rules.innertube.clients[client];
  const r = await send(req('player', { videoId, client, signatureTimestamp: c.requiresJsPlayer ? sts : undefined }));
  const t0 = Date.now();
  let out;
  try { out = JSON.parse(await T.resolve(r.text, JSON.stringify({ client, maxKbps: 128 }))); } catch (e) { out = { ok: false, status: 'THROW', reason: String(e) }; }
  let line = `${client.padEnd(11)} http=${r.status} ok=${out.ok} ${out.ok ? `${out.kind} itag=${out.itag || '-'}${out.deciphered ? ' deciphered' : ''} (${Date.now() - t0}ms)` : `${out.status}: ${(out.reason || '').slice(0, 90)}`}`;
  if (out.ok) {
    const headers = { 'User-Agent': c.userAgent };
    if (out.kind === 'direct') {
      const g = await fetch(out.url, { headers: { ...headers, Range: 'bytes=0-1999999' } });
      const bytes = (await g.arrayBuffer()).byteLength;
      line += ` GET=${g.status} bytes=${bytes}`;
    } else {
      const pl = await fetch(out.url, { headers });
      const body = await pl.text();
      const segs = body.split('\n').filter((l) => l.startsWith('http'));
      const s = segs.length ? await fetch(segs[Math.min(3, segs.length - 1)], { headers }) : null;
      line += ` playlist=${pl.status} segments=${segs.length} segment=${s ? s.status : '-'}`;
    }
  }
  console.log(line);
}
