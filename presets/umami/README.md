# decoupled-drupal-mock-umami

Drupal's Umami demo site as fixtures for `decoupled-drupal-mock`, in English and Spanish. It was recorded from a Drupal 11 install of the `demo_umami` profile, with Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings.

The site also has the Druxt examples recipe from druxt.js applied, so it differs from a plain Umami install. The recipe enables the Druxt module, Simple OAuth and Decoupled Settings, and grants visitors `access druxt resources` and `read decoupled settings`, so a visitor can read configuration such as displays. It also turns off JSON:API's read-only mode, adds `body` to Basic pages and adds image styles. Core's menu linksets are not turned on, so the mock answers them 404, as this site did.

```js
import { createDrupal } from 'decoupled-drupal-mock';
import umami from 'decoupled-drupal-mock-umami';

const drupal = createDrupal(umami(), { baseUrl: 'https://drupal.test' });
const index = await drupal.fetch('https://drupal.test/jsonapi');
```

The baseline is the site as released modules answer it, and `dump/manifest.json` names each module's version.

## Accounts and OAuth clients

The build added these to the site, and the mock signs them in. Each password, and each client's secret, is the same as its name.

| Account  | Role                            |
| -------- | ------------------------------- |
| `admin`  | Administrator, from the install |
| `editor` | Editor                          |
| `author` | Author                          |
| `reader` | None beyond authenticated       |

| OAuth client                   | Grants                                                                                                       | Acts as               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------- |
| `decoupled-drupal-mock`        | Client credentials, refresh token                                                                            | `editor`              |
| `decoupled-drupal-mock-author` | Client credentials                                                                                           | `author`              |
| `decoupled-drupal-mock-reader` | Client credentials                                                                                           | `reader`              |
| `decoupled-drupal-mock-public` | Authorization code with PKCE, refresh token. No secret, and it redirects to `http://127.0.0.1:3000/callback` | The user who signs in |

The password grant is installed too. In a test, `tokenFor('editor')` returns a token for an account directly, without going through a grant.

## A site with more

The preset is the stock site only. A site with a contrib module or a patch the preset lacks records the difference as an overlay of its own, from a build of that site: see [Overlays](../../docs/overlays.md). [`examples/overlays/`](../../examples/overlays) holds three made that way, Druxt's language routing patches among them, which the engine's tests replay. None is published with the preset.

## Published files and evidence

`dump/` is what the mock loads, and what this package publishes. `dump/manifest.json` names the Drupal core version the build came from, the hash of every file, and the hash of every recording the tests replay.

The rest is evidence, kept in the repository and not published. `oracle.txt` and `writes.json` list the requests the build sends to a real Drupal. `oracle/` stores Drupal's answers, and the engine's tests check against them.

Built for [Druxt](https://druxtjs.org).
