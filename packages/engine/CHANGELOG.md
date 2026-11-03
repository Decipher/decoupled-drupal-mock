# decoupled-drupal-mock

## 1.0.0-alpha.2

### Minor Changes

- d0c1845: The root entry imports no Node built-in, so `createDrupal` runs in a browser or a service worker over a dump read in Node.

### Patch Changes

- c0d1efe: The engine's build clears `dist` first, so a package built after another branch has no files left over from it.
- 5a15f9b: The packages' npm pages link to the repository, and the engine's has a README.

## 1.0.0-alpha.1

### Minor Changes

- 02ef512: First release. The mock answers Drupal's JSON:API, Decoupled Router, menu and Simple OAuth requests from a preset recorded from a real Drupal. It runs inside tests, through msw or as an HTTP server, with entry points for Jest, Vitest, Playwright and Cypress, and takes extensions for what a preset does not have. A site with contrib modules or patches records them as an overlay, aligned to the preset from any install of the same site.
