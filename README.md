# Decoupled Drupal mock

Drupal's decoupled APIs without a Drupal site: JSON:API, Decoupled Router, menu linksets and Simple OAuth, answered from fixtures built from real Drupal releases, in process, through msw, over HTTP, or inside a Nuxt site.

Built for [Druxt](https://druxtjs.org), the decoupled Drupal and Nuxt framework, and usable by any client of Drupal's decoupled APIs.

## Status

Not released yet.

The engine runs on Node, including under a test runner's jsdom environment. It needs `node:crypto` from its root entry, so it does not run in a browser or a service worker: a browser test reaches it over HTTP.

## Development

The repository has a dev container, for VS Code or [DevPod](https://devpod.sh), with Node and Yarn set up:

```sh
devpod up github.com/Decipher/decoupled-drupal-mock
```

Run the mock's server inside it with `--host 0.0.0.0` so the forwarded port 3005 reaches it. Run `yarn install` and `yarn workspace decoupled-drupal-mock build` after changing to another branch.

## Licence

GPL-2.0-or-later, as everything hosted on drupal.org is, and as the Umami preset must be: it carries Drupal's own demo content and configuration.
