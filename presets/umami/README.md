# decoupled-drupal-mock-umami

Drupal's Umami demo site as fixtures for `decoupled-drupal-mock`, in English and Spanish. It was recorded from a Drupal 11 install of the `demo_umami` profile, with Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings.

The site also has the Druxt examples recipe from druxt.js applied, so it differs from a plain Umami install. The recipe enables the Druxt module, Simple OAuth and Decoupled Settings, and grants visitors `access druxt resources` and `read decoupled settings`, so a visitor can read configuration such as displays. It also turns off JSON:API's read-only mode, adds `body` to Basic pages and adds image styles. Core's menu linksets are not turned on, so the mock answers them 404, as this site did.

```js
import { createDrupal } from 'decoupled-drupal-mock';
import umami from 'decoupled-drupal-mock-umami';

const drupal = createDrupal(umami(), { baseUrl: 'https://drupal.test' });
const index = await drupal.fetch('https://drupal.test/jsonapi');
```

The site was recorded with two patches that no released version of either module includes yet, so its router answers are those of a patched site:

- [Decoupled Router #3111456](https://www.drupal.org/i/3111456), which resolves the language from the requested path. Without it, Spanish lookups change and many answer 404, and an English lookup has no `entity.langcode`.
- [Druxt #3273228](https://www.drupal.org/i/3273228), which adds the langcode to the Views router integration.

A recording of the site with and without them differs only in the router's answers and in the details of error pages. JSON:API, the index, access and menus are the same.

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

## Published files and evidence

`dump/` is what the mock loads, and what this package publishes. `dump/manifest.json` names the Drupal core version the build came from and the hash of every file.

The rest is evidence, kept in the repository and not published. `oracle.txt` and `writes.json` list the requests the build sends to a real Drupal. `oracle/` stores Drupal's answers, and the engine's tests check against them.

Built for [Druxt](https://druxtjs.org).
