---
'decoupled-drupal-mock': minor
---

The HTTP server can wait before it answers, so a test can keep a request in flight. `listen()` takes a `delay` in milliseconds, for every request but the control routes' or by path, and a client's `delay(ms, path)` sets one over the control routes, so a server from `spawnMock` or `globalSetup` can be slowed too. A path takes the paths under it, with or without a language prefix. `reset()` puts back the delay the server started with, and closing the server answers any request still waiting. In Cypress the task is `drupal:delay`.
