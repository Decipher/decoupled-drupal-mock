# decoupled-drupal-mock-umami

Drupal's Umami demo site as JSON:API fixtures, built from a real Drupal 11 install with Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings, in English and Spanish.

```js
import { createDrupal } from 'decoupled-drupal-mock';
import umami from 'decoupled-drupal-mock-umami';

const drupal = createDrupal(umami(), { baseUrl: 'https://drupal.test' });
const index = await drupal.fetch('https://drupal.test/jsonapi');
```

The backend this was recorded from has two patches that no release of their modules holds, so its router answers are those of a patched site:

- [Decoupled Router #3111456](https://www.drupal.org/i/3111456), which resolves the language from the requested path. Without it, Spanish lookups change and many answer 404, and an English lookup has no `entity.langcode`.
- [Druxt #3273228](https://www.drupal.org/i/3273228), which adds the langcode to the Views router integration.

A recording with and without them differs only in the router's answers and in details of error pages. JSON:API, the index, access and menus are the same.

`dump/` is what the mock loads, and what this package publishes. `dump/manifest.json` names the Drupal core version the build came from and the hash of every file.

The rest is evidence, kept in the repository and not published. `oracle.txt` and `writes.json` are what the build asks a real Drupal, and `oracle/` holds its answers, which the engine's tests are held to.

Built for [Druxt](https://druxtjs.org).
