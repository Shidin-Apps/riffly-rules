// Live check of the PO token path outside the app: BotGuard in jsdom, then the
// WEB_REMIX cipher URL with &pot=. Run: node tests/pot.mjs [videoId]
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { loadExtractor, send, rules, getVisitor, root } from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const UA = rules.innertube.clients.WEB_REMIX.userAgent;
const dom = new JSDOM('<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>', { url: 'https://www.youtube.com/', referrer: 'https://www.youtube.com/', userAgent: UA });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, origin: dom.window.origin });
if (!Reflect.has(globalThis, 'navigator')) Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator });

const out = path.join(root, 'node_modules', '.tonik-po-core.mjs');
await build({ entryPoints: [path.join(root, 'src/po_token/core.js')], bundle: true, format: 'esm', outfile: out, logLevel: 'silent' });
const { createMinter } = await import(pathToFileURL(out).href);

const T = loadExtractor();
const req = (kind, args) => JSON.parse(T.request(kind, JSON.stringify(args || {})));
const videoId = process.argv[2] || 'lYBUbBu4W08';
await send(req('home'));
const t0 = Date.now();
const { minter, estimatedTtlSecs, mintRefreshThreshold } = await createMinter(fetch, rules.poToken.requestKey, globalThis);
console.log(`minter ready in ${Date.now() - t0}ms ttl=${estimatedTtlSecs}s refresh=${mintRefreshThreshold}s`);
const { signatureTimestamp } = JSON.parse(await T.webPlayerInfo());
for (const client of ['WEB_REMIX', 'TV_SIMPLY', 'ANDROID_VR', 'IOS']) {
  for (const [label, binding] of [['videoId', videoId], ['visitorData', getVisitor()]]) {
    const poToken = await minter.mintAsWebsafeString(binding);
    const c = rules.innertube.clients[client];
    const r = await send(req('player', { videoId, client, signatureTimestamp: c.requiresJsPlayer ? signatureTimestamp : undefined, poToken: label === 'visitorData' ? poToken : undefined }));
    const res = JSON.parse(await T.resolve(r.text, JSON.stringify({ client, maxKbps: 128, poToken })));
    let line = `${client} pot(${label}) len=${poToken.length} ok=${res.ok} ${res.ok ? res.kind : res.status + ' ' + res.reason}`;
    if (res.ok && res.kind === 'direct') {
      const g = await fetch(res.url, { headers: { 'User-Agent': c.userAgent, Range: 'bytes=0-1999999' } });
      line += ` GET=${g.status} bytes=${(await g.arrayBuffer()).byteLength}`;
    }
    console.log(line);
  }
}
process.exit(0);
