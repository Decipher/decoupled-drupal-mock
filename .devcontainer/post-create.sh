#!/usr/bin/env bash
# Yarn comes through corepack, at the version package.json pins. Then what the browser examples need, so each one runs
# in a fresh container: Chromium and its libraries for Playwright, and Xvfb and the GTK libraries for Cypress.
set -euo pipefail

corepack enable
corepack install
yarn install
if [ -d packages/engine ]; then
  yarn workspace decoupled-drupal-mock build
fi

if [ -d examples/playwright ]; then
  yarn workspace example-playwright playwright install --with-deps chromium
fi
if [ -d examples/cypress ]; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends xvfb libgtk-3-0t64 libgbm1 libnss3 libxss1 libxtst6 libasound2t64
  yarn workspace example-cypress cypress install
fi
