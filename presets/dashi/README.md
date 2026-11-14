# decoupled-drupal-mock-dashi

Drupal CMS's Dashi site template as fixtures for `decoupled-drupal-mock`, with Drupal Canvas and its headless content API. Dashi is a food magazine with Umami's recipes and articles in English and Spanish, with their images, categories, tags and authors, so a frontend has real content to theme and test against. It was recorded from a Drupal CMS 2.2.9 install of Dashi 1.0.1, on Drupal 11.4.12. Canvas Headless, Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings are on the site, all from released versions.

The site also has the shared recipe and content in `packages/build/drupal-cms/` applied, so it differs from a plain Dashi install. The recipe enables Canvas Headless and the Druxt module, and grants visitors `access druxt resources` and `read decoupled settings`, so a visitor can read configuration such as displays. It also turns off JSON:API's read-only mode. The content adds one Canvas page, `/canvas-external`, built from components the frontend renders, and `content.php` here adds an unpublished draft of the About page. Everything else is Dashi's own.

```js
import { createDrupal } from 'decoupled-drupal-mock';
import dashi from 'decoupled-drupal-mock-dashi';

const drupal = createDrupal(dashi(), { baseUrl: 'https://drupal.test' });
const home = await drupal.fetch('https://drupal.test/canvas/content-api?requestUri=/home');
```

The package also serves itself over HTTP, with nothing installed first. It takes the same options as `decoupled-drupal-mock serve`:

```sh
npx decoupled-drupal-mock-dashi@alpha --port 3005
```

The baseline is the site as released modules answer it, and `dump/manifest.json` names each module's version.

## What it answers

Everything the Umami preset answers, from JSON:API, Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings, in English and under `/es` in Spanish. Recipes and articles are nodes, shown through Canvas content templates. A Canvas page is a `canvas_page--canvas_page` resource, and its system path, such as `/page/2`, resolves through the router. The header and footer every page shares are Dashi's Canvas page variant, `page_variant--page_variant`.

Canvas Headless's content API answers for every path the build asked the router about:

| Request                                         | Answer                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/canvas/content-api?requestUri=<path>`         | The page as Canvas renders it, or a `redirect` for a Canvas page's system path and the front page alias |
| `/canvas/content-api?requestUri=<unknown path>` | Canvas's 404 problem document                                                                           |
| `/canvas/content-api?requestUri=<not a path>`   | Canvas's 400 problem document, by Canvas's own rule for what a site-relative path is                    |
| `/canvas/content-api/entity?type=&id=`          | Every Canvas page and node a visitor may see, in its full view mode                                     |
| `/canvas/api/v0/site-data`                      | The site's branding and JSON:API prefix                                                                 |

A query on the content API that the build did not record, such as `requestUri=/home?page=1`, answers as an unknown path. Dashi's privacy policy page is unpublished, so the entity route answers it 403, as Drupal does.

## Draft preview

Dashi's About page, `/about-dashi`, has an edit that is auto-saved and not published: its heading reads "About Dashi, in draft". The heading sits three levels deep, in a group inside a grid inside a section. A visitor reads the published page, and a preview token reads the draft, with Canvas's comment markers around each component. The mock gives the preview as Canvas Headless does:

1. Sign `editor` in with a cookie, through `POST /user/login?_format=json`, and fetch `GET /session/token`.
2. `POST /canvas-headless/assertion?path=/about-dashi`, or `?entity_type=canvas_page&entity=5`, with the cookie and `X-CSRF-Token`. It answers `{"assertion": "<jwt>"}`.
3. Redeem it at `POST /oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `client_id=canvas_headless` and the assertion, and optionally a PKCE `code_challenge`. It answers a preview token that lives 900 seconds.
4. Read `/canvas/content-api?requestUri=/about-dashi` with `Authorization: Bearer <token>`.

An assertion is single-use and lives 60 seconds. A renewal, minted with `renewal=1`, redeems only with the `code_verifier` of the challenge the last redemption registered. `GET /canvas-headless/renew?path=/about-dashi` redirects to `http://127.0.0.1:3000/api/draft?assertion=<jwt>`, the frontend the site names.

The cookie steps run on a server, such as a frontend's draft route. The mock's CORS answer allows any origin but no credentials, so a browser on another origin cannot send the cookie.

The assertion's claims are a real one's, with the issuer, audience and renewal URL the build recorded. Its signature is random bytes of an RS256 signature's length. Canvas's SDK reads the claims without checking the signature, as a frontend does. A client that checks it cannot use the mock's.

## Accounts and OAuth clients

The build added these to the site, and the mock signs them in. Each password, and each client's secret, is the same as its name. Dashi's eight recipe and article authors are on the site too, without passwords.

| Account  | Role                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| `admin`  | Administrator, from the install. It has no password here and no OAuth client, so only `tokenFor('admin')` signs it in |
| `editor` | Content editor, who may preview drafts                                                                                |
| `reader` | None beyond authenticated                                                                                             |

| OAuth client                   | Grants                            | Acts as  |
| ------------------------------ | --------------------------------- | -------- |
| `decoupled-drupal-mock`        | Client credentials, refresh token | `editor` |
| `decoupled-drupal-mock-reader` | Client credentials                | `reader` |

The password grant is not installed. In a test, `tokenFor('editor')` returns a token for an account directly, without going through a grant.

## How it differs from Drupal CMS as installed

Released Drupal CMS packages need these changes to run Canvas Headless. `site.sh` and the recipe make them:

- **Custom Elements is held at 3.4.1.** Canvas Headless 1.12.0 cannot be enabled with 3.5.0, which Composer picks.
- **Canvas Headless is enabled before the recipe.** Installed by a recipe, it leaves out its `canvas_headless` OAuth scope, and no preview token can be issued without it.
- **SEO Checklist and Checklist API are uninstalled.** With them installed, every request with a Canvas preview token answers 500.
- **`staged_config_update` and `staged_language_config_override` are not recorded.** Canvas refuses any query of these configuration types, so Drupal answers them 500. `build.json` lists them in `skipTypes`, and the mock answers them as an empty collection.

Canvas 1.12.0 also cannot page a configuration collection past its first page. The build reads such a type by id instead and keeps it in Drupal's order, so the dump holds every component, and the mock pages it as Drupal would without that bug.

## A site with more

The preset is the stock site only. A site with a contrib module or a patch the preset lacks records the difference as an overlay of its own, from a build of that site: see [Overlays](https://github.com/Decipher/decoupled-drupal-mock/blob/1.0.x/docs/overlays.md).

## Rebuilding it

`site.sh` stands up the site from `drupal/cms` at the release `build.json` names, with the site template it names under `site`. It installs Dashi, then applies the recipe and the content in `packages/build/drupal-cms/`, which every Drupal CMS preset shares. Every module the recipe installs is pinned to a release in its `composer.json`. The site's address and directory come from the environment, and so does the build client's secret:

```sh
export DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET=$(openssl rand -hex 24)
presets/dashi/site.sh ../dashi-site 8907
DECOUPLED_DRUPAL_MOCK_BASE_URL=http://127.0.0.1:8907 DECOUPLED_DRUPAL_MOCK_SITE=$PWD/../dashi-site yarn crawl presets/dashi/build.json
git fetch origin
yarn rebuild:summary origin/1.0.x --write
```

The last step writes `REBUILD.md`, as for the Umami preset. Canvas Headless is experimental and its API may change without a deprecation path, so expect a rebuild with each Canvas release.

## Published files and evidence

`dump/` is what the mock loads, and what this package publishes. `dump/manifest.json` names the Drupal core version the build came from, the hash of every file, and the hash of every recording the tests replay.

The rest is evidence, kept in the repository and not published. `oracle.txt` lists the requests the build sends to a real Drupal, and `oracle/` stores Drupal's answers, which the engine's tests check against.

Built for [Druxt](https://druxtjs.org).
