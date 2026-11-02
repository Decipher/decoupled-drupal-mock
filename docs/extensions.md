# Extensions

An extension gives the mock what a preset cannot record: a contributed module's endpoints, a draft, a failure. It is a plain object:

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

## Handing it to the mock

| Where               | How                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| In the test process | `createMock(dump, { extensions })`, `loadPreset('umami', { extensions })`, `startMock('umami', { extensions })`                         |
| In one test         | `mock.drupal.use(extension)`, dropped by `reset()`                                                                                      |
| Playwright          | `withDrupal(test, 'umami', { extensions })`                                                                                             |
| Another process     | `serve umami --control --extension ./file.mjs`, or `spawnMock('umami', { extensions: ['./file.mjs'] })`, with the file's default export |

A function cannot cross into another process. A test there turns on what the file names, with `scenario(name)`.

## Its parts

- **`routes`:** new endpoints, by `METHOD /path`. `:name` matches one segment and `ANY` matches every method. A language prefix is matched for you and given as `prefix`.
- **`answer`:** sees every request. Return what `next()` gives, change it, or replace it.
- **`fixtures`:** resources by language and type, which read and write like the dump's own. A fixture joins its type's collection, and every listing built from it: a block added to a region is in that region's block list.
- **`onWrite`:** runs after a successful JSON:API write. `send` calls another service, and its result lands in `sent()`.
- **`scenarios`:** named `routes`, `answer` and `onWrite`, off until a test turns them on.

A handler gets `method`, `url`, `path`, `route`, `prefix`, `params`, `query`, `headers`, `body`, `json`, `state` and `drupal`. `state` is a `Map` shared across requests until `reset()`. `drupal.handle(...)` asks the stock site, with the fixtures but past every extension, so a handler can read its own URL without calling itself. An `onWrite` hears of a write the stock site took, under its JSON:API base path; one that throws is recorded on that request in `requests()`, and the write stands.

An answer has `status`, `headers` and `body`. A body that is not a string goes as JSON.

## Answers are synchronous

The engine answers synchronously, so a Jest spy can be answered from it, and an extension does the same. A handler that returns a promise fails with its name. `onWrite`'s `send` is the way out to anything slower.

## What it costs

An extension's answers are written by hand. The mock's fidelity claim covers what a build recorded from a real Drupal and nothing an extension answers, so write down where each answer came from, and record it from a real site when you can.

## Examples

- [`examples/extensions/next.mjs`](../examples/extensions/next.mjs): the `next` module's draft endpoint, a latest revision, revalidation on a save and Drupal being down. [`examples/nextjs`](../examples/nextjs) runs it.
- [`examples/extensions/node-preview.mjs`](../examples/extensions/node-preview.mjs): JSON:API Node Preview's unsaved node. [`examples/vitest`](../examples/vitest) runs it.
