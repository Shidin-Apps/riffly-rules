// Player response handling: playability, audio format selection, HLS audio
// rendition lookup, video streams for video mode (HLS master or muxed MP4) and
// (for web clients) signature / n-parameter solving.
import { nav, text, thumbs, compact } from './util.js';
import { getRules } from './state.js';

export function parsePlayer(json) {
  const ps = json.playabilityStatus || {};
  const sd = json.streamingData || {};
  const vd = json.videoDetails || {};
  const formats = [];
  for (const f of sd.adaptiveFormats || []) {
    if (!f || typeof f.mimeType !== 'string') continue;
    formats.push(compact({
      itag: f.itag,
      mime: f.mimeType,
      bitrate: f.bitrate,
      audioQuality: f.audioQuality,
      contentLength: f.contentLength ? parseInt(f.contentLength, 10) : undefined,
      url: f.url,
      signatureCipher: f.signatureCipher || f.cipher,
      isDrc: f.isDrc ? true : undefined,
      isOriginal: !f.audioTrack || !!f.audioTrack.audioIsDefault,
      height: f.height,
    }));
  }
  // Progressive files that carry audio and video together (video mode only).
  const muxed = [];
  for (const f of sd.formats || []) {
    if (!f || typeof f.mimeType !== 'string') continue;
    muxed.push(compact({
      itag: f.itag,
      mime: f.mimeType,
      bitrate: f.bitrate,
      contentLength: f.contentLength ? parseInt(f.contentLength, 10) : undefined,
      url: f.url,
      signatureCipher: f.signatureCipher || f.cipher,
      height: f.height,
    }));
  }
  const reason = typeof ps.reason === 'string' ? ps.reason : text(ps.reason);
  const sub = text(nav(ps, ['errorScreen', 'playerErrorMessageRenderer', 'subreason']));
  return compact({
    status: ps.status || 'UNKNOWN',
    reason: sub && sub !== reason ? (reason ? reason + ' ' + sub : sub) : reason,
    details: compact({
      videoId: vd.videoId,
      title: vd.title,
      author: vd.author,
      channelId: vd.channelId,
      lengthSeconds: vd.lengthSeconds ? parseInt(vd.lengthSeconds, 10) : undefined,
      thumbnails: thumbs(vd.thumbnail),
      musicVideoType: vd.musicVideoType,
      isLive: vd.isLiveContent ? true : undefined,
    }),
    expiresInSeconds: sd.expiresInSeconds ? parseInt(sd.expiresInSeconds, 10) : undefined,
    hlsManifestUrl: sd.hlsManifestUrl,
    hasSabr: sd.serverAbrStreamingUrl ? true : undefined,
    formats,
    muxed: muxed.length ? muxed : undefined,
  });
}

// AVPlayer plays H.264 + AAC in MP4; the tallest one that fits the ceiling wins.
export function selectMuxed(muxed, opts) {
  const maxHeight = (opts && opts.maxHeight) || 720;
  const usable = (muxed || []).filter((f) => /^video\/mp4/.test(f.mime) && /avc1/.test(f.mime) && /mp4a/.test(f.mime) && (f.url || f.signatureCipher));
  if (!usable.length) return null;
  const sorted = usable.slice().sort((a, b) => (a.height || 0) - (b.height || 0));
  let pick = sorted[0];
  for (const f of sorted) if ((f.height || 0) <= maxHeight) pick = f;
  return pick;
}

// AVPlayer plays AAC-in-MP4 natively; WebM/Opus is ignored on purpose.
export function selectAudio(formats, opts) {
  const maxKbps = (opts && opts.maxKbps) || 128;
  const usable = (formats || []).filter((f) => f.mime.indexOf('audio/mp4') === 0 && (f.url || f.signatureCipher));
  if (!usable.length) return null;
  const rank = (f) => (f.isOriginal ? 0 : 2) + (f.isDrc ? 1 : 0);
  const best = Math.min.apply(null, usable.map(rank));
  const pool = usable.filter((f) => rank(f) === best).sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
  const ceiling = maxKbps * 1300; // itag 140 reports ~131 kbps for the "128" tier
  let pick = pool[0];
  for (const f of pool) if ((f.bitrate || 0) <= ceiling) pick = f;
  return pick;
}

function queryParam(url, key) {
  const m = url.match(new RegExp('[?&]' + key + '=([^&]*)'));
  return m ? decodeURIComponent(m[1]) : undefined;
}

function setQueryParam(url, key, value) {
  const re = new RegExp('([?&])' + key + '=[^&]*');
  const pair = key + '=' + encodeURIComponent(value);
  if (re.test(url)) return url.replace(re, '$1' + pair);
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + pair;
}

function parseQuery(qs) {
  const out = {};
  for (const part of qs.split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
  }
  return out;
}

// ---- player script (base.js) -------------------------------------------------

let scriptCache = null; // { id, signatureTimestamp, code, preprocessed }

async function loadPlayerScript() {
  const it = getRules().innertube;
  const index = await rifflyFetch(it.playerScriptIndexUrl, {});
  const m = index && index.body && index.body.match(/player\\?\/([0-9a-fA-F]{8})\\?\//);
  if (!m) throw new Error('player id not found');
  if (scriptCache && scriptCache.id === m[1]) return scriptCache;
  const js = await rifflyFetch(it.playerScriptUrlTemplate.replace('{id}', m[1]), {});
  if (!js || js.status !== 200 || !js.body) throw new Error('player script fetch failed');
  const sts = js.body.match(/(?:signatureTimestamp|sts):(\d{5})/);
  scriptCache = { id: m[1], signatureTimestamp: sts ? parseInt(sts[1], 10) : undefined, code: js.body, preprocessed: null };
  return scriptCache;
}

export async function webPlayerInfo() {
  const s = await loadPlayerScript();
  return { playerId: s.id, signatureTimestamp: s.signatureTimestamp };
}

function solve(script, requests) {
  const input = script.preprocessed
    ? { type: 'preprocessed', preprocessed_player: script.preprocessed, requests }
    : { type: 'player', player: script.code, requests, output_preprocessed: true };
  const out = globalThis.__rifflySolver(input);
  if (!out || out.type === 'error') throw new Error('solver: ' + (out && out.error));
  if (out.preprocessed_player) {
    script.preprocessed = out.preprocessed_player;
    script.code = null; // 3 MB we no longer need
  }
  return out.responses || [];
}

async function decipherUrl(format) {
  const script = await loadPlayerScript();
  let url = format.url;
  let sig;
  let sp = 'signature';
  if (!url && format.signatureCipher) {
    const q = parseQuery(format.signatureCipher);
    url = q.url;
    sig = q.s;
    sp = q.sp || sp;
  }
  if (!url) throw new Error('format has no url');
  const n = queryParam(url, 'n');
  const requests = [];
  if (sig) requests.push({ type: 'sig', challenges: [sig] });
  if (n) requests.push({ type: 'n', challenges: [n] });
  if (!requests.length) return url;
  const responses = solve(script, requests);
  let i = 0;
  if (sig) {
    const r = responses[i++];
    if (!r || r.type !== 'result') throw new Error('sig solve failed: ' + (r && r.error));
    url = setQueryParam(url, sp, r.data[sig]);
  }
  if (n) {
    const r = responses[i++];
    if (!r || r.type !== 'result') throw new Error('n solve failed: ' + (r && r.error));
    url = setQueryParam(url, 'n', r.data[n]);
  }
  return url;
}

// ---- HLS ----------------------------------------------------------------------

function attr(line, name) {
  const m = line.match(new RegExp(name + '=("([^"]*)"|[^,]*)'));
  return m ? (m[2] !== undefined ? m[2] : m[1]) : undefined;
}

export function pickHlsAudio(manifest, maxKbps) {
  const media = [];
  for (const line of manifest.split('\n')) {
    if (line.indexOf('#EXT-X-MEDIA') !== 0 || line.indexOf('TYPE=AUDIO') < 0) continue;
    const uri = attr(line, 'URI');
    if (!uri) continue;
    media.push({ uri, group: attr(line, 'GROUP-ID') || '', isDefault: attr(line, 'DEFAULT') === 'YES' });
  }
  if (!media.length) return null;
  const defaults = media.filter((m) => m.isDefault);
  const pool = (defaults.length ? defaults : media).slice().sort((a, b) => (parseInt(a.group, 10) || 0) - (parseInt(b.group, 10) || 0));
  return (maxKbps || 128) < 100 ? pool[0].uri : pool[pool.length - 1].uri;
}

// ---- resolve --------------------------------------------------------------------

export async function resolve(json, opts) {
  const o = opts || {};
  const p = parsePlayer(json);
  const base = { client: o.client, details: p.details };
  if (p.status !== 'OK') return { ok: false, status: p.status, reason: p.reason || '', ...base };
  const clientRules = (getRules().innertube.clients || {})[o.client] || {};
  const pick = selectAudio(p.formats, o);
  const expires = p.expiresInSeconds || 0;
  const done = (kind, url, extra) => {
    const expire = queryParam(url, 'expire') || (url.match(/\/expire\/(\d+)/) || [])[1];
    return { ok: true, kind, url, expiresInSeconds: expires, expireAt: expire ? parseInt(expire, 10) : undefined, userAgent: clientRules.userAgent, ...base, ...(extra || {}) };
  };
  const errors = [];

  if (o.wantVideo) {
    // Video mode: an HLS master playlist (adaptive, audio + video), else a muxed MP4.
    if (p.hlsManifestUrl && o.allowHls !== false) {
      try {
        let manifestUrl = p.hlsManifestUrl;
        if (o.poToken) manifestUrl = manifestUrl.replace(/\/?$/, '') + '/pot/' + o.poToken;
        const res = await rifflyFetch(manifestUrl, { headers: { 'User-Agent': clientRules.userAgent || '' } });
        if (res && res.status === 200 && res.body && res.body.indexOf('#EXT-X-STREAM-INF') >= 0) {
          return done('hls', manifestUrl, { mime: 'application/x-mpegURL', hasVideo: true });
        }
        errors.push(res && res.status === 200 ? 'hls manifest has no video variants' : 'hls manifest http ' + (res && res.status));
      } catch (e) {
        errors.push('hls: ' + e);
      }
    }
    const video = selectMuxed(p.muxed, o);
    if (video) {
      try {
        let url = video.url && !clientRules.requiresJsPlayer ? video.url : await decipherUrl(video);
        if (o.poToken) url = setQueryParam(url, 'pot', o.poToken);
        return done('direct', url, { itag: video.itag, mime: video.mime, bitrate: video.bitrate, contentLength: video.contentLength, height: video.height, hasVideo: true });
      } catch (e) {
        errors.push('cipher: ' + e);
      }
    }
    return { ok: false, status: 'NO_VIDEO_STREAM', reason: errors.join('; ') || 'no playable video format', ...base };
  }

  if (pick && pick.url && !clientRules.requiresJsPlayer) {
    let url = pick.url;
    if (o.poToken) url = setQueryParam(url, 'pot', o.poToken);
    return done('direct', url, { itag: pick.itag, mime: pick.mime, bitrate: pick.bitrate, contentLength: pick.contentLength });
  }
  if (p.hlsManifestUrl && o.allowHls !== false) {
    try {
      let manifestUrl = p.hlsManifestUrl;
      if (o.poToken) manifestUrl = manifestUrl.replace(/\/?$/, '') + '/pot/' + o.poToken;
      const res = await rifflyFetch(manifestUrl, { headers: { 'User-Agent': clientRules.userAgent || '' } });
      if (res && res.status === 200 && res.body) {
        const audio = pickHlsAudio(res.body, o.maxKbps);
        if (audio) return done('hls', audio, { mime: 'application/x-mpegURL' });
        if (o.allowMuxedHls) return done('hls', manifestUrl, { mime: 'application/x-mpegURL', muxed: true });
        errors.push('hls manifest has no audio rendition');
      } else errors.push('hls manifest http ' + (res && res.status));
    } catch (e) {
      errors.push('hls: ' + e);
    }
  }
  if (pick && (pick.signatureCipher || pick.url)) {
    try {
      let url = await decipherUrl(pick);
      if (o.poToken) url = setQueryParam(url, 'pot', o.poToken);
      return done('direct', url, { itag: pick.itag, mime: pick.mime, bitrate: pick.bitrate, contentLength: pick.contentLength, deciphered: true });
    } catch (e) {
      errors.push('cipher: ' + e);
    }
  }
  return { ok: false, status: 'NO_STREAM', reason: errors.join('; ') || (p.hasSabr ? 'SABR-only response' : 'no playable audio format'), ...base };
}
