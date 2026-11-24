---
'decoupled-drupal-mock': minor
'decoupled-drupal-mock-dashi': minor
---

The engine gives Canvas Headless's draft preview on a build that recorded one. An editor's cookie session mints a preview assertion at `/canvas-headless/assertion`, the jwt-bearer grant at `/oauth/token` redeems it once for a preview token, and the content API answers that token with drafts. `/canvas-headless/renew` redirects to the frontend's draft route. The build records a preview with `canvasPreview` in its configuration, and the Dashi preset has one, with an auto-saved edit to its About page.
