import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadExtractor, fixturesDir } from './lib.mjs';

const T = loadExtractor();
const raw = (name) => fs.readFileSync(path.join(fixturesDir, name + '.json'), 'utf8');
const parse = (kind, name, args) => JSON.parse(T.parse(kind, raw(name), JSON.stringify(args || {})));
const validItem = (it) => {
  assert.ok(it.id, 'item id');
  assert.ok(it.title, 'item title');
  assert.ok(['song', 'video', 'album', 'artist', 'playlist'].includes(it.type), 'item type ' + it.type);
  if (it.type === 'song' || it.type === 'video') assert.match(it.videoId, /^[\w-]{11}$/);
};

test('request descriptors', () => {
  const home = JSON.parse(T.request('home', '{}'));
  assert.equal(home.endpoint, 'browse');
  assert.equal(home.body.browseId, 'FEmusic_home');
  const search = JSON.parse(T.request('search', JSON.stringify({ query: 'x', filter: 'songs' })));
  assert.ok(search.body.params);
  const pl = JSON.parse(T.request('playlist', JSON.stringify({ playlistId: 'PLabc' })));
  assert.equal(pl.body.browseId, 'VLPLabc');
  const player = JSON.parse(T.request('player', JSON.stringify({ videoId: 'abc', client: 'IOS', poToken: 'tok' })));
  assert.equal(player.client, 'IOS');
  assert.equal(player.body.serviceIntegrityDimensions.poToken, 'tok');
  const cont = JSON.parse(T.request('search', JSON.stringify({ continuation: 'TOKEN' })));
  assert.equal(cont.body.continuation, 'TOKEN');
});

test('home shelves', () => {
  const r = parse('home', 'home');
  assert.ok(r.shelves.length >= 1);
  for (const s of r.shelves) {
    assert.ok(s.title);
    assert.ok(s.items.length > 0);
    s.items.forEach(validItem);
  }
  assert.ok(r.continuation, 'home continuation token');
  const rows = r.shelves.find((s) => s.style === 'rows');
  if (rows) assert.ok(rows.items[0].artists?.length, 'row items carry artists');
});

test('charts with countries', () => {
  for (const name of ['charts_global', 'charts_tr']) {
    const r = parse('charts', name);
    assert.ok(r.countries.length > 30, 'country list');
    assert.ok(r.countries.some((c) => c.code === 'TR'));
    assert.ok(r.countries.some((c) => c.code === 'ZZ'));
    assert.equal(r.selected, name === 'charts_tr' ? 'TR' : 'ZZ');
    assert.ok(r.shelves.length >= 2);
    r.shelves.forEach((s) => s.items.forEach(validItem));
    assert.ok(r.shelves.some((s) => s.items.some((i) => i.type === 'artist')));
    assert.ok(r.shelves.some((s) => s.items.some((i) => i.type === 'playlist')));
  }
});

test('search: all', () => {
  const r = parse('search', 'search_all');
  assert.ok(r.items.length >= 10);
  r.items.forEach(validItem);
  const types = new Set(r.items.map((i) => i.type));
  for (const t of ['song', 'album', 'artist', 'playlist', 'video']) assert.ok(types.has(t), 'has ' + t);
  assert.equal(r.items[0].type, 'artist', 'top result card first');
  const song = r.items.find((i) => i.type === 'song');
  assert.equal(song.artists[0].name, 'Tarkan');
});

test('search: filters', () => {
  const expectType = { songs: 'song', videos: 'video', albums: 'album', artists: 'artist', playlists: 'playlist' };
  for (const [filter, type] of Object.entries(expectType)) {
    const r = parse('search', 'search_' + filter, { filter });
    assert.ok(r.items.length >= 5, filter + ' count');
    r.items.forEach(validItem);
    assert.ok(r.items.every((i) => i.type === type), filter + ' all of type ' + type);
    if (filter !== 'artists') assert.ok(r.continuation, filter + ' continuation');
  }
  const songs = parse('search', 'search_songs', { filter: 'songs' });
  const s = songs.items[0];
  assert.ok(s.artists.length >= 1);
  assert.ok(s.album?.name);
  assert.ok(s.durationSec > 0);
  assert.ok(s.thumbnails.length > 0);
  const albums = parse('search', 'search_albums', { filter: 'albums' });
  assert.match(albums.items[0].browseId, /^MPREb_/);
  assert.ok(albums.items[0].year > 1900);
  assert.equal(albums.items[0].artists[0].name, 'Daft Punk');
  const videos = parse('search', 'search_videos', { filter: 'videos' });
  assert.ok(videos.items[0].artists?.length, 'video artist fallback');
});

test('suggestions', () => {
  const r = parse('suggestions', 'suggestions');
  assert.ok(r.suggestions.length >= 3);
  assert.ok(r.suggestions.includes('never gonna give you up'));
});

test('album', () => {
  const r = parse('album', 'album', { browseId: 'MPREb_K8qWMWVqXGi' });
  assert.equal(r.title, 'Random Access Memories');
  assert.equal(r.artists[0].name, 'Daft Punk');
  assert.equal(r.year, 2013);
  assert.equal(r.tracks.length, 13);
  assert.match(r.playlistId, /^OLAK5uy_/);
  for (const t of r.tracks) {
    validItem(t);
    assert.equal(t.album.name, 'Random Access Memories');
    assert.ok(t.thumbnails.length, 'tracks inherit the album cover');
    assert.ok(t.durationSec > 0);
    assert.ok(t.artists.length);
  }
});

test('playlist', () => {
  const r = parse('playlist', 'playlist');
  assert.ok(r.title);
  assert.ok(r.author);
  assert.ok(r.tracks.length >= 50);
  r.tracks.forEach(validItem);
  assert.ok(r.tracks[0].artists.length);
  assert.ok(r.tracks[0].durationSec > 0);
});

test('artist', () => {
  const r = parse('artist', 'artist', { browseId: 'UCuAXFkgsw1L7xaCfnd5JJOw' });
  assert.equal(r.name, 'Rick Astley');
  assert.ok(r.description.length > 50);
  assert.ok(r.thumbnails.length);
  assert.ok(r.shelves.length >= 4);
  r.shelves.forEach((s) => s.items.forEach(validItem));
  const songs = r.shelves[0];
  assert.equal(songs.items[0].type, 'song');
  assert.ok(songs.moreBrowseId);
  assert.ok(r.shelves.some((s) => s.items[0].type === 'album'));
  assert.ok(r.shelves.some((s) => s.items[0].type === 'artist'));
});

test('next: queue + lyrics id', () => {
  const r = parse('next', 'next');
  assert.ok(r.queue.length >= 10);
  r.queue.forEach(validItem);
  assert.equal(r.current.videoId, 'lYBUbBu4W08');
  assert.match(r.lyricsBrowseId, /^MPLYt/);
  assert.ok(r.continuation);
  assert.ok(r.queue[1].artists.length);
  assert.ok(r.queue[1].durationSec > 0);
});

test('lyrics', () => {
  const r = parse('lyrics', 'lyrics');
  assert.match(r.text, /Never gonna give you up/);
});

test('player parse + audio selection', async () => {
  const p = parse('player', 'player_visionos');
  assert.equal(p.status, 'OK');
  assert.equal(p.details.videoId, 'lYBUbBu4W08');
  assert.ok(p.formats.some((f) => f.itag === 140 && f.url));
  const direct = JSON.parse(await T.resolve(raw('player_visionos'), JSON.stringify({ client: 'VISIONOS', maxKbps: 128 })));
  assert.equal(direct.ok, true);
  assert.equal(direct.kind, 'direct');
  assert.equal(direct.itag, 140);
  assert.ok(direct.expireAt > 1700000000);
  const low = JSON.parse(await T.resolve(raw('player_visionos'), JSON.stringify({ client: 'VISIONOS', maxKbps: 48 })));
  assert.equal(low.itag, 139);
  const pot = JSON.parse(await T.resolve(raw('player_visionos'), JSON.stringify({ client: 'VISIONOS', poToken: 'TOKEN' })));
  assert.match(pot.url, /[?&]pot=TOKEN/);
  const blocked = JSON.parse(await T.resolve(raw('player_web_remix'), JSON.stringify({ client: 'WEB_REMIX' })));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 'UNPLAYABLE');
  assert.ok(blocked.reason);
});

test('hls audio rendition choice', () => {
  const m = [
    '#EXTM3U',
    '#EXT-X-MEDIA:URI="https://x/233",TYPE=AUDIO,GROUP-ID="233",NAME="Default",DEFAULT=YES,AUTOSELECT=YES',
    '#EXT-X-MEDIA:URI="https://x/234",TYPE=AUDIO,GROUP-ID="234",NAME="Default",DEFAULT=YES,AUTOSELECT=YES',
    '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="234"',
    'https://x/v',
  ].join('\n');
  assert.equal(T._pickHlsAudio(m, 128), 'https://x/234');
  assert.equal(T._pickHlsAudio(m, 48), 'https://x/233');
  assert.equal(T._pickHlsAudio('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://x/v', 128), null);
});

test('import: spotify embed page', () => {
  const html = JSON.parse(raw('spotify_embed')).html;
  const out = JSON.parse(T.parse('spotifyEmbed', JSON.stringify(html), '{}'));
  assert.equal(out.ok, true);
  assert.equal(out.source, 'spotify');
  assert.ok(out.name);
  assert.equal(out.tracks.length, 8);
  for (const t of out.tracks) {
    assert.ok(t.title && t.artist, 'title + artist');
    assert.ok(t.durationSec > 30 && t.durationSec < 1200, 'duration in seconds');
  }
  assert.equal(JSON.parse(T.parse('spotifyEmbed', JSON.stringify('<html></html>'), '{}')).ok, false);
});

test('import: musi playlist payloads', () => {
  const inner = { data: [{ video_id: 'dQw4w9WgXcQ', video_name: 'Song', video_creator: 'Artist', video_duration: 213 }, { video_id: 'bad' }] };
  for (const payload of [{ success: { title: 'Mix', data: JSON.stringify(inner) } }, { success: { title: 'Mix', data: inner } }]) {
    const out = JSON.parse(T.parse('musi', JSON.stringify(payload), '{}'));
    assert.equal(out.ok, true);
    assert.equal(out.name, 'Mix');
    assert.deepEqual(out.tracks, [{ videoId: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist', durationSec: 213 }]);
  }
  assert.equal(JSON.parse(T.parse('musi', JSON.stringify({ error: 'No playlist was found matching this code.' }), '{}')).ok, false);
});

test('import: unsupported link resolves with a reason', async () => {
  const out = JSON.parse(await T.importList('https://example.com/x'));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unsupported link');
});

test('lenient: garbage in, empty out, no throw', () => {
  for (const kind of ['home', 'charts', 'browse', 'search', 'suggestions', 'album', 'artist', 'playlist', 'next', 'lyrics', 'player', 'spotifyEmbed', 'musi']) {
    for (const junk of ['{}', '{"contents":{"singleColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[{"somethingNewRenderer":{}},{"musicCarouselShelfRenderer":{"contents":[{"musicTwoRowItemRenderer":{}}]}}]}}}}]}}}', '{"contents":[1,2,3]}']) {
      assert.doesNotThrow(() => T.parse(kind, junk, '{}'), kind);
    }
  }
});

test('account: request + parse (signed in / signed out)', () => {
  const req = JSON.parse(T.request('account', '{}'));
  assert.equal(req.endpoint, 'account/account_menu');
  const lib = JSON.parse(T.request('libraryPlaylists', '{}'));
  assert.equal(lib.body.browseId, 'FEmusic_liked_playlists');
  const signedIn = {
    responseContext: { mainAppWebResponseContext: { datasyncId: '1234567890||', loggedOut: false } },
    actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: {
      accountName: { runs: [{ text: 'Test User' }] }, email: { simpleText: 'test@example.com' }, channelHandle: { runs: [{ text: '@test' }] },
    } } } } } }],
  };
  const a = JSON.parse(T.parse('account', JSON.stringify(signedIn), '{}'));
  assert.deepEqual(a, { signedIn: true, name: 'Test User', email: 'test@example.com', handle: '@test', datasyncId: '1234567890||' });
  const out = JSON.parse(T.parse('account', JSON.stringify({ responseContext: {} }), '{}'));
  assert.equal(out.signedIn, false);
  assert.equal(out.datasyncId, undefined);
});
