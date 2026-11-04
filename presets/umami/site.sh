#!/usr/bin/env bash
# Stands up the site the Umami preset is built from, as presets/umami/README.md describes it.
#
# Usage: presets/umami/site.sh <druxt.js checkout> <site directory> <port>
#
# The site is druxt.js's examples backend at the commit build.json names, with released modules only: its two patches
# come out, core is pinned to the release the preset names, and Decoupled Settings goes in. It serves on 127.0.0.1 at
# the port given, from a SQLite database inside the site directory. The client the build reads with acts as the admin
# account, and its secret is DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET.
set -euo pipefail

druxtjs=${1:?druxt.js checkout}
site=${2:?site directory}
port=${3:?port}
: "${DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET:?set it to the secret the build reads with}"
here=$(cd "$(dirname "$0")" && pwd)
commit=$(node -p "require('$here/build.json').site.druxtjs")
core=$(node -p "require('$here/build.json').site.core")

git -C "$druxtjs" fetch --quiet origin "$commit"
rm -rf "$site"
mkdir -p "$site"
# The tree, not the path: druxt.js export-ignores its examples, and that applies to a path archive.
git -C "$druxtjs" archive "$commit:examples/drupal" | tar -x -C "$site"
site=$(cd "$site" && pwd)
cd "$site"

# Released modules only: a patch no release holds belongs in an overlay.
node -e '
  const fs = require("fs");
  const composer = JSON.parse(fs.readFileSync("composer.json", "utf8"));
  delete composer.extra.patches;
  for (const name of ["drupal/core-recommended", "drupal/core-composer-scaffold", "drupal/core-project-message"]) composer.require[name] = process.argv[1];
  composer.require["drupal/decoupled_settings"] = "1.0.0-beta2";
  composer["require-dev"] = {};
  fs.writeFileSync("composer.json", JSON.stringify(composer, null, 4) + "\n");
' "$core"
rm -rf patches composer.lock
composer update --no-interaction --no-progress --quiet

export DB_FILE="$site/site.sqlite" REQUIRE_TRANSLATIONS=1
php -d memory_limit=-1 .devtools/provision
drush() { vendor/bin/drush "$@"; }
drush en -y decoupled_settings
drush role:perm:add anonymous 'read decoupled settings'
drush role:perm:add authenticated 'read decoupled settings'
# What the frontend reads besides the site's name: the language prefixes, and the theme's settings.
drush php-eval '\Drupal::configFactory()->getEditable("decoupled_settings.settings")->set("exposed_objects", ["system.site", "language.negotiation", "umami.settings"])->save();'

# The client the build reads everything with: the admin account, by a scope that gives the administrator role.
drush php-eval '
  use Drupal\simple_oauth\Entity\Oauth2Scope;
  use Drupal\simple_oauth\Oauth2ScopeInterface;
  Oauth2Scope::load("build") ?: Oauth2Scope::create(["id" => "build", "name" => "build", "description" => "The preset build.", "grant_types" => ["client_credentials" => ["status" => TRUE, "description" => "The preset build."]], "umbrella" => FALSE, "granularity_id" => Oauth2ScopeInterface::GRANULARITY_ROLE, "granularity_configuration" => ["role" => "administrator"]])->save();
  $storage = \Drupal::entityTypeManager()->getStorage("consumer");
  $found = $storage->loadByProperties(["client_id" => "build"]);
  $consumer = reset($found) ?: $storage->create(["client_id" => "build", "label" => "build"]);
  $consumer->set("secret", getenv("DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET"));
  $consumer->set("confidential", TRUE);
  $consumer->set("grant_types", ["client_credentials"]);
  $consumer->set("scopes", [["scope_id" => "build"]]);
  $consumer->set("user_id", 1);
  // A crawl takes longer than the default five minutes, and the build asks for one token.
  $consumer->set("access_token_expiration", 3600);
  $consumer->save();
'
drush cache:rebuild

# From the docroot: the namespaces plugin discovery reads are relative to it.
(cd web && exec php -S "127.0.0.1:$port" -t . .ht.router.php) > "$site/server.log" 2>&1 &
echo "serving $site on http://127.0.0.1:$port, process $!"
