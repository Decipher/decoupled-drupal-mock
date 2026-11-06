---
'decoupled-drupal-mock': minor
'decoupled-drupal-mock-umami': minor
---

The Umami preset is rebuilt from a clean install on Drupal 11.4.11, from released modules only. Every UUID and install time is new, the GraphQL modules are gone, and the build accounts are users 10 to 12. Decoupled Settings 1.0.0-beta2 serves no `theme` attribute. Simple OAuth is 6.1.4, the release that fixes SA-CONTRIB-2026-296. The preset records that the site refuses the password grant, as it is not installed. `presets/umami/REBUILD.md` lists every change.

The engine answers a Contact Storage message as the new recording shows. A message needs only its `subject` and `message` fields, and the answer carries the stored id and the sender's IP address but no relationship links.

An overlay made against the old dump names UUIDs the new one doesn't have. Move it across with `yarn overlay realign`, as `docs/overlays.md` describes, then replay its recordings. Realignment matches users by their ids, and the build accounts' ids moved: user 11 was the editor and is now the author. Check every reference an overlay makes to an account. If an answer still differs after that, the core upgrade is the cause, so record the overlay again on Drupal 11.4.11.
