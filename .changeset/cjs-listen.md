---
'decoupled-drupal-mock': minor
---

`listen` is exported from `decoupled-drupal-mock/jest` too, so a CommonJS Jest suite can serve over real HTTP from its own process, with extensions added by `use()` that close over a test's own state. With `rebase: true`, `listen(drupal, 0)` sets the engine's base URL to the port it bound. A suite can then make the engine first and listen second, with every link naming the server's own URL. The engine has a `rebase(url)` of its own for the same move.
