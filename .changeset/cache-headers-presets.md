---
'decoupled-drupal-mock-umami': patch
'decoupled-drupal-mock-dashi': patch
'decoupled-drupal-mock-haven': patch
'decoupled-drupal-mock-mercury': patch
---

Each preset is rebuilt, so it records the cache headers its site sends and the oracle holds them. A visitor's read from Umami is kept for 300 seconds and one from Dashi or Haven for 900, all varied by cookie and consumer. Mercury's site doesn't keep a visitor's page, so it answers `must-revalidate, no-cache, private` to everyone, as its Drupal does. The oracle now holds the `Content-Language` of each read too.
