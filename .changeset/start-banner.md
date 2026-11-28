---
'decoupled-drupal-mock': minor
'decoupled-drupal-mock-umami': minor
'decoupled-drupal-mock-dashi': minor
'decoupled-drupal-mock-haven': minor
'decoupled-drupal-mock-mercury': minor
---

`serve` and `start` list what a preset answers under the line that says where it listens. The JSON:API index comes first, under each language. Then come Decoupled Router, the main menu, the OAuth token endpoint and the accounts it signs in, for a preset that has them. The links name the base URL, so `--base-url` shows in them. `--quiet` prints the first line alone, which stays as it was. `start` now returns that output too, as `said`, and `serveCommand` returns a function that closes its server.
