// Web player page (TECH §5): the HTML that hosts the YouTube IFrame Player API
// inside the app's WKWebView, and the user script that deals with in-page ads.
// Both are generated from `rules.webplayer`, so everything YouTube-specific
// (API URL, player vars, state/error codes, selectors) lives in this repo.
//
// Contract with the app (Core/WebPlayer):
//   page -> app   window.webkit.messageHandlers.rifflyPlayer.postMessage(msg)
//                 {type:'ready'}
//                 {type:'state', state:'playing'|'paused'|'buffering'|'ended'|'idle'}
//                 {type:'time', current:<sec>, duration:<sec>}
//                 {type:'error', code:<number>, reason:<string>}
//   app -> page   RifflyPlayer.load(videoId, startSeconds, autoplay)
//                 RifflyPlayer.play() / pause() / seek(seconds) / stop()
import { getRules } from './state.js';

const STATES = { '-1': 'idle', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'idle' };
const ERRORS = {
  2: 'invalid video id',
  5: 'html5 player error',
  100: 'video not found',
  101: 'embedding disabled',
  150: 'embedding disabled',
  153: 'missing referrer',
};

// JSON that is safe inside an inline <script> block.
function inline(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function pageScript(cfg) {
  return `(function(){
var cfg=${inline(cfg)};
var player=null,ready=false,pending=null,timer=null,lastState='idle';
function post(m){try{window.webkit.messageHandlers.rifflyPlayer.postMessage(m);}catch(e){}}
function num(v){return typeof v==='number'&&isFinite(v)?v:0;}
function tick(){if(!player||!ready)return;try{var d=num(player.getDuration());if(d>0){post({type:'time',current:num(player.getCurrentTime()),duration:d});}}catch(e){}}
function setTimer(on){if(on&&!timer){timer=setInterval(tick,cfg.tick);}else if(!on&&timer){clearInterval(timer);timer=null;}}
function onState(e){var s=cfg.states[String(e&&e.data)]||'idle';lastState=s;setTimer(s==='playing'||s==='buffering');tick();post({type:'state',state:s});}
function onError(e){var c=num(e&&e.data);setTimer(false);post({type:'error',code:c,reason:cfg.errors[String(c)]||'player error'});}
function run(c){
  if(!player||!ready){if(c.name==='load'){pending=c;}else if(c.name==='stop'){pending=null;}else if(pending&&c.name==='seek'){pending.start=c.seconds;}else if(pending&&c.name==='play'){pending.autoplay=true;}else if(pending&&c.name==='pause'){pending.autoplay=false;}return;}
  try{
    if(c.name==='load'){var a={videoId:c.videoId,startSeconds:c.start||0};if(c.autoplay){player.loadVideoById(a);}else{player.cueVideoById(a);}}
    else if(c.name==='play'){player.playVideo();}
    else if(c.name==='pause'){player.pauseVideo();}
    else if(c.name==='seek'){player.seekTo(c.seconds,true);if(lastState!=='playing'){post({type:'time',current:num(c.seconds),duration:num(player.getDuration())});}}
    else if(c.name==='stop'){setTimer(false);player.stopVideo();}
  }catch(e){post({type:'error',code:0,reason:String(e&&e.message||e)});}
}
window.RifflyPlayer={
  load:function(videoId,start,autoplay){run({name:'load',videoId:String(videoId),start:num(start),autoplay:autoplay!==false});},
  play:function(){run({name:'play'});},
  pause:function(){run({name:'pause'});},
  seek:function(seconds){run({name:'seek',seconds:num(seconds)});},
  stop:function(){run({name:'stop'});}
};
window.onYouTubeIframeAPIReady=function(){
  var vars={};for(var k in cfg.playerVars){vars[k]=cfg.playerVars[k];}
  vars.origin=cfg.origin;
  player=new YT.Player('player',{width:'100%',height:'100%',playerVars:vars,events:{
    onReady:function(){ready=true;post({type:'ready'});if(pending){var p=pending;pending=null;run(p);}},
    onStateChange:onState,onError:onError}});
};
var tag=document.createElement('script');tag.src=cfg.api;
tag.onerror=function(){post({type:'error',code:0,reason:'iframe api failed to load'});};
document.head.appendChild(tag);
})();`;
}

function skipScript(w) {
  const cfg = {
    selectors: Array.isArray(w.skipSelectors) ? w.skipSelectors.filter((s) => typeof s === 'string' && s) : [],
    ad: typeof w.adShowingSelector === 'string' ? w.adShowingSelector : '',
    rate: Number(w.adPlaybackRate) > 0 ? Number(w.adPlaybackRate) : 0,
    every: Number(w.skipIntervalMilliseconds) > 0 ? Number(w.skipIntervalMilliseconds) : 500,
  };
  return `(function(){
var cfg=${JSON.stringify(cfg)};
function visible(el){return !!el&&el.getClientRects().length>0;}
function sweep(){try{
  for(var i=0;i<cfg.selectors.length;i++){var els=document.querySelectorAll(cfg.selectors[i]);for(var j=0;j<els.length;j++){if(visible(els[j])){els[j].click();}}}
  if(cfg.ad&&cfg.rate){var v=document.querySelector(cfg.ad);if(v&&v.playbackRate!==cfg.rate){v.playbackRate=cfg.rate;}}
}catch(e){}}
setInterval(sweep,cfg.every);
})();`;
}

// -> {ok:true, origin, html, userScript} or {ok:false, reason}
export function webPlayerPage() {
  const w = getRules().webplayer || {};
  if (typeof w.origin !== 'string' || !/^https:\/\//.test(w.origin) || typeof w.iframeApiUrl !== 'string' || !/^https:\/\//.test(w.iframeApiUrl)) {
    return { ok: false, reason: 'webplayer rules missing' };
  }
  const cfg = {
    origin: w.origin.replace(/\/+$/, ''),
    api: w.iframeApiUrl,
    playerVars: w.playerVars && typeof w.playerVars === 'object' ? w.playerVars : {},
    tick: Number(w.tickMilliseconds) > 0 ? Number(w.tickMilliseconds) : 500,
    states: STATES,
    errors: ERRORS,
  };
  const html = [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    '<style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}#player,iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style>',
    '</head><body><div id="player"></div>',
    '<script>' + pageScript(cfg) + '</script>',
    '</body></html>',
  ].join('\n');
  return { ok: true, origin: cfg.origin, html, userScript: skipScript(w) };
}
