#!/usr/bin/env bash
# Stands up the site the Dashi preset is built from, as presets/dashi/README.md describes it.
#
# Usage: presets/dashi/site.sh <site directory> <port>
#
# packages/build/drupal-cms/site.sh does the work, from this directory's build.json and content.php.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
exec "$here/../../packages/build/drupal-cms/site.sh" "$here" "$@"
