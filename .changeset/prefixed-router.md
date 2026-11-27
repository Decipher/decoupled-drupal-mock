---
'decoupled-drupal-mock': patch
'decoupled-drupal-mock-umami': patch
'decoupled-drupal-mock-dashi': patch
---

Decoupled Router answers under each language's prefix, as Drupal does. On Umami `/es/router/translate-path?path=/recipes/borscht-con-costillas-de-cerdo` gives the Spanish recipe, and on Dashi `/es/router/translate-path?path=/recipes` gives the Spanish recipes page. The `path` it is asked for answers the same with the prefix or without. A path the build has no record of gets Drupal's JSON 404 under a prefix too, where the mock answered with an HTML page before.
