---
'decoupled-drupal-mock': minor
---

The engine answers Canvas Headless's content API from a build of a site that runs it: `/canvas/content-api` for each path the build recorded, Canvas's own 404 for any other path and its 400 for a `requestUri` that is not site-relative, plus `/canvas/content-api/entity` and `/canvas/api/v0/site-data`. A visitor's filtered collection of a type no module lets a visitor filter, such as `canvas_page` or `user`, now answers with nothing, as JSON:API's query guard does, when the build recorded that.
