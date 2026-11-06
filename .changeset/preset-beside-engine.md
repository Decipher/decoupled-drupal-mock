---
'decoupled-drupal-mock': patch
'decoupled-drupal-mock-umami': patch
---

`serve`, `presetDir` and everything that names a preset, such as `startMock`, `spawnMock`, `loadPreset` and `globalSetup`, find a preset installed beside the engine when the current directory has none. So `npx -p decoupled-drupal-mock@alpha -p decoupled-drupal-mock-umami@alpha decoupled-drupal-mock serve umami` works from any directory. A preset the current directory has still comes first. A package of the same name that doesn't hold a build, such as the `umami` analytics package, no longer hides the preset.
