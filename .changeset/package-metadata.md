---
'decoupled-drupal-mock': patch
'decoupled-drupal-mock-umami': patch
---

Both packages declare Node 16 or later in `engines`, list keywords and include their licence. The engine no longer calls `Object.hasOwn`, which Node 16 has only from 16.9, so a filter or a write works on any Node 16. The engine's description no longer names menu linksets, which the Umami preset answers 404.
