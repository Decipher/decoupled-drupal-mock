---
'decoupled-drupal-mock': patch
---

Every answer names the language it is in with a `content-language` header, as Drupal's does: the language of the prefix the request came through, or the default language for an unprefixed one. An extension's own answer carries it too, and an encoded prefix such as `/%65s` counts as `/es`, because Drupal decodes the path before it reads the prefix. A client that reads the header to find the site's default language now finds it.
