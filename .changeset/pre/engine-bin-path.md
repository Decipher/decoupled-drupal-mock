---
'decoupled-drupal-mock': patch
---

The engine's `bin` path drops its leading `./`. With it, `npm publish` on npm 11 removes the command from the manifest it publishes.
