# Decoupled Drupal mock

[![CI](https://github.com/Decipher/decoupled-drupal-mock/actions/workflows/ci.yml/badge.svg?branch=1.0.x)](https://github.com/Decipher/decoupled-drupal-mock/actions/workflows/ci.yml?query=branch%3A1.0.x)
[![Coverage](https://codecov.io/gh/Decipher/decoupled-drupal-mock/branch/1.0.x/graph/badge.svg)](https://codecov.io/gh/Decipher/decoupled-drupal-mock/branch/1.0.x)
[![npm](https://img.shields.io/npm/v/decoupled-drupal-mock/alpha)](https://www.npmjs.com/package/decoupled-drupal-mock)

**Built by a human using an AI assistant.** Much of the code and documentation in this repository was written with an AI coding assistant, directed and reviewed by its maintainer. The mock's answers are checked against answers recorded from a real Drupal. See [AI use](CONTRIBUTING.md#ai-use).

This package answers requests to Drupal's decoupled APIs without a running Drupal site. It covers JSON:API, Decoupled Router, menus through JSON:API Menu Items, and Simple OAuth, with answers from a preset: a recording of a real Drupal site. Your tests can call the mock directly, or run it as an HTTP server for a frontend.

It was built for [Druxt](https://druxtjs.org), the decoupled Drupal and Nuxt framework, and works with any client of Drupal's JSON:API.

## Install

To try the mock without installing anything, serve the Umami preset with one command:

```sh
npx decoupled-drupal-mock-umami@alpha --port 3005
```

Every preset package has a command like this, named after the package, and it takes the same options as `decoupled-drupal-mock serve`.

The engine and the Umami preset are published to npm as prereleases, under the `alpha` tag:

```sh
npm install --save-dev decoupled-drupal-mock@alpha decoupled-drupal-mock-umami@alpha
```

With Yarn, `yarn add --dev decoupled-drupal-mock@alpha decoupled-drupal-mock-umami@alpha`. Install the two at the same version. The preset needs an engine that reads its dump. The preset's default export reads it with `loadDump`, which refuses a dump format the engine cannot read with an error that says so. An alpha can change between releases, so pin the version you test against.

## Terms

- **Preset:** a packaged recording of one Drupal site, such as `decoupled-drupal-mock-umami`. A preset can be named by its package, by its short name (`umami`) or by its build directory.
- **Dump:** the files in a preset that the mock serves. They hold every resource the build recorded, and what a visitor may read of each.
- **Oracle:** real requests with the answers a real Drupal gave them, kept beside the dump. The mock's tests compare its answers with these.
- **Extension:** answers you write by hand, for what the preset does not have. A **scenario** is a set of them, with a name, that a test turns on.

## Packages

- `decoupled-drupal-mock`, the engine. `createDrupal(dump, { baseUrl })` serves the JSON:API index, individual and related resources, and collections with Drupal's filter, sort, page, sparse fieldset and include rules, under each language prefix. Anonymous requests see only what Drupal shows a visitor, with the same resources left out. Signed-in requests see the rest. Router lookups, menus and views are answered from what the build recorded.
- `decoupled-drupal-mock-umami`, the Umami preset. It holds Drupal's demo site in English and Spanish, recorded from a real Drupal 11.4.11 install. Its README lists the accounts and OAuth clients it holds.
- `packages/build`, the crawler that records a preset from a running Drupal. It is part of this repository and is not published.

The engine runs on Node, including under a test runner's jsdom environment, and its root entry also runs in a browser or a service worker. `loadDump` and the server need Node, so read the dump there and pass the object to `createDrupal` in the page. `drupal.fetch` and `createMock().fetch` build a `Request` and a `Response`, which Node provides from version 18. On Node 16, and in Jest's jsdom environment on any Node, use the axios entry point or a fetch polyfill.

| Entry point                             | What it holds                                                               |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `decoupled-drupal-mock`                 | `createDrupal`, `createMock` and the types                                  |
| `decoupled-drupal-mock/node`            | `loadDump`, to read a build directory                                       |
| `decoupled-drupal-mock/serve`           | `listen`, the HTTP server                                                   |
| `decoupled-drupal-mock/msw`             | `handlers`, for msw                                                         |
| `decoupled-drupal-mock/axios`           | `axiosAdapter` and `axiosVerbs`                                             |
| `decoupled-drupal-mock/testing`         | `startMock` and `withDrupal`, for Vitest, Playwright and other ESM runners  |
| `decoupled-drupal-mock/jest`            | `loadPreset`, `spawnMock`, `globalSetup` and the axios helpers, in CommonJS |
| `decoupled-drupal-mock/cypress`         | `spawnMock` and `cypressTasks`, in CommonJS                                 |
| `decoupled-drupal-mock/recorded-writes` | Helpers for replaying recorded writes                                       |
| `decoupled-drupal-mock/cli`             | `presetCommand`, the command a preset package runs, and `serveCommand`      |

## Using the mock in a test

```ts
import { createDrupal } from 'decoupled-drupal-mock';
import umami from 'decoupled-drupal-mock-umami';

const drupal = createDrupal(umami(), { baseUrl: 'https://drupal.test' });
const response = await drupal.fetch('https://drupal.test/jsonapi/node/recipe?filter[status]=1&page[limit]=5');
```

The `baseUrl` is the address your client calls: the links in every answer name it. If your client accepts a `fetch` function, pass it `drupal.fetch`. If your tests use msw, mount the mock's handlers:

```ts
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { handlers } from 'decoupled-drupal-mock/msw';

const server = setupServer(...handlers(drupal, http, 'https://drupal.test'));
beforeAll(() => server.listen());
afterAll(() => server.close());
```

End-to-end suites and browsers need a server:

```sh
npx decoupled-drupal-mock-umami@alpha --port 3005
```

A script, a `Makefile` or a CI job can run it in the background instead. `start` returns once `/jsonapi` answers, so the next command can use the server, and `stop` returns once the port is free:

```sh
npx --yes decoupled-drupal-mock-umami@alpha start --port 3005
DRUPAL_BASE_URL=http://127.0.0.1:3005 npm test
npx --yes decoupled-drupal-mock-umami@alpha stop --port 3005
```

`start` takes the options `serve` takes and prints the same line. A server that exits or does not answer within `--ready-timeout` seconds, 30 unless you say, is stopped, and `start` prints its log and exits with status 1. `status --port 3005` says whether a server runs there, with its preset and process ID, and exits with status 1 when none does. `stop` exits with status 0 when no server was running, so a script can call it twice. A pid file per port, in a directory of your own under the system's temporary directory, ties the three together, and `--pid-file <file>` names another. The engine has the same commands: `decoupled-drupal-mock start umami --port 3005`. They need a POSIX system, and CI runs them on Linux. On Windows, run `serve` in the background yourself.

## Test runner support

Jest (including CommonJS on Node 16 in jsdom), Vitest, Playwright and Cypress each have an entry point and a working example that CI runs. See [Test runners](docs/test-runners.md).

## Extending the mock

If your site has a module with its own endpoints, the preset won't include them. An extension adds them. It can also change one of the mock's recorded answers or make it fail, or call your site back when something is saved:

```js
export default {
  routes: {
    'POST /next/draft-url': ({ json }) =>
      json?.secret === 'test'
        ? { body: { path: json.path, maxAge: 30 } }
        : { status: 422, body: { message: 'Invalid secret.' } },
  },
  scenarios: {
    'drupal-down': { answer: () => ({ status: 503, body: 'Service unavailable' }) },
  },
};
```

```sh
npx decoupled-drupal-mock serve umami --control --extension ./next.mjs
```

`--control` adds the routes a test uses to reset the mock, sign in and turn on scenarios. Never use it on a shared or public port. See [Extensions](docs/extensions.md). `examples/nextjs` runs a real Next.js site with next-drupal against one.

## Writes and sign-in

The engine accepts POST, PATCH and DELETE requests on JSON:API resources and relationships. It answers them with Drupal's own validation, permission and content moderation errors. It also supports Drupal's cookie sign-in, and Simple OAuth's token, userinfo and authorize endpoints. Each `createDrupal()` keeps its own copy of what it writes, so one test's writes never reach another's, and `reset()` restores the preset. In a test, `tokenFor('editor')` returns a token for the `editor` user directly, without the OAuth flow. It takes the Drupal username.

## Running a frontend against the mock

Any frontend that reads Drupal over HTTP can use the mock's server as its Drupal. Start the server, then point the frontend's Drupal URL at it:

```sh
npx decoupled-drupal-mock-umami@alpha --port 3005
```

- Druxt 0.x on Nuxt 2: `druxt.baseUrl: 'http://127.0.0.1:3005'`, or `BASE_URL=http://127.0.0.1:3005` where the site reads it from the environment.
- Next.js with next-drupal: `NEXT_PUBLIC_DRUPAL_BASE_URL=http://127.0.0.1:3005` and `NEXT_IMAGE_DOMAIN=127.0.0.1`.
- Any other client: its base URL.

The images and other files the content links to are included in the preset and served from `/sites/default/files/`. A request for an image style returns the original image. CORS is enabled so a browser-side client can call the server. Turn it off with `--no-cors`. In a devpod or a container, start the server with `--host 0.0.0.0` and forward the port.

## Fidelity

Each preset includes an oracle: a list of real client requests, with the answers a real Drupal gave. It covers reads as well as writes and sign-in, errors included. The fidelity tests send each request to the engine and compare its answer with Drupal's. For Drupal's themed HTML pages they compare the status and headers, not the markup. All 151 of the Umami preset's read entries match, of which 11 are 404s and 1 is a 403, and so do all 52 write steps. The oracle covers Umami's request list, not every request a client could make.

## Building a preset

A preset can be recorded from any Drupal with JSON:API enabled, including your own site. See [Building a preset](docs/building-a-preset.md).

## Development

The repository has a dev container, for VS Code or [DevPod](https://devpod.sh), with Node, Yarn and the browsers the Playwright and Cypress examples use:

```sh
devpod up github.com/Decipher/decoupled-drupal-mock
```

Inside it, run `yarn install` and `yarn workspace decoupled-drupal-mock build` first, and again after changing branch. Then run the mock's server with `--host 0.0.0.0` so the forwarded port 3005 reaches it:

```sh
node packages/engine/dist/cli.js serve umami --host 0.0.0.0 --port 3005
```

Links in the server's answers use the address you started it with. To use a tunnel, start the tunnel first. Then start the server with the `https://*.trycloudflare.com` address that the tunnel prints:

```sh
yarn tunnel 3005
node packages/engine/dist/cli.js serve umami --port 3005 --base-url https://<printed>.trycloudflare.com
```

The container also forwards port 3000 for a frontend.

[Contributing](CONTRIBUTING.md) covers the checks and how a change gets recorded.

## Licence

GPL-2.0-or-later. This is the licence of all code on drupal.org. The Umami preset must use it too, because it includes Drupal's demo content and configuration.
