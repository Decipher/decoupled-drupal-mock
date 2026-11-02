---
'decoupled-drupal-mock': minor
'decoupled-drupal-mock-umami': minor
---

First release. The mock answers Drupal's JSON:API, Decoupled Router, menu and Simple OAuth requests from a preset recorded from a real Drupal. It runs inside tests, through msw or as an HTTP server, with entry points for Jest, Vitest, Playwright and Cypress, and takes extensions for what a preset does not have. A site with contrib modules or patches records them as an overlay, aligned to the preset from any install of the same site.
