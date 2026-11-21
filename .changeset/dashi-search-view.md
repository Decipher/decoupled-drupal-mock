---
'decoupled-drupal-mock-dashi': patch
---

The Dashi preset's oracle records the search page's view, `/jsonapi/views/search/search`, which Drupal answers 404 because JSON:API Views has no route for a Search API view. The mock already answered it 404, and now a recording proves it. The README says so.
