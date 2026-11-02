# Test runners

Every runner gets the same engine. Reset between tests, because a write stays until then. Each section has a working copy under [`examples/`](../examples), run in CI.

**Jest**, on CommonJS and Node 16 or later, in jsdom or node. Answer axios spies from the engine, so the assertions on their calls keep working. The engine goes in a module of its own, which the tests and any manual mock of axios require:

```js
// test/drupal.js
const { axiosVerbs, loadPreset } = require('decoupled-drupal-mock/jest');

const baseUrl = 'https://drupal.test';
// Read once per test file, even when jest.resetModules() runs this module again.
const drupal = (globalThis.__decoupledDrupalMock ||= loadPreset('umami', { baseUrl }));

module.exports = { baseUrl, drupal, verbs: axiosVerbs(drupal, baseUrl) };
```

The reset goes in the file `setupFilesAfterEnv` names, not beside the engine. Jest refuses a hook from a module first required inside a test, and a manual mock of axios is one after `jest.resetModules()`.

```js
// test/setup.js
const { drupal } = require('./drupal');

afterEach(() => drupal.reset());
```

```js
const mockAxios = require('jest-mock-axios').default;
const { drupal, verbs } = require('./drupal');

mockAxios.get = jest.fn(verbs.get);
mockAxios.patch = jest.fn(verbs.patch);

test('an editor saves a recipe', async () => {
  // reset() revokes every token, so a test mints the one it uses.
  const headers = {
    Authorization: `Bearer ${drupal.tokenFor('editor').access}`,
    'Content-Type': 'application/vnd.api+json',
  };
  // await mockAxios.patch(url, document, { headers }) ...
});
```

A token the mock did not issue, or one from before a reset, is answered 401 with an HTML page, as Drupal answers a revoked one on every route, JSON:API's included.

A client that takes an adapter gets `axios.create({ adapter: axiosAdapter(drupal) })`. For a server shared by the whole run, `globalSetup('umami')` and `globalTeardown` go in the files Jest's config names, and a test reaches it with `connectMock()`.

**Vitest**, or anything else that imports ESM:

```ts
import { startMock } from 'decoupled-drupal-mock/testing';

const mock = await startMock('umami');
afterEach(() => mock.reset());
afterAll(() => mock.close());
// mock.url, await mock.tokenFor('admin'), mock.drupal
```

**Playwright** gets a `drupal` fixture, with a server per worker, reset after each test:

```js
import { test as base } from '@playwright/test';
import { withDrupal } from 'decoupled-drupal-mock/testing';

const test = withDrupal(base, 'umami');
test('a recipe', async ({ page, drupal }) => {
  await page.goto(`${drupal.url}/en/jsonapi/node/recipe`);
});
```

**Cypress** gets tasks, in `setupNodeEvents`:

```js
const { cypressTasks, spawnMock } = require('decoupled-drupal-mock/cypress');

const mock = await spawnMock('umami');
on('task', cypressTasks(mock.url));
on('after:run', () => mock.close());
```

A test then calls `cy.task('drupal:reset')` and `cy.task('drupal:token', { name: 'admin' })`.

**A frontend the runner does not start** points at a server on a port you choose, which `start-server-and-test` can start:

```sh
npx decoupled-drupal-mock serve umami --port 3005 --control
```

Set `DECOUPLED_DRUPAL_MOCK_URL` to its URL and `connectMock()` or `withDrupal` use it. Run one test worker at a time against a shared server, or their writes meet. `--control` opens `POST /__decoupled-drupal-mock/reset` and `/token`. It lets anyone who reaches the port sign in as anyone, so it is for a test's server only.

## Client calls

Every runner's client has the same calls, in-process or over `--control`:

| Call                     | What it does                                                        |
| ------------------------ | ------------------------------------------------------------------- |
| `reset()`                | Drops writes, tokens, scenarios, the request log, and clock changes |
| `tokenFor(name, scopes)` | A token for a user of the preset, past the grant                    |
| `scenario(name)`         | Turns on a scenario an extension names                              |
| `requests()`             | The requests the mock answered, for assertions                      |
| `sent()`                 | What an extension's `onWrite` called                                |
| `advanceTime(seconds)`   | Moves the clock on, for a token's expiry                            |

In Cypress these are the tasks `drupal:reset`, `drupal:token`, `drupal:scenario`, `drupal:requests`, `drupal:sent` and `drupal:time`.

## Next.js

Vitest does not support async Server Components, so a Next.js test runs the site as its own process and points it at the server. `examples/nextjs` does this with Playwright's `webServer`, on a production build. `next-drupal`'s `NEXT_PUBLIC_DRUPAL_BASE_URL` names the mock, and `connectMock(url)` drives it from the test.
