---
'decoupled-drupal-mock': minor
'decoupled-drupal-mock-umami': patch
---

The engine checks a filter or sort path as JSON:API's field resolver does, from what the build now asks Drupal about each field. A visitor may filter by a field it can't read, such as a user's `name`, unless Drupal refuses it. A path that stops at a relationship, a field the related type doesn't have, a property below a single-property field and a `meta` property Drupal doesn't name each get Drupal's 400. A sort path is checked too. A reference to no entity, such as a root term's `virtual` parent, matches no `id`. A dump built before these probes keeps the older check. The Umami preset is rebuilt with them, and a visitor sees two answers change from alpha.3. A filter on users, or one that crosses into them such as `uid.name`, answers 200 with no data, where alpha.3 answered 403. A sort by a field the visitor may not filter, such as `uid.mail`, is now refused with a 403.
