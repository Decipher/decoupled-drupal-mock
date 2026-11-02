# Test runners

Every runner gets the same engine. Reset it between tests, because a write stays until then. Each section has a working copy under [`examples/`](../examples), which CI runs.

The engine answers as the stock site does. A site with contrib modules or patches gets them as overlays, by name: `loadPreset('umami', { overlays: ['language-routing-patches'] })`, and the same option on `startMock`, `spawnMock` and `withDrupal`'s options. A multilingual client needs `language-routing-patches`, as stock Decoupled Router cannot resolve many translated paths. The preset's [README](../presets/umami/README.md#overlays) lists the overlays and what each changes.

**Jest**, on CommonJS and Node 16 or later, in jsdom or node. Answer axios spies from the engine, so the assertions on their calls keep working. The engine goes in a module of its own, which the tests and any manual mock of axios require:

```js
// test/drupal.js
const { axiosVerbs, loadPreset } = require('decoupled-drupal-mock/jest');

const baseUrl = 'https://drupal.test';
// Read once per test file, even when jest.resetModules() runs this module again.
if (!global.__decoupledDrupalMock) {
  global.__decoupledDrupalMock = loadPreset('umami', { baseUrl });
}
const drupal = global.__decoupledDrupalMock;

module.exports = { baseUrl, drupal, verbs: axiosVerbs(drupal, baseUrl) };
```

This uses `global` rather than `globalThis` and `||=`, which an ESLint config at `ecmaVersion: 2020` with only ES2015 globals refuses, as druxt.js 0.x's does.

Put the reset in the file `setupFilesAfterEnv` names, not beside the engine. Jest rejects a hook registered by a module that is first loaded inside a test, and after `jest.resetModules()` a manual mock of axios is loaded that way.

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

A client that takes an adapter gets `axios.create({ adapter: axiosAdapter(drupal) })`. For a server shared by the whole run, give Jest a setup and a teardown file, and reach the server from a test with `connectMock()`:

```js
// test/global-setup.js, named by `globalSetup` in Jest's config
module.exports = require('decoupled-drupal-mock/jest').globalSetup('umami');
// test/global-teardown.js, named by `globalTeardown`
module.exports = require('decoupled-drupal-mock/jest').globalTeardown;
```

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
const { defineConfig } = require('cypress');
const { cypressTasks, spawnMock } = require('decoupled-drupal-mock/cypress');

module.exports = defineConfig({
  e2e: {
    async setupNodeEvents(on, config) {
      const mock = await spawnMock('umami');
      on('task', cypressTasks(mock.url));
      on('after:run', () => mock.close());
      return config;
    },
  },
});
```

A test then calls `cy.task('drupal:reset')` and `cy.task('drupal:token', { name: 'admin' })`.

**Frontends that the runner does not start.** Point the frontend at a mock server on a port you choose. `start-server-and-test` can start that server:

```sh
npx decoupled-drupal-mock serve umami --port 3005 --control
```

Set `DECOUPLED_DRUPAL_MOCK_URL` to its URL, and `connectMock()` and `withDrupal` use it. Run one test worker at a time against a shared server, because one worker's writes are visible to the others. `--control` opens `POST /__decoupled-drupal-mock/reset` and `/token`. Anyone who can reach the port can then sign in as any user, so use it for a test's server only.

## Client calls

Every runner's client has the same calls, in-process or over `--control`:

| Call                     | What it does                                                                    |
| ------------------------ | ------------------------------------------------------------------------------- |
| `reset()`                | Drops writes, tokens, scenarios, the request log, and clock changes             |
| `tokenFor(name, scopes)` | A token for one of the preset's Drupal usernames, issued without the OAuth flow |
| `scenario(name)`         | Turns on a scenario an extension names                                          |
| `requests()`             | The requests the mock answered, for assertions                                  |
| `sent()`                 | What an extension's `onWrite` called                                            |
| `advanceTime(seconds)`   | Moves the clock on, for a token's expiry                                        |

In Cypress these are the tasks `drupal:reset`, `drupal:token`, `drupal:scenario`, `drupal:requests`, `drupal:sent` and `drupal:time`.

## Next.js

Vitest does not support async Server Components, so a Next.js test runs the site as its own process and points it at the server. `examples/nextjs` does this with Playwright's `webServer`, on a production build. `next-drupal`'s `NEXT_PUBLIC_DRUPAL_BASE_URL` names the mock, and `connectMock(url)` drives it from the test.
