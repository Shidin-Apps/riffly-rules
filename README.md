# melovy-rules

Remotely updated YouTube adaptation layer for the Melovy iOS app. The app fetches
these files through jsDelivr once a day, verifies the Ed25519 signature in
`latest.json` and swaps them in atomically. Everything YouTube-specific lives
here so a format change never needs an App Store release. Design: `../docs/TECH.md` §11.

| File | Purpose |
|---|---|
| `latest.json` | version, git tag, `minAppBuild`, SHA-256 of each file, signature |
| `rules.json` | InnerTube client table and order, endpoints, search params, thumbnail rules, PO token config, web player rules, help messages |
| `extractor.js` | built bundle for JavaScriptCore: request descriptors, response parsers, format selection, HLS audio pick, signature / n solver |
| `po_token.html` | built BotGuard page (bgutils-js) for a hidden WKWebView |

`extractor.js` and `po_token.html` are build outputs but are committed, because
jsDelivr serves straight from the repository.

## Layout

```
src/extractor/   requests, parsers, player handling (plain ES modules, no DOM, network only via melovyFetch)
src/po_token/    BotGuard -> integrity token -> WebPO minter
vendor/ejs/      yt-dlp/ejs solver (Unlicense) with meriyah (ISC) and astring (MIT)
tests/           node --test parser tests + fixtures (real responses, tracking and IP scrubbed)
```

## Commands

```
npm test              build + parser tests against tests/fixtures
npm run capture       re-record fixtures from the live API
npm run probe         live check: which player client yields a playable audio URL
node tests/pot.mjs    live check of the PO token + cipher path (jsdom)
./sign.sh <version>   test, then write a signed latest.json (key in ~/.melovy/, never in the repo)
```

## Releasing

1. Change `src/` or `rules.json`, run `npm test` and `npm run probe`.
2. `./sign.sh <next version> [minAppBuild]`
3. Commit, `git tag v<version>`, push with tags. The app picks it up within a day
   (or immediately after three consecutive parse failures).

## Extractor contract (called from Swift)

```
Melovy.configure(rulesJson)
Melovy.request(kind, argsJson)          -> {endpoint, body, query?, client?}
Melovy.parse(kind, responseJson, args)  -> normalized JSON
Melovy.resolve(playerJson, optsJson)    -> Promise<{ok, kind: direct|hls, url, ...}>
Melovy.webPlayerInfo()                  -> Promise<{playerId, signatureTimestamp}>
melovyFetch(url, {method, headers, body}) -> Promise<{status, body}>   (provided by the host)
```
