# Decoupled Drupal mock

Drupal's decoupled APIs without a Drupal site: JSON:API, Decoupled Router, menu linksets and Simple OAuth, answered from fixtures built from real Drupal releases, in process, through msw, or over HTTP as the backend of any frontend.

Built for [Druxt](https://druxtjs.org), the decoupled Drupal and Nuxt framework, and usable by any client of Drupal's JSON:API.

## Packages

- `decoupled-drupal-mock`, the engine. `createDrupal(dump, { baseUrl })` serves the index, individual and related resources, and collections with Drupal's filter, sort, page, sparse fieldset and include semantics, under each language prefix. Without an `Authorization` header it serves what a visitor may read, with Drupal's omissions. With one it serves the whole dump. The routes it does not compute, such as Decoupled Router lookups, menus and views, come from the build's recordings.
- `decoupled-drupal-mock-umami`, the Umami preset: Drupal's demo site in English and Spanish, built from a real Drupal 11 install.
- `decoupled-drupal-mock-build`, the crawler that builds a preset from a running Drupal.

## In a test

```ts
import { createDrupal } from 'decoupled-drupal-mock';
import umami from 'decoupled-drupal-mock-umami';

const drupal = createDrupal(umami(), { baseUrl: 'https://drupal.test' });
const response = await drupal.fetch('https://drupal.test/jsonapi/node/recipe?filter[status]=1&page[limit]=5');
```

A client that takes a `fetch` gets `drupal.fetch`. One that intercepts with msw gets `handlers(drupal, http, baseUrl)` from `decoupled-drupal-mock/msw`. An end-to-end suite or a browser gets a server:

```sh
npx decoupled-drupal-mock serve decoupled-drupal-mock-umami --port 3005
```

## Writes and sign-in

The engine answers POST, PATCH and DELETE on JSON:API resources and relationships with Drupal's own validation, permission and moderation answers, and Simple OAuth's token grants, userinfo and authorize beside Drupal's cookie sign-in. Each `createDrupal()` keeps its own copy of what it writes, so one test's writes never reach another's, and `reset()` restores the preset. `tokenFor('editor')` is a test's shortcut past the grant.

## A frontend with no Drupal

The server is a backend for any frontend that reads Drupal over HTTP. Run it and point the site at it:

```sh
npx decoupled-drupal-mock serve umami --port 3005
```

- Druxt 0.x on Nuxt 2: `druxt.baseUrl: 'http://127.0.0.1:3005'`, or `BASE_URL=http://127.0.0.1:3005` where the site reads it from the environment.
- Next.js with next-drupal: `NEXT_PUBLIC_DRUPAL_BASE_URL=http://127.0.0.1:3005` and `NEXT_IMAGE_DOMAIN=127.0.0.1`.
- Any other client: its base URL.

The public files the content names are in the preset and served from `/sites/default/files/`, with an image style URL answered by the original. CORS is on for a browser-side client, off with `--no-cors`. In a devpod or a container, `--host 0.0.0.0` and forward the port.

## Fidelity

Each preset records an oracle beside its dump: real requests with Drupal's real answers, drawn from what clients ask. The engine's fidelity test answers every one and compares the documents. The Umami preset's 141 entries all match.

## Status

Not released yet. The packages will install from this repository's releases once the first one is cut, and from npm and drupal.org after that.

## Building a preset

The build crawls a running Drupal as an administrator for the dump and as a visitor for what a visitor may read, records the router lookups, menus, views and decoupled settings, and the oracle, then rewrites the site's origin to a placeholder and writes a manifest with the hash of every file. `packages/build/src/cli.ts` takes a JSON config naming the site, the languages, the credentials and the oracle list.

The engine runs on Node, including under a test runner's jsdom environment. It needs `node:crypto` from its root entry, so it does not run in a browser or a service worker: a browser test reaches it over HTTP.

## Development

The repository has a dev container, for VS Code or [DevPod](https://devpod.sh), with Node and Yarn set up:

```sh
devpod up github.com/Decipher/decoupled-drupal-mock
```

Run the mock's server inside it with `--host 0.0.0.0` so the forwarded port 3005 reaches it. Run `yarn install` and `yarn workspace decoupled-drupal-mock build` after changing to another branch.

## Licence

GPL-2.0-or-later, as everything hosted on drupal.org is, and as the Umami preset must be: it carries Drupal's own demo content and configuration.\n
