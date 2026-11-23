---
'decoupled-drupal-mock': minor
'decoupled-drupal-mock-umami': minor
'decoupled-drupal-mock-dashi': minor
'decoupled-drupal-mock-haven': minor
---

The server runs in the background: `npx decoupled-drupal-mock-umami@alpha start --port 3005` returns once the server answers HTTP, `status --port 3005` says whether it runs, and `stop --port 3005` returns once the port is free. The engine's command has `start`, `status` and `stop` too. Each preset package's `bin.js` now calls `presetCommand` from `decoupled-drupal-mock/cli`.
