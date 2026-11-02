# Extensions

An extension gives the mock what a preset cannot record, such as a contributed module's endpoints or a failure. It is a plain object:

```js
export default {
  name: 'my-module',
  routes: { 'GET /api/:id/thing': ({ params }) => ({ body: { id: params.id } }) },
  answer: (request, next) => next(),
  fixtures: { en: { 'node--thing': [] } },
  onWrite: ({ resource, send }) => send('http://localhost:3000/api/revalidate'),
  scenarios: { down: { answer: () => ({ status: 503 }) } },
};
```

## Loading an extension

| Where                   | How                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In the test process     | `createMock(dump, { extensions })` from `decoupled-drupal-mock`, `loadPreset('umami', { extensions })` from `/jest`, or `startMock('umami', { extensions })` from `/testing` |
| In one test, in process | `mock.drupal.use(extension)`. It cannot add `fixtures`, and `reset()` drops it                                                                                               |
| Playwright              | `withDrupal(test, 'umami', { extensions })` from `/testing`                                                                                                                  |
| Another process         | `serve umami --control --extension ./file.mjs`, or `spawnMock('umami', { extensions: ['./file.mjs'] })` from `/jest` or `/cypress`, with the file's default export           |

Functions cannot be passed to a server in another process. Give the server an extension file instead, and turn on its scenarios from the test with `scenario(name)`.

## Routes, answers, fixtures and call-backs

- **`routes`:** new endpoints, by `METHOD /path`. `:name` matches one segment and `ANY` matches every method. A language prefix is matched for you and given as `prefix`.
- **`answer`:** sees every request. Return what `next()` gives, change it, or replace it.
- **`fixtures`:** resources by language and type, which read and write like the dump's own. A fixture joins its type's collection, and every listing built from it: a block added to a region is in that region's block list.
- **`overlay`:** what a recording of the site with a module or a patch answers differently. A preset ships these: pass `overlays: ['language-routing-patches']` to `loadPreset`, `startMock`, `spawnMock` or `withDrupal`, or `--overlay` to the CLI. The preset's README lists them.
- **`onWrite`:** runs after a successful JSON:API write. `send` calls another service, and `sent()` holds the result.
- **`scenarios`:** sets of `routes`, `answer` and `onWrite` under a name, off until a test turns them on.

A handler gets `method`, `url`, `path`, `route`, `prefix`, `params`, `query`, `headers`, `body`, `json`, `state` and `drupal`. `state` is a `Map` shared across requests until `reset()`. `drupal.handle(...)` sends a request to the mock with the fixtures applied and every extension skipped. A handler can use it to read its own URL without calling itself. An `onWrite` handler runs after a JSON:API write that the mock itself carried out succeeds. If the handler throws, the error is recorded on that request in `requests()`, and the write is kept.

An answer has `status`, `headers` and `body`. A body that is not a string is sent as JSON.

## Answers are synchronous

The engine answers synchronously, so a Jest spy can return its answers, and an extension's handlers must be synchronous too. If a handler returns a promise, the request fails with an error that names the handler. To reach a slower service, use `send` in `onWrite`. `send` calls the global `fetch`, so where there is none, on Node 16 or in Jest's jsdom environment, it records an error in `sent()` instead of calling the service.

## Extensions and fidelity

An extension's answers are written by hand, unless they are a recorded overlay. The mock's fidelity claim covers what a build recorded from a real Drupal and nothing else an extension answers, so write down where each answer came from, and record it from a real site when you can.

## Examples

- [`examples/extensions/next.mjs`](../examples/extensions/next.mjs) answers the `next` module's draft endpoint and revalidates on a save. [`examples/nextjs`](../examples/nextjs) runs it.
- [`examples/extensions/node-preview.mjs`](../examples/extensions/node-preview.mjs) answers JSON:API Node Preview's request for an unsaved node. [`examples/vitest`](../examples/vitest) runs it.
