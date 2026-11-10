// Normalizes the handful of renderers YouTube Music uses for "a thing in a
// list" into one flat item shape. Unknown renderers return null and are skipped.
import { nav, text, thumbs, parseDuration, compact } from './util.js';

const SEPARATORS = new Set(['', '•', '·', '&', ',', 'and', 'x', '-']);
const COUNT_RE = /^[\d.,]+\s?[KMBkmb]?\s+\S+/; // "36M views", "108 songs"
const YEAR_RE = /^(19|20)\d{2}$/;
const DURATION_RE = /^(\d+:)?\d{1,2}:\d{2}$/;

export function pageType(endpoint) {
  return nav(endpoint, ['browseEndpoint', 'browseEndpointContextSupportedConfigs', 'browseEndpointContextMusicConfig', 'pageType']);
}

function kindOf(pt) {
  switch (pt) {
    case 'MUSIC_PAGE_TYPE_ALBUM':
    case 'MUSIC_PAGE_TYPE_AUDIOBOOK':
      return 'album';
    case 'MUSIC_PAGE_TYPE_ARTIST':
      return 'artist';
    case 'MUSIC_PAGE_TYPE_PLAYLIST':
      return 'playlist';
    default:
      return null;
  }
}

function videoType(endpoint) {
  return nav(endpoint, ['watchEndpoint', 'watchEndpointMusicSupportedConfigs', 'watchEndpointMusicConfig', 'musicVideoType']);
}

// Splits subtitle runs into linked artists, linked album and plain segments.
export function parseRuns(runs) {
  const out = { artists: [], album: null, plain: [] };
  if (!Array.isArray(runs)) return out;
  for (const run of runs) {
    const t = (run.text || '').trim();
    if (SEPARATORS.has(t)) continue;
    const pt = pageType(run.navigationEndpoint);
    const id = nav(run, ['navigationEndpoint', 'browseEndpoint', 'browseId']);
    if (pt === 'MUSIC_PAGE_TYPE_ARTIST' || pt === 'MUSIC_PAGE_TYPE_USER_CHANNEL') out.artists.push(compact({ name: t, id }));
    else if (pt === 'MUSIC_PAGE_TYPE_ALBUM') out.album = compact({ name: t, id });
    else out.plain.push(t);
  }
  return out;
}

function fillFromPlain(item, meta, hasTypeLabel) {
  const plain = meta.plain.slice();
  if (hasTypeLabel && plain.length) plain.shift();
  for (const p of plain) {
    if (DURATION_RE.test(p)) { if (!item.durationSec) item.durationSec = parseDuration(p); continue; }
    if (YEAR_RE.test(p)) { if (!item.year) item.year = parseInt(p, 10); continue; }
  }
  if (!item.artists.length) {
    const guess = plain.find((p) => !DURATION_RE.test(p) && !YEAR_RE.test(p) && !COUNT_RE.test(p));
    if (guess) item.artists = [{ name: guess }];
  }
}

function finish(item) {
  if (!item.title) return null;
  if (item.type === 'playlist' && item.browseId && !item.playlistId) item.playlistId = item.browseId.replace(/^VL/, '');
  item.id = item.videoId || item.browseId || item.playlistId;
  if (!item.id) return null;
  if (!item.artists || !item.artists.length) delete item.artists;
  if (!item.thumbnails || !item.thumbnails.length) delete item.thumbnails;
  return compact(item);
}

// musicResponsiveListItemRenderer: rows in search, charts, albums, playlists, quick picks.
export function listItem(r, ctx) {
  if (!r) return null;
  const c = ctx || {};
  const cols = (r.flexColumns || []).map((col) => nav(col, ['musicResponsiveListItemFlexColumnRenderer', 'text']) || {});
  const title = text(cols[0]);
  const titleEp = nav(cols[0], ['runs', 0, 'navigationEndpoint']);
  const playEp = nav(r, ['overlay', 'musicItemThumbnailOverlayRenderer', 'content', 'musicPlayButtonRenderer', 'playNavigationEndpoint']);
  const watchEp = nav(titleEp, ['watchEndpoint']) ? titleEp : nav(playEp, ['watchEndpoint']) ? playEp : null;
  const videoId = nav(r, ['playlistItemData', 'videoId']) || nav(watchEp, ['watchEndpoint', 'videoId']);
  const navEp = r.navigationEndpoint || titleEp;
  const pt = pageType(navEp);

  let runs = [];
  for (let i = 1; i < cols.length; i++) if (Array.isArray(cols[i].runs)) runs = runs.concat(cols[i].runs, [{ text: '•' }]);
  const meta = parseRuns(runs);
  const fixed = text(nav(r, ['fixedColumns', 0, 'musicResponsiveListItemFixedColumnRenderer', 'text']));
  const item = {
    title,
    subtitle: text(cols[1]),
    artists: meta.artists,
    album: meta.album,
    durationSec: parseDuration(fixed),
    thumbnails: thumbs(r.thumbnail),
    rank: text(nav(r, ['customIndexColumn', 'musicCustomIndexColumnRenderer', 'text'])) || text(r.index),
  };
  const explicit = (r.badges || []).some((b) => nav(b, ['musicInlineBadgeRenderer', 'icon', 'iconType']) === 'MUSIC_EXPLICIT_BADGE');
  if (explicit) item.isExplicit = true;

  if (videoId) {
    const mvt = videoType(watchEp) || videoType(playEp);
    if (mvt === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE') return null;
    item.videoId = videoId;
    item.isVideo = !!mvt && mvt !== 'MUSIC_VIDEO_TYPE_ATV';
    item.type = item.isVideo ? 'video' : 'song';
    if (!item.isVideo) delete item.isVideo;
    fillFromPlain(item, meta, !!c.typeLabel);
  } else {
    const kind = kindOf(pt);
    if (!kind) return null;
    item.type = kind;
    item.browseId = nav(navEp, ['browseEndpoint', 'browseId']);
    if (kind === 'artist') item.artists = [];
    else fillFromPlain(item, meta, c.typeLabel !== false && (kind === 'album' || !!c.typeLabel));
  }
  if (c.album && !item.album && item.videoId) item.album = c.album;
  if (c.thumbnails && !item.thumbnails.length) item.thumbnails = c.thumbnails;
  if (c.artists && !item.artists.length && item.videoId) item.artists = c.artists;
  if (c.year && !item.year && item.videoId) item.year = c.year;
  return finish(item);
}

// musicTwoRowItemRenderer: cards in carousels.
export function twoRowItem(r) {
  if (!r) return null;
  const navEp = r.navigationEndpoint || nav(r, ['title', 'runs', 0, 'navigationEndpoint']);
  const meta = parseRuns(nav(r, ['subtitle', 'runs']));
  const item = { title: text(r.title), subtitle: text(r.subtitle), artists: meta.artists, album: meta.album, thumbnails: thumbs(r.thumbnailRenderer) };
  const videoId = nav(navEp, ['watchEndpoint', 'videoId']);
  if (videoId) {
    const mvt = videoType(navEp);
    if (mvt === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE') return null;
    item.videoId = videoId;
    const wide = r.aspectRatio === 'MUSIC_TWO_ROW_ITEM_THUMBNAIL_ASPECT_RATIO_RECTANGLE_16_9';
    const isVideo = mvt ? mvt !== 'MUSIC_VIDEO_TYPE_ATV' : wide;
    item.type = isVideo ? 'video' : 'song';
    if (isVideo) item.isVideo = true;
    fillFromPlain(item, meta, false);
  } else if (nav(navEp, ['watchPlaylistEndpoint', 'playlistId'])) {
    item.type = 'playlist';
    item.playlistId = navEp.watchPlaylistEndpoint.playlistId;
    fillFromPlain(item, meta, false);
  } else {
    const kind = kindOf(pageType(navEp));
    if (!kind) return null;
    item.type = kind;
    item.browseId = nav(navEp, ['browseEndpoint', 'browseId']);
    if (kind === 'artist') item.artists = [];
    else fillFromPlain(item, meta, meta.plain.length > 1 && !meta.artists.length ? true : false);
  }
  return finish(item);
}

// playlistPanelVideoRenderer: rows of the watch queue ("next" endpoint).
export function panelItem(r) {
  if (!r || !r.videoId) return null;
  const meta = parseRuns(nav(r, ['longBylineText', 'runs']));
  const mvt = videoType(r.navigationEndpoint);
  const item = {
    type: mvt && mvt !== 'MUSIC_VIDEO_TYPE_ATV' ? 'video' : 'song',
    videoId: r.videoId,
    title: text(r.title),
    subtitle: text(r.shortBylineText) || text(r.longBylineText),
    artists: meta.artists,
    album: meta.album,
    durationSec: parseDuration(text(r.lengthText)),
    thumbnails: thumbs(r.thumbnail),
  };
  if (item.type === 'video') item.isVideo = true;
  fillFromPlain(item, meta, false);
  return finish(item);
}

export function anyItem(node, ctx) {
  if (!node || typeof node !== 'object') return null;
  try {
    if (node.musicResponsiveListItemRenderer) return listItem(node.musicResponsiveListItemRenderer, ctx);
    if (node.musicTwoRowItemRenderer) return twoRowItem(node.musicTwoRowItemRenderer);
    if (node.playlistPanelVideoRenderer) return panelItem(node.playlistPanelVideoRenderer);
    const wrapped = nav(node, ['playlistPanelVideoWrapperRenderer', 'primaryRenderer', 'playlistPanelVideoRenderer']);
    if (wrapped) return panelItem(wrapped);
  } catch (e) {
    return null; // one malformed row must not sink the page
  }
  return null;
}

export function items(list, ctx) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const node of list) {
    const it = anyItem(node, ctx);
    if (it) out.push(it);
  }
  return out;
}

export function continuationOf(node) {
  if (!node) return undefined;
  const c = nav(node, ['continuations', 0]);
  const token =
    nav(c, ['nextContinuationData', 'continuation']) ||
    nav(c, ['nextRadioContinuationData', 'continuation']) ||
    nav(c, ['reloadContinuationData', 'continuation']);
  if (token) return token;
  const list = node.contents || node.continuationItems;
  if (Array.isArray(list) && list.length) {
    const last = list[list.length - 1];
    return nav(last, ['continuationItemRenderer', 'continuationEndpoint', 'continuationCommand', 'token']);
  }
  return undefined;
}
