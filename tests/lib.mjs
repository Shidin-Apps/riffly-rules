// Minimal Node InnerTube transport that mirrors what the Swift client does:
// request shape comes from the extractor, context/headers from rules.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const rules = JSON.parse(fs.readFileSync(path.join(root, 'rules.json'), 'utf8'));
export const fixturesDir = path.join(root, 'tests', 'fixtures');

// `fetchImpl` replaces the network for tests that need a canned answer (HLS manifests).
export function loadExtractor(fetchImpl = nodeRifflyFetch) {
  const code = fs.readFileSync(path.join(root, 'extractor.js'), 'utf8');
  const sandbox = { rifflyFetch: fetchImpl, console };
  new Function('globalThis', 'rifflyFetch', 'console', code)(sandbox, fetchImpl, console);
  sandbox.Riffly.configure(JSON.stringify(rules));
  return sandbox.Riffly;
}

export async function nodeRifflyFetch(url, opts = {}) {
  const r = await fetch(url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
  return { status: r.status, body: await r.text() };
}

let visitorData = null;
export function setVisitor(v) { if (v) visitorData = v; }
export function getVisitor() { return visitorData; }

export async function send(req, { hl = 'en', gl = 'US' } = {}) {
  const clientKey = req.client || rules.innertube.catalogClient;
  const c = rules.innertube.clients[clientKey];
  const q = new URLSearchParams(rules.innertube.query);
  for (const [k, v] of Object.entries(req.query || {})) q.set(k, v);
  const url = `https://${c.host}/youtubei/v1/${req.endpoint}?${q}`;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': c.userAgent,
    'X-YouTube-Client-Name': c.nameId,
    'X-YouTube-Client-Version': c.context.clientVersion,
    ...c.headers,
  };
  if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;
  const client = { hl, gl, ...c.context };
  if (visitorData) client.visitorData = visitorData;
  const body = { context: { client, user: { lockedSafetyMode: false } }, ...req.body };
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (json?.responseContext?.visitorData && !visitorData) visitorData = json.responseContext.visitorData;
  return { status: r.status, text, json };
}

// Drop tracking noise so fixtures stay small and diff-friendly.
const DROP = new Set(['visitorData', 'trackingParams', 'clickTrackingParams', 'loggingContext', 'serviceTrackingParams', 'feedbackEndpoint', 'frameworkUpdates']);
const IP = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const IP6 = /\b(?:[0-9a-fA-F]{1,4}(?::|%3A)){3,7}[0-9a-fA-F]{1,4}\b/g;
export function scrub(v) {
  // Stream URLs embed the capturing machine's IP address; never commit that.
  if (typeof v === 'string') return v.indexOf('googlevideo') >= 0 || v.indexOf('ip=') >= 0 || v.indexOf('/ip/') >= 0 ? v.replace(IP, '0.0.0.0').replace(IP6, '0::0') : v;
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!DROP.has(k)) o[k] = scrub(x);
    return o;
  }
  return v;
}
