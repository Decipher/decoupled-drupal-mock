#!/usr/bin/env bash
# Stands up the site the Umami preset is built from, as presets/umami/README.md describes it.
#
# Usage: presets/umami/site.sh <site directory> <port>
#
# A stock drupal/recommended-project at the core release build.json names, installed with the demo_umami profile, and
# then the recipe beside this script. demo_umami adds Spanish itself, with /en and /es path prefixes. The site serves
# on 127.0.0.1 at the port given, from a SQLite database inside the site directory, and writes the server's process id
# to server.pid there. The client the build reads with acts as the admin account, and its secret is
# DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET.
set -euo pipefail

site=${1:?site directory}
port=${2:?port}
: "${DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET:?set it to the secret the build reads with}"
here=$(cd "$(dirname "$0")" && pwd)
core=$(BUILD_JSON="$here/build.json" node -p 'require(process.env.BUILD_JSON).site.core')

# A server already on the port would answer the crawl in this site's place.
if (exec 3<> "/dev/tcp/127.0.0.1/$port") 2> /dev/null; then
  echo "Something already listens on 127.0.0.1:$port. Stop it, or pick another port." >&2
  exit 1
fi
# Only a directory this script built before is removed, by the marker it leaves, so a mistyped path deletes nothing else.
marker=.decoupled-drupal-mock-site
if [ -e "$site" ] && [ -n "$(ls -A "$site")" ] && [ ! -f "$site/$marker" ]; then
  echo "$site holds something other than a site this script built. Name an empty or new directory." >&2
  exit 1
fi
rm -rf "$site"
composer create-project --no-interaction --no-progress --quiet "drupal/recommended-project:$core" "$site"
touch "$site/$marker"
site=$(cd "$site" && pwd)
cd "$site"
# A copy, not a link, so the site holds the recipe it was built with.
composer config repositories.umami '{"type": "path", "url": "'"$here/recipe"'", "options": {"symlink": false}}'
# Only the root package may accept a beta, and the recipe pins one.
composer require --no-interaction --no-progress --quiet drush/drush decoupled-drupal-mock/umami-recipe:@dev drupal/decoupled_settings:1.0.0-beta2@beta

drush() { vendor/bin/drush "$@"; }
drush site:install demo_umami --yes --db-url="sqlite://localhost/$site/site.sqlite" --account-pass="$(openssl rand -hex 12)" --site-name='Druxt examples'
drush recipe "$site/recipes/umami-recipe" --yes

# The image styles' derivatives, so a frontend links to files that exist without an image style token.
drush php-eval '
  $styles = \Drupal\image\Entity\ImageStyle::loadMultiple(["druxt_card_4_3", "druxt_thumb_4_3"]);
  foreach (\Drupal::entityTypeManager()->getStorage("file")->loadMultiple() as $file) {
    if (!in_array($file->getMimeType(), ["image/gif", "image/jpeg", "image/png", "image/webp"], TRUE)) continue;
    foreach ($styles as $style) {
      $derivative = $style->buildUri($file->getFileUri());
      if (!file_exists($derivative) && !$style->createDerivative($file->getFileUri(), $derivative)) throw new \Exception("No " . $style->id() . " derivative of " . $file->getFileUri());
    }
  }
'

# Simple OAuth signs with a keypair outside the docroot.
mkdir -p -m 700 keys
openssl genrsa -out keys/private.key 2048 2> /dev/null
openssl rsa -in keys/private.key -pubout -out keys/public.key 2> /dev/null
chmod 600 keys/private.key
drush config:set --yes simple_oauth.settings private_key "$site/keys/private.key"
drush config:set --yes simple_oauth.settings public_key "$site/keys/public.key"

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
server=$!
# The install takes minutes, and something else may have taken the port meanwhile. The server must be up and answering.
for _ in $(seq 50); do
  kill -0 "$server" 2> /dev/null || break
  if (exec 3<> "/dev/tcp/127.0.0.1/$port") 2> /dev/null; then break; fi
  sleep 0.2
done
if ! kill -0 "$server" 2> /dev/null || ! (exec 3<> "/dev/tcp/127.0.0.1/$port") 2> /dev/null; then
  echo "The server did not start on 127.0.0.1:$port. $site/server.log says why." >&2
  # A server that runs but does not answer would keep the port, and nothing else knows its process id.
  kill "$server" 2> /dev/null || true
  wait "$server" 2> /dev/null || true
  exit 1
fi
echo "$server" > "$site/server.pid"
echo "serving $site on http://127.0.0.1:$port, process $server"
