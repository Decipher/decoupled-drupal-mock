---
'decoupled-drupal-mock': patch
---

Every answer has the cache headers the recorded site sends: `Cache-Control`, `Vary` and `Expires`. A visitor's GET is answered with the site's page cache maximum age, such as `max-age=300, public`, and varied by `Cookie` and the consumer, as Drupal does, a JSON:API 400 or 404 included. A request with a token or a signed-in session, a write, the session token and a server error are answered with `must-revalidate, no-cache, private`. A path no route takes varies by consumer alone, as Drupal's exception page does. A test of an HTTP cache, a CDN rule or a client cache can now read them. A preset built before this sends none, until it is rebuilt.
