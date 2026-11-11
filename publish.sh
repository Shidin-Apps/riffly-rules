#!/bin/bash
# Publishes the signed release in this checkout: commit, tag, push, then purge jsDelivr.
#   ./sign.sh <version> [minAppBuild]     first (tests + signed latest.json)
#   ./publish.sh ["commit message"]
# Safe to re-run: with nothing new to push it only repeats the purge (all served files).
# The app reads latest.json from @main, which jsDelivr caches for up to 12 hours, so
# without the purge a release can stay invisible for half a day.
set -euo pipefail
cd "$(dirname "$0")"

SERVED="latest.json rules.json extractor.js po_token.html"
BRANCH=main

TAG="$(node -p 'JSON.parse(require("fs").readFileSync("latest.json","utf8")).tag')"
SLUG="$(git remote get-url origin | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##')"
case "$SLUG" in */*) ;; *) echo "error: cannot derive owner/repo from origin ($SLUG)" >&2; exit 1 ;; esac

# latest.json must describe the files as they are now (i.e. sign.sh ran after the last change).
node -e '
  const fs = require("fs"), crypto = require("crypto");
  const m = JSON.parse(fs.readFileSync("latest.json", "utf8"));
  const bad = Object.keys(m.files).filter((f) =>
    crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") !== m.files[f]);
  if (bad.length) { console.error("error: latest.json is stale for: " + bad.join(", ") + " (run ./sign.sh)"); process.exit(1); }
'

git fetch --quiet origin "$BRANCH"
BEFORE="$(git rev-parse "origin/$BRANCH")"

# A tag is immutable for the app (files are fetched from @<tag>), so an existing tag
# must already hold exactly these served files. Checked before anything is committed.
NEW_TAG=1
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  NEW_TAG=0
  if ! git diff --quiet "$TAG" -- $SERVED; then
    echo "error: served files differ from the existing tag $TAG; run ./sign.sh <next version>" >&2
    exit 1
  fi
fi

git add -A
if ! git diff --cached --quiet; then
  if [ "$NEW_TAG" = 1 ]; then DEFAULT_MSG="chore: release $TAG"; else DEFAULT_MSG="chore: update tooling"; fi
  git commit --quiet -m "${1:-$DEFAULT_MSG}"
fi
[ "$NEW_TAG" = 0 ] || git tag "$TAG"

git push --quiet origin "$BRANCH" "refs/tags/$TAG"
echo "Pushed $SLUG $BRANCH + $TAG ($(git rev-parse --short HEAD))"

# --- jsDelivr purge -------------------------------------------------------------------
# latest.json always; the other served files only when this push changed them
# (all of them on a re-run, where there is no diff to go by).
CHANGED="$(git diff --name-only "$BEFORE" HEAD -- $SERVED)"
[ -n "$CHANGED" ] || CHANGED="$SERVED"

PATHS="@$BRANCH/latest.json"
for f in $CHANGED; do
  [ "$f" = latest.json ] && continue
  PATHS="$PATHS @$BRANCH/$f @$TAG/$f"
done

purge() { # purge <@ref/file>  ->  0 when every CDN provider confirmed the purge
  local url="https://purge.jsdelivr.net/gh/$SLUG$1" body
  if ! body="$(curl -sS --fail-with-body --max-time 30 --retry 2 "$url" 2>&1)"; then
    echo "  FAILED  $1: $(echo "$body" | tr '\n' ' ')"
    return 1
  fi
  PURGE_BODY="$body" node -e '
    let r; try { r = JSON.parse(process.env.PURGE_BODY); } catch { console.log("  FAILED  " + process.argv[1] + ": unreadable response"); process.exit(1); }
    const p = Object.values(r.paths || {})[0] || {};
    const providers = Object.entries(p.providers || {}).map(([k, v]) => k + "=" + (v ? "ok" : "failed")).join(" ");
    const ok = r.status === "finished" && !p.throttled && Object.values(p.providers || {}).every(Boolean);
    console.log("  " + (ok ? "purged " : "FAILED ") + " " + process.argv[1] + "  status=" + r.status +
      (p.throttled ? " throttled" : "") + " " + providers + " id=" + r.id);
    process.exit(ok ? 0 : 1);
  ' "$1"
}

echo "Purging jsDelivr cache:"
FAILED=0
for p in $PATHS; do
  purge "$p" || FAILED=$((FAILED + 1))
done
if [ "$FAILED" -gt 0 ]; then
  echo "warning: $FAILED purge(s) failed. The push itself succeeded; re-run ./publish.sh to purge again." >&2
  exit 2
fi

# Confirm what the CDN hands out now (this is the URL the app polls).
CDN_URL="https://cdn.jsdelivr.net/gh/$SLUG@$BRANCH/latest.json"
SERVED_TAG="$(curl -sS --max-time 30 "$CDN_URL" | node -p 'try { JSON.parse(require("fs").readFileSync(0, "utf8")).tag } catch { "unreadable" }' || echo unreachable)"
if [ "$SERVED_TAG" = "$TAG" ]; then
  echo "Done. $CDN_URL serves $TAG."
else
  echo "warning: $CDN_URL still serves '$SERVED_TAG', expected $TAG. Re-run ./publish.sh in a minute." >&2
  exit 2
fi
