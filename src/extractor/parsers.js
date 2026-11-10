import { nav, text, thumbs, compact, findKey, findAll } from './util.js';
import { items, anyItem, listItem, parseRuns, continuationOf, pageType } from './items.js';

function tabSections(json) {
  return (
    nav(json, ['contents', 'singleColumnBrowseResultsRenderer', 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer']) ||
    nav(json, ['contents', 'twoColumnBrowseResultsRenderer', 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer']) ||
    nav(json, ['continuationContents', 'sectionListContinuation']) ||
    null
  );
}

function moreEndpoint(ep) {
  const b = nav(ep, ['browseEndpoint']);
  if (!b || !b.browseId) return {};
  return compact({ moreBrowseId: b.browseId, moreParams: b.params, moreType: pageType(ep) });
}

// One section of a section list -> shelf, or null when we do not understand it.
export function shelf(section, ctx) {
  if (!section || typeof section !== 'object') return null;
  const carousel = section.musicCarouselShelfRenderer;
  if (carousel) {
    const hdr = nav(carousel, ['header', 'musicCarouselShelfBasicHeaderRenderer']) || {};
    const list = items(carousel.contents, ctx);
    if (!list.length) return null;
    const rows = !!nav(carousel, ['contents', 0, 'musicResponsiveListItemRenderer']);
    const more = moreEndpoint(nav(hdr, ['moreContentButton', 'buttonRenderer', 'navigationEndpoint'])) ;
    const viaTitle = moreEndpoint(nav(hdr, ['title', 'runs', 0, 'navigationEndpoint']));
    return compact({
      title: text(hdr.title),
      strapline: text(hdr.strapline),
      style: rows ? 'rows' : 'cards',
      rowsPerColumn: rows ? parseInt(carousel.numItemsPerColumn || '4', 10) || 4 : undefined,
      items: list,
      ...(more.moreBrowseId ? more : viaTitle),
    });
  }
  const s = section.musicShelfRenderer || section.musicPlaylistShelfRenderer;
  if (s && Array.isArray(s.contents)) {
    const list = items(s.contents, ctx);
    if (!list.length) return null;
    return compact({ title: text(s.title), style: 'list', items: list, continuation: continuationOf(s), ...moreEndpoint(s.bottomEndpoint) });
  }
  const grid = section.gridRenderer;
  if (grid) {
    const list = items(grid.items, ctx);
    if (!list.length) return null;
    return compact({ title: text(nav(grid, ['header', 'gridHeaderRenderer', 'title'])), style: 'cards', items: list, continuation: continuationOf(grid) });
  }
  return null;
}

function shelves(list, ctx) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const section of list) {
    let sh = null;
    try { sh = shelf(section, ctx); } catch (e) { sh = null; }
    if (sh) out.push(sh);
  }
  return out;
}

export function parseHome(json) {
  const root = tabSections(json);
  return compact({ shelves: shelves(nav(root, ['contents'])), continuation: continuationOf(root) });
}

function countryCode(entityKey) {
  if (!entityKey) return null;
  try {
    const raw = atobSafe(decodeURIComponent(entityKey));
    const m = raw.match(/country_menu_\d+([A-Z]{2})/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

// JavaScriptCore has no atob; keep a tiny decoder.
function atobSafe(b64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let buffer = 0;
  let bits = 0;
  const clean = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | chars.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

export function parseCharts(json) {
  const root = tabSections(json);
  const contents = nav(root, ['contents']) || [];
  const countries = [];
  let selected;
  const button = findKey(nav(contents, [0]) || {}, 'musicSortFilterButtonRenderer');
  if (button) {
    const selectedTitle = text(button.title);
    const options = nav(button, ['menu', 'musicMultiSelectMenuRenderer', 'options']) || [];
    for (const o of options) {
      const r = o.musicMultiSelectMenuItemRenderer;
      if (!r) continue;
      const code = countryCode(r.formItemEntityKey);
      const title = text(r.title);
      if (!code || !title) continue;
      countries.push({ code, title });
      if (title === selectedTitle) selected = code;
    }
  }
  return compact({ countries, selected, shelves: shelves(contents) });
}

export function parseSearch(json, args) {
  const filter = args && args.filter;
  const ctx = { typeLabel: !filter };
  const out = [];
  const seen = {};
  let continuation;
  const push = (it) => {
    if (!it) return;
    const key = it.type + ':' + it.id;
    if (seen[key]) return;
    seen[key] = true;
    out.push(it);
  };
  const cont = nav(json, ['continuationContents', 'musicShelfContinuation']);
  if (cont) {
    items(cont.contents, ctx).forEach(push);
    return compact({ items: out, continuation: continuationOf(cont) });
  }
  const sections = nav(json, ['contents', 'tabbedSearchResultsRenderer', 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents']) || [];
  for (const section of sections) {
    const card = section.musicCardShelfRenderer;
    if (card) {
      const top = topResult(card);
      push(top);
      // Rows inside the card omit the artist: it is implied by the card itself.
      const implied = top && top.type === 'artist' ? [compact({ name: top.title, id: top.browseId })] : top && top.artists;
      items(card.contents, { ...ctx, artists: implied }).forEach(push);
      continue;
    }
    const shelfNode = section.musicShelfRenderer;
    if (shelfNode) {
      items(shelfNode.contents, ctx).forEach(push);
      if (filter) continuation = continuationOf(shelfNode) || continuation;
      continue;
    }
    const sec = section.itemSectionRenderer;
    if (sec) items(sec.contents, ctx).forEach(push);
  }
  return compact({ items: out, continuation });
}

function topResult(card) {
  const ep = card.onTap || nav(card, ['title', 'runs', 0, 'navigationEndpoint']);
  const fake = { title: card.title, subtitle: card.subtitle, navigationEndpoint: ep, thumbnailRenderer: card.thumbnail };
  const it = anyItem({ musicTwoRowItemRenderer: fake });
  if (it && it.type !== 'artist' && Array.isArray(it.artists) && it.artists.length === 0) delete it.artists;
  return it;
}

export function parseSuggestions(json) {
  const out = [];
  for (const r of findAll(json, 'searchSuggestionRenderer')) {
    const q = nav(r, ['navigationEndpoint', 'searchEndpoint', 'query']) || text(r.suggestion);
    if (q && out.indexOf(q) < 0) out.push(q);
  }
  return { suggestions: out };
}

function header(json) {
  const root = tabSections(json);
  const first = nav(root, ['contents', 0]) || {};
  return (
    first.musicResponsiveHeaderRenderer ||
    nav(first, ['musicEditablePlaylistDetailHeaderRenderer', 'header', 'musicResponsiveHeaderRenderer']) ||
    nav(json, ['header', 'musicDetailHeaderRenderer']) ||
    nav(json, ['header', 'musicResponsiveHeaderRenderer']) ||
    {}
  );
}

function secondary(json) {
  return (
    nav(json, ['contents', 'twoColumnBrowseResultsRenderer', 'secondaryContents', 'sectionListRenderer']) ||
    tabSections(json) ||
    {}
  );
}

function firstPlaylistId(node, prefix) {
  const ids = findAll(node || {}, 'playlistId').filter((x) => typeof x === 'string');
  return ids.find((id) => !prefix || id.indexOf(prefix) === 0) || ids.find((id) => id.indexOf('RDAMPL') !== 0) || ids[0];
}

function yearFrom(str) {
  const m = (str || '').match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : undefined;
}

export function parseAlbum(json, args) {
  const h = header(json);
  const title = text(h.title);
  const strap = parseRuns(nav(h, ['straplineTextOne', 'runs']));
  const sub = parseRuns(nav(h, ['subtitle', 'runs']));
  const artists = strap.artists.length ? strap.artists : strap.plain.length ? [{ name: strap.plain[0] }] : sub.artists;
  const thumbnails = thumbs(h.thumbnail);
  const year = yearFrom(text(h.subtitle));
  const browseId = args && args.browseId;
  const sec = secondary(json);
  const sections = nav(sec, ['contents']) || [];
  const ctx = { album: compact({ name: title, id: browseId }), thumbnails, artists, year, typeLabel: false };
  const trackSection = sections.find((s) => s.musicShelfRenderer || s.musicPlaylistShelfRenderer) || {};
  const trackNode = trackSection.musicShelfRenderer || trackSection.musicPlaylistShelfRenderer || {};
  const tracks = items(trackNode.contents, ctx).filter((t) => t.videoId);
  return compact({
    title,
    subtitle: text(h.subtitle),
    secondSubtitle: text(h.secondSubtitle),
    artists,
    year,
    description: text(nav(h, ['description', 'musicDescriptionShelfRenderer', 'description'])),
    thumbnails,
    browseId,
    playlistId: firstPlaylistId(h.buttons, 'OLAK'),
    tracks,
    shelves: shelves(sections.filter((s) => s !== trackSection)),
  });
}

export function parsePlaylist(json, args) {
  const contShelf =
    nav(json, ['continuationContents', 'musicPlaylistShelfContinuation']) ||
    nav(json, ['continuationContents', 'musicShelfContinuation']);
  if (contShelf) return compact({ tracks: items(contShelf.contents, { typeLabel: false }).filter((t) => t.videoId), continuation: continuationOf(contShelf) });
  const appended = nav(json, ['onResponseReceivedActions', 0, 'appendContinuationItemsAction']);
  if (appended) return compact({ tracks: items(appended.continuationItems, { typeLabel: false }).filter((t) => t.videoId), continuation: continuationOf(appended) });

  const h = header(json);
  const sec = secondary(json);
  const sections = nav(sec, ['contents']) || [];
  const trackSection = sections.find((s) => s.musicPlaylistShelfRenderer || s.musicShelfRenderer) || {};
  const node = trackSection.musicPlaylistShelfRenderer || trackSection.musicShelfRenderer || {};
  const strap = parseRuns(nav(h, ['straplineTextOne', 'runs']));
  const author =
    nav(h, ['facepile', 'avatarStackViewModel', 'text', 'content']) ||
    (strap.artists[0] && strap.artists[0].name) ||
    strap.plain[0];
  return compact({
    title: text(h.title),
    subtitle: text(h.subtitle),
    secondSubtitle: text(h.secondSubtitle),
    author,
    description: text(nav(h, ['description', 'musicDescriptionShelfRenderer', 'description'])),
    thumbnails: thumbs(h.thumbnail),
    playlistId: node.playlistId || (args && args.playlistId),
    tracks: items(node.contents, { typeLabel: false }).filter((t) => t.videoId),
    continuation: continuationOf(node) || continuationOf(sec),
  });
}

export function parseArtist(json, args) {
  const h =
    nav(json, ['header', 'musicImmersiveHeaderRenderer']) ||
    nav(json, ['header', 'musicVisualHeaderRenderer']) ||
    nav(json, ['header', 'musicHeaderRenderer']) ||
    {};
  const root = tabSections(json);
  const sections = nav(root, ['contents']) || [];
  const about = (sections.find((s) => s.musicDescriptionShelfRenderer) || {}).musicDescriptionShelfRenderer;
  const name = text(h.title);
  const list = shelves(sections, { typeLabel: false });
  return compact({
    name,
    browseId: args && args.browseId,
    description: text(h.description) || text(about && about.description),
    thumbnails: thumbs(h.thumbnail) .concat(thumbs(h.foregroundThumbnail)),
    subscribers: text(nav(h, ['subscriptionButton', 'subscribeButtonRenderer', 'subscriberCountText'])),
    monthlyListeners: text(h.monthlyListenerCount),
    shufflePlaylistId: firstPlaylistId(h.playButton),
    radioPlaylistId: firstPlaylistId(h.startRadioButton),
    shelves: list,
  });
}

export function parseBrowse(json) {
  // Generic "see all" page: any mix of shelves / grids, plus continuations.
  const cont =
    nav(json, ['continuationContents', 'musicShelfContinuation']) ||
    nav(json, ['continuationContents', 'musicPlaylistShelfContinuation']) ||
    nav(json, ['continuationContents', 'gridContinuation']);
  if (cont) return compact({ shelves: [compact({ style: 'list', items: items(cont.contents || cont.items), continuation: continuationOf(cont) })] });
  const root = tabSections(json) || secondary(json);
  return compact({ title: text(nav(json, ['header', 'musicHeaderRenderer', 'title'])), shelves: shelves(nav(root, ['contents'])), continuation: continuationOf(root) });
}

export function parseNext(json) {
  const cont = nav(json, ['continuationContents', 'playlistPanelContinuation']);
  if (cont) return compact({ queue: items(cont.contents), continuation: continuationOf(cont) });
  const tabs = nav(json, ['contents', 'singleColumnMusicWatchNextResultsRenderer', 'tabbedRenderer', 'watchNextTabbedResultsRenderer', 'tabs']) || [];
  let lyricsBrowseId;
  let relatedBrowseId;
  for (const t of tabs) {
    const id = nav(t, ['tabRenderer', 'endpoint', 'browseEndpoint', 'browseId']);
    if (!id) continue;
    if (id.indexOf('MPLYt') === 0) lyricsBrowseId = id;
    else if (id.indexOf('MPTRt') === 0) relatedBrowseId = id;
  }
  const panel = nav(tabs, [0, 'tabRenderer', 'content', 'musicQueueRenderer', 'content', 'playlistPanelRenderer']) || findKey(json, 'playlistPanelRenderer') || {};
  const queue = items(panel.contents);
  const currentId = nav(json, ['currentVideoEndpoint', 'watchEndpoint', 'videoId']);
  return compact({
    current: queue.find((q) => q.videoId === currentId) || queue[0],
    queue,
    playlistId: panel.playlistId,
    lyricsBrowseId,
    relatedBrowseId,
    continuation: continuationOf(panel),
  });
}

export function parseLyrics(json) {
  const shelfNode = findKey(json, 'musicDescriptionShelfRenderer');
  if (!shelfNode) return { text: '' };
  return compact({ text: text(shelfNode.description), source: text(shelfNode.footer) }) ;
}
