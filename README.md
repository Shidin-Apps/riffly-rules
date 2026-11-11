# riffly-rules

Remotely updated YouTube adaptation layer for the Riffly iOS app. The app fetches
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

## Hosting and identity

The repo is `Shidin-Apps/riffly-rules` (public). The app reads
`https://cdn.jsdelivr.net/gh/Shidin-Apps/riffly-rules@main/latest.json` and then the
files at `@v<version>`; `publish.sh` takes the slug from `origin`, so nothing here
hard-codes it.

Every commit is made as `Shidin <shidin@shidin.com>`; no personal name or e-mail
belongs in this repo, in commits or in files. `publish.sh` forces that identity for
its own commits, and pushes go through the project's GitHub account, never a
personal one. Before committing by hand in a fresh clone:

```
git config user.name "Shidin"
git config user.email "shidin@shidin.com"
```

## Layout

```
src/extractor/   requests, parsers, player handling (plain ES modules, no DOM, network only via rifflyFetch)
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
./sign.sh <version>   test, then write a signed latest.json (key in ~/.riffly/, never in the repo)
./publish.sh          commit, tag, push, purge jsDelivr
```

## Releasing

1. Change `src/` or `rules.json`, run `npm test` and `npm run probe`.
2. `./sign.sh <next version> [minAppBuild]`
3. `./publish.sh ["commit message"]` commits, tags `v<version>`, pushes, then purges
   the jsDelivr cache for `@main/latest.json` and every served file the push changed
   (at `@main` and `@v<version>`), logging each result and the tag the CDN serves
   afterwards. It refuses to run when `latest.json` is stale or the tag already holds
   different files. Exit code 2 means the push went through but a purge did not;
   re-running only repeats the purge. The app picks the release up within a day
   (or immediately after three consecutive parse failures).

## Extractor contract (called from Swift)

```
Riffly.configure(rulesJson)
Riffly.request(kind, argsJson)          -> {endpoint, body, query?, client?}
Riffly.parse(kind, responseJson, args)  -> normalized JSON
Riffly.resolve(playerJson, optsJson)    -> Promise<{ok, kind: direct|hls, url, ...}>
Riffly.webPlayerInfo()                  -> Promise<{playerId, signatureTimestamp}>
rifflyFetch(url, {method, headers, body}) -> Promise<{status, body}>   (provided by the host)
```
