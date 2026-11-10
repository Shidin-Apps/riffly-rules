#!/bin/sh
# Build, test and sign a release: ./sign.sh <version> [minAppBuild]
set -e
cd "$(dirname "$0")"
npm test
node sign.mjs "$@"
