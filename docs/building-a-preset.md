# Building a preset

The build signs in to a running Drupal as an administrator and records every resource the mock serves. It then reads the site as an anonymous visitor to record what a visitor may see. It also records the router lookups, menus, views and decoupled settings, and the oracle, which is the list of real requests and Drupal's answers to them. Finally it replaces the site's address with a placeholder and writes a manifest with the hash of every file.

**The build writes to the site it crawls.** With `identities` and `drush` set, it creates accounts, OAuth scopes and consumers, and with `writesFile` it runs the recorded writes. Run it against a throwaway copy of a site, never production.

## Running it

From the repository root, install and build the engine first, then run the build:

```sh
yarn install
yarn workspace decoupled-drupal-mock build
node --experimental-strip-types packages/build/src/cli.ts build.json
```

A minimal `build.json`:

```json
{
  "baseUrl": "http://127.0.0.1:8906",
  "out": "build/my-site",
  "preset": "my-site",
  "languages": { "en": "" },
  "defaultLanguage": "en",
  "drupal": { "core": "11.2", "profile": "standard", "modules": {} }
}
```

The build writes the dump to `out`, and its recordings beside it in `<out>.oracle/`. Pass the `out` directory to `serve`, `loadPreset` or `startMock` to use it.

| Option                      | What it does                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `languages`                 | Each langcode and its URL prefix, with `""` for a language that has none                                                                                              |
| `auth`                      | `{ tokenUrl, clientId, clientSecret, scope }`, to read as an administrator. See below                                                                                 |
| `oracleFile`, `writesFile`  | The requests to record with Drupal's answers, and the write and sign-in scripts, as in `presets/umami/oracle.txt` and `presets/umami/writes.json`                     |
| `identities`                | The accounts and OAuth consumers the mock signs in. The build creates them on the site first, through drush                                                           |
| `drush`                     | `{ bin, cwd }`. Reads, through `drush php-eval`, the configuration entities JSON:API leaves out for every user, such as a block whose visibility denies every request |
| `excludeUsers`, `skipTypes` | Users to leave out of the dump, such as the build's own account. Types that the site lists in its index but answers with an error                                     |

## Modules and settings on the site

Only JSON:API is required. Everything else widens what the build records:

| On the site                                                            | What it adds                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| JSON:API                                                               | The index, resources, collections and access                                                      |
| Decoupled Router                                                       | Router lookups                                                                                    |
| JSON:API Menu Items, JSON:API Views, Decoupled Settings                | Their routes. If the site answers a route with an error, the build records that error or skips it |
| Core's linkset endpoint, turned on at `/admin/config/services/linkset` | Menu linksets                                                                                     |
| `jsonapi.settings:read_only` set to `false`                            | Writes, for `writesFile`                                                                          |
| The Simple OAuth Password Grant module                                 | The password grant, for an identity with a password                                               |

To read as an administrator, `auth` needs a Simple OAuth 6 consumer with the client credentials grant and a secret, whose user has the administrator role. Its scope must grant the administrator role by role, as a token holds only the roles that the user and the scope both give. The site also needs an OAuth keypair in `simple_oauth.settings`.

## Building without administrator access

Without `auth`, the build records what a visitor sees. When a visitor cannot read a type, Drupal leaves its resources out and lists them in `meta.omitted`. The mock answers that type with an empty list and no `meta.omitted`, and the build log names the type.

## Fixing a build that fails

- **`skipTypes`:** skips types that the site lists in its index but answers with an error.
- **Configuration types with more than one page:** with Drupal Canvas installed, core's configuration entity query is replaced by one that ignores JSON:API's page offset. So the build reads such a type in order of its id after the first page.

## Try it on Drupal CMS

```sh
composer create-project drupal/cms /tmp/drupalcms --no-interaction
cd /tmp/drupalcms
composer require drupal/decoupled_router --no-interaction
php -d memory_limit=-1 vendor/bin/drush site:install -y --db-url=sqlite://localhost//tmp/cms.sqlite --account-pass=admin
php -d memory_limit=-1 vendor/bin/drush en -y jsonapi decoupled_router
cd web && php -d memory_limit=512M -S 127.0.0.1:8906 .ht.router.php
```

The site install needs more memory than PHP allows by default. With the site running, build it with the minimal `build.json` above, which reads it as a visitor.
