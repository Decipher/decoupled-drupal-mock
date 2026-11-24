---
'decoupled-drupal-mock': minor
---

An extension's handler gets `now()`, which returns the mock's time in milliseconds. `advanceTime(seconds)` moves it on and `reset()` puts it back, so what an extension expires, such as a preview token, runs on the mock's own clock.
