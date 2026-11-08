---
'decoupled-drupal-mock': minor
'decoupled-drupal-mock-umami': minor
---

The server runs in the background: `npx decoupled-drupal-mock-umami@alpha start --port 3005` returns once `/jsonapi` answers, `status --port 3005` says whether it runs, and `stop --port 3005` returns once the port is free. The engine's command has `start`, `status` and `stop` too. A preset package's `bin.js` now calls `presetCommand` from `decoupled-drupal-mock/cli`.
