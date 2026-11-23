# decoupled-drupal-mock-mercury

Drupal CMS's Mercury Demo site template as fixtures for `decoupled-drupal-mock`, with Drupal Canvas and its headless content API. The template is the Mercury theme's own showcase. Its Canvas pages place Mercury's components, its cards, sections, headings, buttons and calls to action among them, and the media they show. A frontend that renders Mercury's components has every one of them to test against. It was recorded from a Drupal CMS 2.2.9 install of Mercury Demo 1.1.1, with Mercury 1.0.5, on Drupal 11.4.13. Canvas Headless, Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings are on the site, all from released versions.

The site also has the shared recipe and content in `packages/build/drupal-cms/` applied, so it differs from a plain Mercury Demo install. The recipe enables Canvas Headless and the Druxt module, and grants visitors `access druxt resources` and `read decoupled settings`, so a visitor can read configuration such as displays. It also turns off JSON:API's read-only mode. The content adds one Canvas page, `/canvas-external`, built from components the frontend renders, and `content.php` here adds an unpublished draft of the Home page. Everything else is Mercury Demo's own.

```js
import { createDrupal } from 'decoupled-drupal-mock';
import mercury from 'decoupled-drupal-mock-mercury';

const drupal = createDrupal(mercury(), { baseUrl: 'https://drupal.test' });
const home = await drupal.fetch('https://drupal.test/canvas/content-api?requestUri=/');
```

The package also serves itself over HTTP, with nothing installed first. It takes the same options as `decoupled-drupal-mock serve`:

```sh
npx decoupled-drupal-mock-mercury@alpha --port 3007
```

npm installs the engine with it, as the preset's peer. Where npm skips peers, as with `legacy-peer-deps`, name the engine too:

```sh
npx -p decoupled-drupal-mock@alpha -p decoupled-drupal-mock-mercury@alpha decoupled-drupal-mock-mercury --port 3007
```

Without `--port`, every preset listens on 3005, so give each its own port to run two at once. `start --port 3007` runs it in the background, `status --port 3007` says whether it runs, and `stop --port 3007` ends it. `drupal.fetch` needs Node 18's `Request` and `Response`. On Node 16, use the engine's axios entry point.

The baseline is the site as released modules answer it, and `dump/manifest.json` names each module's version.

## What it answers

Everything the Umami preset answers, from JSON:API, Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings, in English. Mercury Demo's content is Canvas pages. Its one node, the privacy policy page, is unpublished, so a visitor reads an empty `/jsonapi/node/page`. Besides the home page and a component library, it has a page each for Mercury's base, card, hero and layout components. A Canvas page is a `canvas_page--canvas_page` resource, and its system path, such as `/page/6`, resolves through the router. The header and footer every page shares are Mercury's Canvas page variant, `page_variant--page_variant`. The main menu links the component pages, and the footer menu is empty.

Canvas Headless's content API answers for every path the build asked the router about:

| Request                                         | Answer                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/canvas/content-api?requestUri=<path>`         | The page as Canvas renders it, or a `redirect` for a Canvas page's system path and the front page alias |
| `/canvas/content-api?requestUri=<unknown path>` | Canvas's 404 problem document                                                                           |
| `/canvas/content-api?requestUri=<not a path>`   | Canvas's 400 problem document, by Canvas's own rule for what a site-relative path is                    |
| `/canvas/content-api/entity?type=&id=`          | Every Canvas page and node a visitor may see, in its full view mode                                     |
| `/canvas/api/v0/site-data`                      | The site's branding and JSON:API prefix                                                                 |

A query on the content API that the build did not record, such as `requestUri=/home?page=1`, answers as an unknown path. The site's only views are administration views, so the view `/canvas-external` places, `recent_pages`, answers 403 to a visitor, as Drupal does. With no published node on the site, that page has no entity component.

## Draft preview

Mercury Demo's Home page, `/home`, has an edit that is auto-saved and not published. In it, the heading "Visual page building, out of the box" reads "Visual page building, in draft". The heading sits two levels deep. A visitor reads the published page, and a preview token reads the draft, with Canvas's comment markers around each component. The mock gives the preview as Canvas Headless does:

1. Sign `editor` in with a cookie, through `POST /user/login?_format=json`, and fetch `GET /session/token`.
2. `POST /canvas-headless/assertion?path=/home`, or `?entity_type=canvas_page&entity=6`, with the cookie and `X-CSRF-Token`. It answers `{"assertion": "<jwt>"}`.
3. Redeem it at `POST /oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `client_id=canvas_headless` and the assertion, and optionally a PKCE `code_challenge` with `code_challenge_method=S256`. It answers a preview token that lives 900 seconds.
4. Read `/canvas/content-api?requestUri=/` with `Authorization: Bearer <token>`. `/home` is the front page's alias, so the content API answers it with a redirect to `/`.

An assertion is single-use and lives 60 seconds. A renewal, minted with `renewal=1`, redeems only with the `code_verifier` of the challenge the last redemption registered. With the editor's cookie, `GET /canvas-headless/renew?path=/home` redirects to `http://127.0.0.1:3000/api/draft?assertion=<jwt>`, the frontend the site names.

The cookie steps run on a server, such as a frontend's draft route. The mock's CORS answer allows any origin but no credentials, so a browser on another origin cannot send the cookie. With `--cors-credentials` it can, from a loopback origin or one that `--cors-origin` names: see [Running a frontend against the mock](https://github.com/Decipher/decoupled-drupal-mock/blob/1.0.x/README.md#running-a-frontend-against-the-mock).

The assertion's claims are a real one's, with the issuer, audience and renewal URL the build recorded. Its signature is random bytes of an RS256 signature's length. Canvas's SDK reads the claims without checking the signature, as a frontend does. A client that checks it cannot use the mock's.

## Accounts and OAuth clients

The build added these to the site, and the mock signs them in. Each password, and each client's secret, is the same as its name.

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

- **Canvas is held at 1.12.0.** Composer picks Canvas 1.13.0, whose Canvas Headless needs a newer Custom Elements than the recipe allows, so the site does not install. 1.12.0 is the release the other Drupal CMS presets were recorded with.
- **Custom Elements is held at 3.4.1.** Canvas Headless 1.12.0 cannot be enabled with 3.5.0, which Composer picks.
- **SEO Checklist and Checklist API are uninstalled.** With them installed, every request with a Canvas preview token answers 500.
- **`staged_config_update` and `staged_language_config_override` are not recorded.** Canvas refuses any query of these configuration types, so Drupal answers them 500. `build.json` lists them in `skipTypes`, and the mock answers them as an empty collection.

Canvas 1.12.0 also cannot page a configuration collection past its first page. The build reads such a type by id instead and keeps it in Drupal's order, so the dump holds every component, and the mock pages it as Drupal would without that bug.

## A site with more

The preset is the stock site only. A site with a contrib module or a patch the preset lacks records the difference as an overlay of its own, from a build of that site: see [Overlays](https://github.com/Decipher/decoupled-drupal-mock/blob/1.0.x/docs/overlays.md).

## Rebuilding it

`site.sh` stands up the site from `drupal/cms` at the release `build.json` names, with the site template it names under `site`. It installs Mercury Demo, then applies the recipe and the content in `packages/build/drupal-cms/`, which every Drupal CMS preset shares. Every module the recipe installs is pinned to a release in its `composer.json`. The site's address and directory come from the environment, and so does the build client's secret:

```sh
export DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET=$(openssl rand -hex 24)
presets/mercury/site.sh ../mercury-site 8952
DECOUPLED_DRUPAL_MOCK_BASE_URL=http://127.0.0.1:8952 DECOUPLED_DRUPAL_MOCK_SITE=$PWD/../mercury-site yarn crawl presets/mercury/build.json
git fetch origin
yarn rebuild:summary origin/1.0.x
```

The last step prints what the rebuild changed, as for the Umami preset. Canvas Headless is experimental and its API may change without a deprecation path, so expect a rebuild with each Canvas release.

## Published files and evidence

`dump/` is what the mock loads, and what this package publishes. `dump/manifest.json` names the Drupal core version the build came from, the hash of every file, and the hash of every recording the tests replay.

The rest is evidence, kept in the repository and not published. `oracle.txt` lists the requests the build sends to a real Drupal, and `oracle/` stores Drupal's answers, which the engine's tests check against.

Built for [Druxt](https://druxtjs.org).
