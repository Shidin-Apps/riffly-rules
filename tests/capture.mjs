// Records live InnerTube responses as fixtures. Run: npm run capture
// Fixtures are scrubbed of tracking params; re-run when YouTube changes shapes.
import fs from 'node:fs';
import path from 'node:path';
import { loadExtractor, send, scrub, fixturesDir } from './lib.mjs';

const T = loadExtractor();
const req = (kind, args) => JSON.parse(T.request(kind, JSON.stringify(args || {})));
async function grab(name, kind, args) {
  const r = await send(req(kind, args));
  if (r.status !== 200 || !r.json) { console.error('FAILED', name, r.status, r.text.slice(0, 200)); return null; }
  fs.writeFileSync(path.join(fixturesDir, name + '.json'), JSON.stringify(scrub(r.json)));
  console.log('saved', name, Math.round(r.text.length / 1024) + 'kB');
  return r.json;
}

const only = process.argv[2];
const want = (n) => !only || n.startsWith(only);
const VIDEO = 'lYBUbBu4W08';            // Rick Astley - Never Gonna Give You Up (ATV)
const ALBUM = 'MPREb_K8qWMWVqXGi';      // Daft Punk - Random Access Memories
const ARTIST = 'UCuAXFkgsw1L7xaCfnd5JJOw';
let PLAYLIST = 'PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i'; // replaced by the global Top 100 chart when available

if (want('home')) await grab('home', 'home');
if (want('charts') || want('playlist')) {
  const g = await grab('charts_global', 'charts', { country: 'ZZ' });
  await grab('charts_tr', 'charts', { country: 'TR' });
  const ids = JSON.stringify(g || {}).match(/"browseId":"VL([\w-]+)"/g) || [];
  if (ids.length) PLAYLIST = ids[ids.length > 1 ? 1 : 0].match(/VL([\w-]+)/)[1];
}
if (want('search')) {
  await grab('search_all', 'search', { query: 'tarkan' });
  for (const f of ['songs', 'videos', 'albums', 'artists', 'playlists']) await grab('search_' + f, 'search', { query: 'daft punk', filter: f });
  await grab('search_empty', 'search', { query: 'zxqvjkwpqqzzxxy1928374', filter: 'songs' });
}
if (want('suggestions')) await grab('suggestions', 'suggestions', { input: 'never gon' });
if (want('album')) await grab('album', 'album', { browseId: ALBUM });
if (want('artist')) await grab('artist', 'artist', { browseId: ARTIST });
if (want('playlist')) await grab('playlist', 'playlist', { playlistId: PLAYLIST });
if (want('next')) {
  const n = await grab('next', 'next', { videoId: VIDEO });
  const tabs = n?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || [];
  const lyricsId = tabs.map((t) => t.tabRenderer?.endpoint?.browseEndpoint?.browseId).find((id) => id && id.startsWith('MPLYt'));
  if (lyricsId) await grab('lyrics', 'lyrics', { browseId: lyricsId });
}
if (want('player')) {
  for (const c of ['VISIONOS', 'IOS', 'ANDROID_VR', 'WEB_REMIX']) {
    const r = await send(req('player', { videoId: VIDEO, client: c }));
    if (r.json) {
      // Stream URLs are bound to this machine's IP and expire; keep the shape, drop nothing else.
      fs.writeFileSync(path.join(fixturesDir, `player_${c.toLowerCase()}.json`), JSON.stringify(scrub(r.json)));
      console.log('saved player', c, r.json.playabilityStatus?.status);
    }
  }
}
