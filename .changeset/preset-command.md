---
'decoupled-drupal-mock': minor
'decoupled-drupal-mock-umami': minor
---

A preset package serves itself: `npx decoupled-drupal-mock-umami@alpha --port 3005` runs the Umami preset with nothing installed first. The command takes the same options as `decoupled-drupal-mock serve`, which the engine now exports as `serveCommand` from `decoupled-drupal-mock/cli`.
