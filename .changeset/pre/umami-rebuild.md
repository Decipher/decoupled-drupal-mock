---
'decoupled-drupal-mock': minor
'decoupled-drupal-mock-umami': minor
---

**Upgrading from alpha.2:** every UUID, date and user id in the Umami preset changes, so a test, snapshot or fixture that names one needs updating. Look a resource up by its path or title rather than by its UUID.

The Umami preset is rebuilt from a clean install on Drupal 11.4.11, from released modules only. Every UUID and install time is new, the GraphQL modules are gone, and the build accounts are users 10 to 12. The new recording shows that Decoupled Settings 1.0.0-beta2, the release alpha.2 recorded too, serves no `theme` attribute. Simple OAuth is 6.1.4, the release that fixes SA-CONTRIB-2026-296. The preset records that the site refuses the password grant, as it is not installed. [`presets/umami/REBUILD.md`](https://github.com/Decipher/decoupled-drupal-mock/blob/1.0.x/presets/umami/REBUILD.md) lists every change.

The engine answers a Contact Storage message as the new recording shows. A message needs its `subject` and `message` fields and any field its form requires. The answer carries the stored id and an `ip_address` of `127.0.0.1`, as the recorded site gave a local sender, but no relationship links.

An overlay made against the old dump names UUIDs the new one doesn't have. The repository's `yarn overlay realign` moves it across, as [Overlays](https://github.com/Decipher/decoupled-drupal-mock/blob/1.0.x/docs/overlays.md) describes, but it only changes UUIDs and install times. An index or collection the overlay replaces keeps what the old build served, and its recordings move with it, so a replay still passes. Realignment also matches users by their ids, and the build accounts' ids moved: user 11 was the editor and is now the author. Compare a realigned overlay with a fresh site that runs the same modules and patches on Drupal 11.4.11, and record it again where the two differ.
