---
'decoupled-drupal-mock': patch
'decoupled-drupal-mock-umami': patch
---

`serve` and `presetDir` find a preset installed beside the engine when the current directory has none, so `npx -p decoupled-drupal-mock -p decoupled-drupal-mock-umami decoupled-drupal-mock serve umami` works from any directory. A preset the current directory has still comes first.
