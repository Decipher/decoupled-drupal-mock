# Building a preset

The build crawls a running Drupal as an administrator for the dump and as a visitor for what a visitor may read, records the router lookups, menus, views and decoupled settings, and the oracle, then rewrites the site's origin to a placeholder and writes a manifest with the hash of every file. `packages/build/src/cli.ts` takes a JSON config naming the site, the languages, the credentials and the oracle list.

The engine runs on Node, including under a test runner's jsdom environment. It needs `node:crypto` from its root entry, so it does not run in a browser or a service worker: a browser test reaches it over HTTP.

## What the site needs

Only JSON:API is required. Everything else widens what the build records:

| On the site                                                                       | What it adds                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| JSON:API                                                                          | The index, resources, collections and access                                           |
| Decoupled Router                                                                  | Router lookups                                                                         |
| JSON:API Menu Items, JSON:API Views, Decoupled Settings                           | Their routes. A route the site does not answer is recorded as it answered, or left out |
| `auth`, a Simple OAuth client credentials consumer whose user is an administrator | What a visitor may not read                                                            |
| `drush` in the config                                                             | Resources no user may read through JSON:API, and the GraphQL mapping                   |

## Without `auth`

The build then records what a visitor sees. A type a visitor can read none of is empty in the mock, with no `meta.omitted`, where Drupal lists each omitted resource. The log names each type it leaves out.

## Options that get a build through

- **`skipTypes`:** types to leave out, for a type the site lists in its index and cannot answer.
- **A config type past one page:** Drupal Canvas replaces the config entity query with one that cannot take JSON:API's offset. The build reads such a type by its id instead, when it has read any of it.

## Try it on Drupal CMS

```sh
composer create-project drupal/cms /tmp/drupalcms --no-interaction
cd /tmp/drupalcms
composer require drupal/decoupled_router --no-interaction
php -d memory_limit=-1 vendor/drush/drush/drush.php site:install -y --db-url=sqlite://localhost/tmp/cms.sqlite --account-pass=admin
php -d memory_limit=-1 vendor/drush/drush/drush.php en -y jsonapi decoupled_router
cd web && php -d memory_limit=512M -S 127.0.0.1:8906 .ht.router.php
```

SQLite refuses a long path, and the install needs more than PHP's default memory.
