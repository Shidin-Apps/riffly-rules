import { setRules } from './state.js';
import { requests } from './requests.js';
import * as P from './parsers.js';
import { importList, parseSpotifyEmbed, parseMusi } from './imports.js';
import { parsePlayer, resolve, webPlayerInfo, pickHlsAudio } from './player.js';

const parsers = {
  home: P.parseHome,
  charts: P.parseCharts,
  browse: P.parseBrowse,
  search: P.parseSearch,
  suggestions: P.parseSuggestions,
  album: P.parseAlbum,
  artist: P.parseArtist,
  playlist: P.parsePlaylist,
  next: P.parseNext,
  lyrics: P.parseLyrics,
  account: P.parseAccount,
  libraryPlaylists: P.parseBrowse,
  player: parsePlayer,
  spotifyEmbed: parseSpotifyEmbed,
  musi: parseMusi,
};

const Riffly = {
  version: 2,
  configure(rulesJson) {
    setRules(typeof rulesJson === 'string' ? JSON.parse(rulesJson) : rulesJson);
    return true;
  },
  // -> JSON string {endpoint, body, query?, client?}
  request(kind, argsJson) {
    const fn = requests[kind];
    if (!fn) throw new Error('unknown request kind: ' + kind);
    return JSON.stringify(fn(argsJson ? JSON.parse(argsJson) : {}));
  },
  // -> JSON string of the normalized result
  parse(kind, responseJson, argsJson) {
    const fn = parsers[kind];
    if (!fn) throw new Error('unknown parser kind: ' + kind);
    return JSON.stringify(fn(JSON.parse(responseJson), argsJson ? JSON.parse(argsJson) : {}));
  },
  // -> Promise<JSON string>: {ok, kind: direct|hls, url, ...} or {ok:false, status, reason}
  resolve(playerJson, optsJson) {
    return resolve(JSON.parse(playerJson), optsJson ? JSON.parse(optsJson) : {}).then((r) => JSON.stringify(r));
  },
  // -> Promise<JSON string>: {playerId, signatureTimestamp}
  webPlayerInfo() {
    return webPlayerInfo().then((r) => JSON.stringify(r));
  },
  // -> Promise<JSON string>: {ok, source, name, tracks:[...], reason?}
  importList(url) {
    return importList(url).then((r) => JSON.stringify(r));
  },
  _pickHlsAudio: pickHlsAudio,
};

globalThis.Riffly = Riffly;
