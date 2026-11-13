# decoupled-drupal-mock-drupal-cms

Drupal CMS as fixtures for `decoupled-drupal-mock`, with Drupal Canvas and its headless content API. It was recorded from a Drupal CMS 2.2.9 install of its Starter site template, on Drupal 11.4.12. Canvas Headless, Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings are on the site, all from released versions.

The site also has the recipe in `recipe/` applied, and the content in `content.php` added, so it differs from a plain Drupal CMS install. The recipe enables Canvas Headless and the Druxt module, and grants visitors `access druxt resources` and `read decoupled settings`, so a visitor can read configuration such as displays. It also turns off JSON:API's read-only mode. The content is two Canvas pages, one with components nested in a section's slots and one built from components the frontend renders, a page node shown through Canvas's content template, a note with no template, and main menu links.

```js
import { createDrupal } from 'decoupled-drupal-mock';
import drupalCms from 'decoupled-drupal-mock-drupal-cms';

const drupal = createDrupal(drupalCms(), { baseUrl: 'https://drupal.test' });
const page = await drupal.fetch('https://drupal.test/canvas/content-api?requestUri=/canvas');
```

The package also serves itself over HTTP, with nothing installed first. It takes the same options as `decoupled-drupal-mock serve`:

```sh
npx decoupled-drupal-mock-drupal-cms@alpha --port 3005
```

The baseline is the site as released modules answer it, and `dump/manifest.json` names each module's version.

## What it answers

Everything the Umami preset answers, from JSON:API, Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings. A Canvas page is a `canvas_page--canvas_page` resource, and its system path, such as `/page/2`, resolves through the router.

Canvas Headless's content API answers for every path the build asked the router about:

| Request                                         | Answer                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/canvas/content-api?requestUri=<path>`         | The page as Canvas renders it, or a `redirect` for a Canvas page's system path and the front page alias |
| `/canvas/content-api?requestUri=<unknown path>` | Canvas's 404 problem document                                                                           |
| `/canvas/content-api?requestUri=<not a path>`   | Canvas's 400 problem document, by Canvas's own rule for what a site-relative path is                    |
| `/canvas/content-api/entity?type=&id=`          | Every Canvas page and node, in its full view mode                                                       |
| `/canvas/api/v0/site-data`                      | The site's branding and JSON:API prefix                                                                 |

A query on the content API that the build did not record, such as `requestUri=/canvas?page=1`, answers as an unknown path.

## Accounts and OAuth clients

The build added these to the site, and the mock signs them in. Each password, and each client's secret, is the same as its name.

| Account  | Role                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| `admin`  | Administrator, from the install. It has no password here and no OAuth client, so only `tokenFor('admin')` signs it in |
| `editor` | Content editor                                                                                                        |
| `reader` | None beyond authenticated                                                                                             |

| OAuth client                   | Grants                            | Acts as  |
| ------------------------------ | --------------------------------- | -------- |
| `decoupled-drupal-mock`        | Client credentials, refresh token | `editor` |
| `decoupled-drupal-mock-reader` | Client credentials                | `reader` |

The password grant is not installed. In a test, `tokenFor('editor')` returns a token for an account directly, without going through a grant.

## How it differs from Drupal CMS as installed

Released Drupal CMS packages need three changes to run Canvas Headless. `site.sh` and the recipe make them:

- **Custom Elements is held at 3.4.1.** Canvas Headless 1.12.0 cannot be enabled with 3.5.0, which Composer picks.
- **SEO Checklist and Checklist API are uninstalled.** With them installed, every request with a Canvas preview token answers 500.
- **`staged_config_update` and `staged_language_config_override` are not recorded.** Canvas refuses any query of these configuration types, so JSON:API answers them 500. `build.json` lists them in `skipTypes`.

Canvas 1.12.0 also cannot page a configuration collection past its first page. The build reads such a type by id instead and keeps it in Drupal's order, so the dump holds every component, and the mock pages it as Drupal would without that bug.

## A site with more

The preset is the stock site only. A site with a contrib module or a patch the preset lacks records the difference as an overlay of its own, from a build of that site: see [Overlays](https://github.com/Decipher/decoupled-drupal-mock/blob/1.0.x/docs/overlays.md).

## Rebuilding it

`site.sh` stands up the site from `drupal/cms` at the release `build.json` names. It installs the Starter site template, applies the recipe in `recipe/` and adds the content in `content.php`. Every module the recipe installs is pinned to a release in its `composer.json`. The site's address and directory come from the environment, and so does the build client's secret:

```sh
export DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET=$(openssl rand -hex 24)
presets/drupal-cms/site.sh ../drupal-cms-site 8907
DECOUPLED_DRUPAL_MOCK_BASE_URL=http://127.0.0.1:8907 DECOUPLED_DRUPAL_MOCK_SITE=$PWD/../drupal-cms-site yarn crawl presets/drupal-cms/build.json
git fetch origin
yarn rebuild:summary origin/1.0.x --write
```

The last step writes `REBUILD.md`, as for the Umami preset. Canvas Headless is experimental and its API may change without a deprecation path, so expect a rebuild with each Canvas release.

## Published files and evidence

`dump/` is what the mock loads, and what this package publishes. `dump/manifest.json` names the Drupal core version the build came from, the hash of every file, and the hash of every recording the tests replay.

The rest is evidence, kept in the repository and not published. `oracle.txt` lists the requests the build sends to a real Drupal, and `oracle/` stores Drupal's answers, which the engine's tests check against.

Built for [Druxt](https://druxtjs.org).
