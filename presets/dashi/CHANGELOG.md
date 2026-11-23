# decoupled-drupal-mock-dashi

## 1.0.0-alpha.4

### Minor Changes

- 6994148: The server runs in the background: `npx decoupled-drupal-mock-umami@alpha start --port 3005` returns once the server answers HTTP, `status --port 3005` says whether it runs, and `stop --port 3005` returns once the port is free. The engine's command has `start`, `status` and `stop` too. Each preset package's `bin.js` now calls `presetCommand` from `decoupled-drupal-mock/cli`.
- b687550: The engine gives Canvas Headless's draft preview on a build that recorded one. An editor's cookie session mints a preview assertion at `/canvas-headless/assertion`, the jwt-bearer grant at `/oauth/token` redeems it once for a preview token, and the content API answers that token with drafts. `/canvas-headless/renew` redirects to the frontend's draft route. The build records a preview with `canvasPreview` in its configuration, and the Dashi preset has one, with an auto-saved edit to its About page.
- 5130f3c: A second preset holds Drupal CMS 2.2.9 with its Dashi site template, recorded from a real install with Drupal Canvas and Canvas Headless. Dashi brings Umami's recipes and articles, in English and Spanish, with their images, tags and authors. The preset answers Canvas pages and nodes through JSON:API and Canvas's content API, and serves itself with `npx decoupled-drupal-mock-dashi@alpha --port 3005`.

### Patch Changes

- 07b0ed4: The build replaces the crawled site's address where a document writes it encoded in a query value, as Drupal Canvas does in an image's `alternateWidths`, and the mock serves those at its own base URL. The Dashi preset is rebuilt with it, so its Canvas images name the mock's address and never the one it was built from. `relinker` is exported for a tool that rewrites an origin the same way.
- Updated dependencies [6994148]
- Updated dependencies [9402ddb]
- Updated dependencies [b687550]
- Updated dependencies [b6d77da]
- Updated dependencies [07b0ed4]
- Updated dependencies [7302e8a]
- Updated dependencies [9402ddb]
  - decoupled-drupal-mock@1.0.0-alpha.4
