// Playlist import from other services (Spotify embed page, Musi share link).
// Lives here, not in the app, because these are scraped formats that change
// without notice. Output: {ok, source, name, tracks:[{title, artist, album?, durationSec?, videoId?}]}
import { getRules } from './state.js';

function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] == null ? '' : vars[k]));
}

function findEntity(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (Array.isArray(obj.trackList)) return obj;
  for (const k of Object.keys(obj)) {
    const hit = findEntity(obj[k], depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function parseSpotifyEmbed(html) {
  const out = { ok: false, source: 'spotify', name: null, tracks: [] };
  if (typeof html !== 'string') return out;
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return out;
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { return out; }
  const entity = findEntity(data, 0);
  if (!entity) return out;
  out.name = entity.title || entity.name || null;
  const albumName = entity.type === 'album' ? out.name : null;
  for (const t of entity.trackList) {
    if (!t || typeof t.title !== 'string' || !t.title) continue;
    if (t.entityType && t.entityType !== 'track') continue;
    const track = { title: t.title, artist: typeof t.subtitle === 'string' ? t.subtitle.replace(/ /g, ' ') : '' };
    if (albumName) track.album = albumName;
    if (typeof t.duration === 'number' && t.duration > 0) track.durationSec = Math.round(t.duration / 1000);
    out.tracks.push(track);
  }
  // A single track embed has no trackList entries of its own.
  if (!out.tracks.length && entity.type === 'track' && entity.title) {
    const artist = (entity.artists || []).map((a) => a && a.name).filter(Boolean).join(', ') || entity.subtitle || '';
    out.tracks.push({ title: entity.title, artist, durationSec: entity.duration ? Math.round(entity.duration / 1000) : undefined });
  }
  out.ok = out.tracks.length > 0;
  return out;
}

export function parseMusi(body) {
  const out = { ok: false, source: 'musi', name: null, tracks: [] };
  let root = body;
  try { if (typeof root === 'string') root = JSON.parse(root); } catch (e) { return out; }
  if (!root || typeof root !== 'object') return out;
  const success = root.success && typeof root.success === 'object' ? root.success : root;
  out.name = success.title || success.name || null;
  let data = success.data;
  try { if (typeof data === 'string') data = JSON.parse(data); } catch (e) { data = null; }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.data) ? data.data : [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const videoId = t.video_id || t.videoId || t.id;
    if (typeof videoId !== 'string' || !/^[\w-]{11}$/.test(videoId)) continue;
    const dur = Number(t.video_duration || t.duration || 0);
    out.tracks.push({
      videoId,
      title: String(t.video_name || t.title || ''),
      artist: String(t.video_creator || t.artist || ''),
      durationSec: dur > 0 ? Math.round(dur) : undefined,
    });
  }
  out.ok = out.tracks.length > 0;
  return out;
}

// -> Promise<result>. Never rejects for "not found"; reason says what went wrong.
export async function importList(url) {
  const cfg = getRules().imports || {};
  const text = String(url || '');
  let m = cfg.spotify && text.match(new RegExp(cfg.spotify.pattern, 'i'));
  if (m) {
    const res = await rifflyFetch(fill(cfg.spotify.embedUrlTemplate, { type: m[1].toLowerCase(), id: m[2] }), { headers: cfg.spotify.headers || {} });
    if (res.status !== 200) return { ok: false, source: 'spotify', name: null, tracks: [], reason: 'http ' + res.status };
    const out = parseSpotifyEmbed(res.body);
    if (!out.ok) out.reason = 'no tracks';
    return out;
  }
  m = cfg.musi && text.match(new RegExp(cfg.musi.pattern, 'i'));
  if (m) {
    const res = await rifflyFetch(fill(cfg.musi.apiUrlTemplate, { id: m[1] }), { headers: cfg.musi.headers || {} });
    if (res.status !== 200) return { ok: false, source: 'musi', name: null, tracks: [], reason: 'http ' + res.status };
    const out = parseMusi(res.body);
    if (!out.ok) out.reason = 'no tracks';
    return out;
  }
  return { ok: false, source: null, name: null, tracks: [], reason: 'unsupported link' };
}
