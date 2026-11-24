# decoupled-drupal-mock-haven

## 1.0.0-alpha.4

### Minor Changes

- 6994148: The server runs in the background: `npx decoupled-drupal-mock-umami@alpha start --port 3005` returns once the server answers HTTP, `status --port 3005` says whether it runs, and `stop --port 3005` returns once the port is free. The engine's command has `start`, `status` and `stop` too. Each preset package's `bin.js` now calls `presetCommand` from `decoupled-drupal-mock/cli`.
- 6d8e7de: A third preset holds Drupal CMS 2.2.9 with its Haven site template, recorded from a real install with Drupal Canvas and Canvas Headless. Haven is a climate non-profit's site, with blog posts, projects and a person profile, their images and tags. The preset answers Canvas pages and nodes through JSON:API and Canvas's content API, with Canvas Headless's draft preview of its About us page. It serves itself with `npx decoupled-drupal-mock-haven@alpha --port 3006`.

### Patch Changes

- Updated dependencies [6994148]
- Updated dependencies [9402ddb]
- Updated dependencies [b687550]
- Updated dependencies [b6d77da]
- Updated dependencies [07b0ed4]
- Updated dependencies [7302e8a]
- Updated dependencies [9402ddb]
  - decoupled-drupal-mock@1.0.0-alpha.4
