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

## Overlays

An overlay is a recording of the same site with one change, kept as the difference from the baseline. `oracle/overlays/` holds that site's real answers, and a test replays them against the baseline plus the overlay.

| Overlay                    | What it is                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `language-routing-patches` | [Decoupled Router #3111456](https://www.drupal.org/i/3111456) and [Druxt #3273228](https://www.drupal.org/i/3273228), which no release holds yet. Stock Decoupled Router cannot resolve many Spanish paths, so a multilingual client needs this |

```sh
npx decoupled-drupal-mock serve umami --overlay language-routing-patches
```

In a test, pass `overlays: ['language-routing-patches']` to `loadPreset`, `startMock` or `spawnMock`.

`dump/` is what the mock loads, and what this package publishes. `dump/manifest.json` names the Drupal core version the build came from and the hash of every file.

The rest is evidence, kept in the repository and not published. `oracle.txt` and `writes.json` list the requests the build sends to a real Drupal. `oracle/` stores Drupal's answers, and the engine's tests check against them.

Built for [Druxt](https://druxtjs.org).
