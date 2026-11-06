#!/usr/bin/env bash
# Records one of these overlays again, from a fresh site of the Umami preset with the overlay's recipe applied.
#
# Usage: examples/overlays/record.sh <name> <site directory> <port>
#
# The site is built as presets/umami/site.sh builds the preset's, so set DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET as it
# asks. A recipe's writes.json, when it has one, holds write scripts recorded with the site's answers.
set -euo pipefail

name=${1:?overlay name}
site=${2:?site directory}
port=${3:?port}
root=$(cd "$(dirname "$0")/../.." && pwd)
recipe="$root/examples/overlays/recipes/$name"
[ -f "$recipe/recipe.yml" ] || { echo "No recipe at $recipe." >&2; exit 1; }

"$root/presets/umami/site.sh" "$site" "$port"
site=$(cd "$site" && pwd)
# The site is only needed for this recording: stop its server however the script ends.
trap 'kill "$(cat "$site/server.pid")" 2> /dev/null || true' EXIT
(
  cd "$site"
  composer config "repositories.$name" '{"type": "path", "url": "'"$recipe"'", "options": {"symlink": false}}'
  composer require --no-interaction --no-progress --quiet "decoupled-drupal-mock/$name-recipe:@dev"
  vendor/bin/drush recipe "$site/recipes/$name-recipe" --yes
  vendor/bin/drush cache:rebuild
)

# The preset's configuration, written beside the site's build, with the recipe's write scripts when it has some.
build="$site/build"
node -e '
  const [config, out, writes] = process.argv.slice(1)
  const options = require(config)
  options.out = out
  delete options.oracleOut
  if (require("fs").existsSync(writes)) options.writesFile = writes
  else delete options.writesFile
  console.log(JSON.stringify(options, null, 2))
' "$root/presets/umami/build.json" "$build" "$recipe/writes.json" > "$site/build.json"
cd "$root"
DECOUPLED_DRUPAL_MOCK_BASE_URL="http://127.0.0.1:$port" DECOUPLED_DRUPAL_MOCK_SITE="$site" yarn crawl "$site/build.json"
yarn overlay presets/umami/dump "$build" "$name" examples/overlays
