---
'decoupled-drupal-mock': minor
---

An extension's handler gets `now`, the mock's time in milliseconds. `advanceTime` moves it and `reset()` puts it back, so what an extension expires, such as a preview token, runs on the mock's own clock.
