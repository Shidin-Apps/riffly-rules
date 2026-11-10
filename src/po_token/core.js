// BotGuard -> integrity token -> WebPO minter. Shared by the WKWebView page and
// the Node probe (which supplies jsdom globals and Node's fetch).
import { BotGuardClient, getChallenge } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { buildURL, getHeaders } from 'bgutils-js/utils';

export async function createMinter(fetchFunction, requestKey, globalObject) {
  const challenge = await getChallenge({ fetchFunction, requestKey });
  const script = challenge.interpreterJavascript && challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!script) throw new Error('BotGuard interpreter script missing from challenge');
  new Function(script)();
  const client = await BotGuardClient.create({ program: challenge.program, globalName: challenge.globalName, globalObject });
  const webPoSignalOutput = [];
  const botguardResponse = await client.snapshot({ webPoSignalOutput });
  const res = await fetchFunction(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify([requestKey, botguardResponse]),
  });
  if (!res.ok) throw new Error('GenerateIT failed: http ' + res.status);
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await res.json();
  if (!integrityToken) throw new Error('GenerateIT returned no integrity token');
  const minter = await WebPoMinter.create({ integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken }, webPoSignalOutput);
  return { minter, estimatedTtlSecs, mintRefreshThreshold };
}
