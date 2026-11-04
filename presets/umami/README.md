# decoupled-drupal-mock-umami

Drupal's Umami demo site as fixtures for `decoupled-drupal-mock`, in English and Spanish. It was recorded from a Drupal 11 install of the `demo_umami` profile, with Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings, all from released versions.

The site also has the recipe in `recipe/` applied, so it differs from a plain Umami install. It holds what druxt.js's examples need. The recipe enables the Druxt module, Simple OAuth and Decoupled Settings, and grants visitors `access druxt resources` and `read decoupled settings`, so a visitor can read configuration such as displays. It also turns off JSON:API's read-only mode, adds `body` to Basic pages and adds image styles. Core's menu linksets are not turned on, so the mock answers them 404, as this site did.

```js
import { createDrupal } from 'decoupled-drupal-mock';
import umami from 'decoupled-drupal-mock-umami';

const drupal = createDrupal(umami(), { baseUrl: 'https://drupal.test' });
const index = await drupal.fetch('https://drupal.test/jsonapi');
```

The baseline is the site as released modules answer it, and `dump/manifest.json` names each module's version.

## Accounts and OAuth clients

The build added these to the site, and the mock signs them in. Each password, and each client's secret, is the same as its name.

| Account  | Role                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| `admin`  | Administrator, from the install. It has no password here and no OAuth client, so only `tokenFor('admin')` signs it in |
| `editor` | Editor                                                                                                                |
| `author` | Author                                                                                                                |
| `reader` | None beyond authenticated                                                                                             |

| OAuth client                   | Grants                                                                                                       | Acts as               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------- |
| `decoupled-drupal-mock`        | Client credentials, refresh token                                                                            | `editor`              |
| `decoupled-drupal-mock-author` | Client credentials                                                                                           | `author`              |
| `decoupled-drupal-mock-reader` | Client credentials                                                                                           | `reader`              |
| `decoupled-drupal-mock-public` | Authorization code with PKCE, refresh token. No secret, and it redirects to `http://127.0.0.1:3000/callback` | The user who signs in |

The password grant is installed too. In a test, `tokenFor('editor')` returns a token for an account directly, without going through a grant.

## A site with more

The preset is the stock site only. A site with a contrib module or a patch the preset lacks records the difference as an overlay of its own, from a build of that site: see [Overlays](../../docs/overlays.md). [`examples/overlays/`](../../examples/overlays) holds three made that way, Druxt's language routing patches among them, which the engine's tests replay. None is published with the preset.

## Rebuilding it

`site.sh` stands up the site from a stock `drupal/recommended-project` on the core release `build.json` names. It installs the `demo_umami` profile and applies the recipe in `recipe/` over it. Every module the recipe installs is pinned to a release in its `composer.json`. `build.json` is the build's configuration. It reads the site's address, its directory and the build client's secret from the environment, so it doesn't name a machine or hold a secret:

```sh
export DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET=$(openssl rand -hex 24)
presets/umami/site.sh ../umami-site 8906
DECOUPLED_DRUPAL_MOCK_BASE_URL=http://127.0.0.1:8906 DECOUPLED_DRUPAL_MOCK_SITE=$PWD/../umami-site yarn crawl presets/umami/build.json
yarn rebuild:summary --write
```

The last step writes `REBUILD.md`, which says what changed against the dump the branch started from. Read it before committing: the pipeline writes it again and fails when the two differ, so a rebuild merges only with that page beside it. Then move the overlays in `examples/overlays/` onto the new dump, as [Overlays](../../docs/overlays.md) describes, or record them again as [their README](../../examples/overlays/README.md) describes.

## Published files and evidence

`dump/` is what the mock loads, and what this package publishes. `dump/manifest.json` names the Drupal core version the build came from, the hash of every file, and the hash of every recording the tests replay. A manifest with no `format` is format 1, which this engine reads.

The rest is evidence, kept in the repository and not published. `oracle.txt` and `writes.json` list the requests the build sends to a real Drupal. `oracle/` stores Drupal's answers, and the engine's tests check against them.

Built for [Druxt](https://druxtjs.org).
