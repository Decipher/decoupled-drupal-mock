# decoupled-drupal-mock

**Built by a human using an AI assistant.** Much of the code and documentation in this project was written with an AI coding assistant, directed and reviewed by its maintainer. The mock's answers are checked against answers recorded from a real Drupal.

This package answers requests to Drupal's decoupled APIs, such as JSON:API, Decoupled Router, menus and Simple OAuth, without a running Drupal site. The answers come from a preset, which is a recording of a real Drupal site, such as [`decoupled-drupal-mock-umami`](https://www.npmjs.com/package/decoupled-drupal-mock-umami).

```sh
npm install --save-dev decoupled-drupal-mock@alpha decoupled-drupal-mock-umami@alpha
```

```ts
import { createDrupal } from 'decoupled-drupal-mock';
import umami from 'decoupled-drupal-mock-umami';

const drupal = createDrupal(umami(), { baseUrl: 'https://drupal.test' });
const response = await drupal.fetch('https://drupal.test/jsonapi/node/recipe?page[limit]=5');
```

To serve a preset over HTTP for a browser or an end-to-end suite, run its package's command, such as `npx decoupled-drupal-mock-umami@alpha --port 3005`.

The [repository](https://github.com/Decipher/decoupled-drupal-mock) documents how to use the mock from Jest, Vitest, Playwright and Cypress, as an HTTP server, and with extensions and overlays.

GPL-2.0-or-later.
