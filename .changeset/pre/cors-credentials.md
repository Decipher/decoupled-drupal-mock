---
'decoupled-drupal-mock': minor
---

The server answers CORS with credentials when it runs with `--cors-credentials`, or with `credentials: true` in `listen`'s options. It names the request's origin instead of `*` and allows credentials, as a Drupal does with `supportsCredentials` in its `cors.config`, so a browser on another origin can send the mock's session cookie. It names only a loopback origin, unless `--cors-origin`, or `origins` in `listen`'s options, lists the origins to name. `start` takes the options too.
