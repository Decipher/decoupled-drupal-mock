#!/usr/bin/env bash
# Yarn comes through corepack, at the version package.json pins.
set -euo pipefail

corepack enable
corepack install
yarn install
if [ -d packages/engine ]; then
  yarn workspace decoupled-drupal-mock build
fi
