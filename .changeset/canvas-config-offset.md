---
'decoupled-drupal-mock': patch
'decoupled-drupal-mock-dashi': patch
'decoupled-drupal-mock-haven': patch
'decoupled-drupal-mock-mercury': patch
---

On the Dashi, Haven and Mercury presets, a configuration type answers `page[offset]` with Drupal's 500, as a site with Drupal Canvas does. Canvas's config entity query can't take the offset JSON:API gives it, so on those sites following `links.next` past the first page of components, view displays or image styles fails. The first page, and a page of content, still answer as before. Umami has no Canvas and pages its configuration as it did.
