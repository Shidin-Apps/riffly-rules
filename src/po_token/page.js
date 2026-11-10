// Runs inside a hidden WKWebView. Network goes through the native bridge so the
// page never depends on CORS; Swift calls melovyPoInit / melovyPoMint.
import { createMinter } from './core.js';

async function bridgeFetch(url, init) {
  const i = init || {};
  const res = await window.webkit.messageHandlers.melovyFetch.postMessage({
    url: String(url),
    method: i.method || 'GET',
    headers: i.headers || {},
    body: typeof i.body === 'string' ? i.body : null,
  });
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    json: async () => JSON.parse(res.body),
    text: async () => res.body,
  };
}

let state = null;

window.melovyPoInit = async function (requestKey) {
  const t0 = Date.now();
  state = await createMinter(bridgeFetch, requestKey, window);
  return JSON.stringify({ estimatedTtlSecs: state.estimatedTtlSecs || 0, mintRefreshThreshold: state.mintRefreshThreshold || 0, elapsedMs: Date.now() - t0 });
};

window.melovyPoMint = async function (identifier) {
  if (!state) throw new Error('melovyPoInit was not called');
  return await state.minter.mintAsWebsafeString(identifier);
};

window.melovyPoReady = true;
