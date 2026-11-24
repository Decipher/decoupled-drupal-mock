---
'decoupled-drupal-mock': patch
'decoupled-drupal-mock-dashi': patch
---

The build replaces the crawled site's address where a document writes it encoded in a query value, as Drupal Canvas does in an image's `alternateWidths`, and the mock serves those at its own base URL. The Dashi preset is rebuilt with it, so its Canvas images name the mock's address and never the one it was built from. `relinker` is exported for a tool that rewrites an origin the same way.
