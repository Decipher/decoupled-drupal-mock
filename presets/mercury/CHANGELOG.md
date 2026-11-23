# decoupled-drupal-mock-mercury

## 1.0.0-alpha.4

### Minor Changes

- 6994148: The server runs in the background: `npx decoupled-drupal-mock-umami@alpha start --port 3005` returns once the server answers HTTP, `status --port 3005` says whether it runs, and `stop --port 3005` returns once the port is free. The engine's command has `start`, `status` and `stop` too. Each preset package's `bin.js` now calls `presetCommand` from `decoupled-drupal-mock/cli`.
- cfaa7f9: A fourth preset holds Drupal CMS 2.2.9 with its Mercury Demo site template, recorded from a real install with Drupal Canvas and Canvas Headless. Mercury Demo is the theme's own showcase: Canvas pages built from Mercury's components, such as its cards, sections, headings, buttons and calls to action. The preset answers its pages through JSON:API and Canvas's content API, with Canvas Headless's draft preview of its Home page. It serves itself with `npx decoupled-drupal-mock-mercury@alpha --port 3007`.

### Patch Changes

- Updated dependencies [6994148]
- Updated dependencies [9402ddb]
- Updated dependencies [b687550]
- Updated dependencies [b6d77da]
- Updated dependencies [07b0ed4]
- Updated dependencies [7302e8a]
- Updated dependencies [9402ddb]
  - decoupled-drupal-mock@1.0.0-alpha.4
