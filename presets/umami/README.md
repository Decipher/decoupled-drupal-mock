# decoupled-drupal-mock-umami

Drupal's Umami demo site as JSON:API fixtures, built from a real Drupal 11 install with Decoupled Router, JSON:API Menu Items, JSON:API Views and Decoupled Settings, in English and Spanish.

```js
import { createDrupal } from 'decoupled-drupal-mock';
import umami from 'decoupled-drupal-mock-umami';

const drupal = createDrupal(umami(), { baseUrl: 'https://drupal.test' });
const index = await drupal.fetch('https://drupal.test/jsonapi');
```

`dump/manifest.json` names the Drupal core version the build came from and the hash of every file. `oracle.txt` is the query list the build records with Drupal's answers, which the engine's fidelity test holds it to.

Built for [Druxt](https://druxtjs.org).
