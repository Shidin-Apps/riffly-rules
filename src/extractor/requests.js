// Request descriptors. The host app adds context, headers and transport; this
// module only knows which endpoint and which YouTube-specific fields to send.
import { getRules } from './state.js';

function continuation(endpoint, token) {
  return { endpoint, body: { continuation: token }, query: { ctoken: token, continuation: token, type: 'next' } };
}

export const requests = {
  home(a) {
    if (a.continuation) return continuation('browse', a.continuation);
    return { endpoint: 'browse', body: { browseId: getRules().innertube.browse.home } };
  },
  charts(a) {
    const body = { browseId: getRules().innertube.browse.charts };
    if (a.country) body.formData = { selectedValues: [a.country] };
    return { endpoint: 'browse', body };
  },
  browse(a) {
    if (a.continuation) return continuation('browse', a.continuation);
    const body = { browseId: a.browseId };
    if (a.params) body.params = a.params;
    return { endpoint: 'browse', body };
  },
  search(a) {
    if (a.continuation) return continuation('search', a.continuation);
    const body = { query: a.query };
    const params = a.filter && getRules().innertube.searchParams[a.filter];
    if (params) body.params = params;
    return { endpoint: 'search', body };
  },
  suggestions(a) {
    return { endpoint: 'music/get_search_suggestions', body: { input: a.input } };
  },
  album(a) {
    return { endpoint: 'browse', body: { browseId: a.browseId } };
  },
  artist(a) {
    return { endpoint: 'browse', body: { browseId: a.browseId } };
  },
  playlist(a) {
    if (a.continuation) return continuation('browse', a.continuation);
    const prefix = getRules().innertube.browse.playlistPrefix;
    const id = a.playlistId.startsWith(prefix) ? a.playlistId : prefix + a.playlistId;
    return { endpoint: 'browse', body: { browseId: id } };
  },
  next(a) {
    const body = {
      videoId: a.videoId,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
      tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
      watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { hasPersistentPlaylistPanel: true, musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' } },
    };
    // RDAMVM<videoId> is the "song radio" list: gives the autoplay queue.
    body.playlistId = a.playlistId || 'RDAMVM' + a.videoId;
    if (a.params) body.params = a.params;
    return { endpoint: 'next', body };
  },
  lyrics(a) {
    return { endpoint: 'browse', body: { browseId: a.browseId } };
  },
  player(a) {
    const body = { videoId: a.videoId, contentCheckOk: true, racyCheckOk: true };
    const playback = { html5Preference: 'HTML5_PREF_WANTS' };
    if (a.signatureTimestamp) playback.signatureTimestamp = a.signatureTimestamp;
    body.playbackContext = { contentPlaybackContext: playback };
    if (a.poToken) body.serviceIntegrityDimensions = { poToken: a.poToken };
    return { endpoint: 'player', body, client: a.client };
  },
};
