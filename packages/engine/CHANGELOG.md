# decoupled-drupal-mock

## 1.0.0-alpha.3

### Minor Changes

- bf9630e: A preset package serves itself: `npx decoupled-drupal-mock-umami@alpha --port 3005` runs the Umami preset with nothing installed first. The command takes the same options as `decoupled-drupal-mock serve`, which the engine now exports as `serveCommand` from `decoupled-drupal-mock/cli`.
- b1e010a: **Upgrading from alpha.2:** every UUID, date and user id in the Umami preset changes, so a test, snapshot or fixture that names one needs updating. Look a resource up by its path or title rather than by its UUID.

  The Umami preset is rebuilt from a clean install on Drupal 11.4.11, from released modules only. Every UUID and install time is new, the GraphQL modules are gone, and the build accounts are users 10 to 12. The new recording shows that Decoupled Settings 1.0.0-beta2, the release alpha.2 recorded too, serves no `theme` attribute. Simple OAuth is 6.1.4, the release that fixes SA-CONTRIB-2026-296. The preset records that the site refuses the password grant, as it is not installed. [`presets/umami/REBUILD.md`](https://github.com/Decipher/decoupled-drupal-mock/blob/1.0.x/presets/umami/REBUILD.md) lists every change.

  The engine answers a Contact Storage message as the new recording shows. A message needs its `subject` and `message` fields and any field its form requires. The answer carries the stored id and an `ip_address` of `127.0.0.1`, as the recorded site gave a local sender, but no relationship links.

  An overlay made against the old dump names UUIDs the new one doesn't have. The repository's `yarn overlay realign` moves it across, as [Overlays](https://github.com/Decipher/decoupled-drupal-mock/blob/1.0.x/docs/overlays.md) describes, but it only changes UUIDs and install times. An index or collection the overlay replaces keeps what the old build served, and its recordings move with it, so a replay still passes. Realignment also matches users by their ids, and the build accounts' ids moved: user 11 was the editor and is now the author. Compare a realigned overlay with a fresh site that runs the same modules and patches on Drupal 11.4.11, and record it again where the two differ.

### Patch Changes

- 41c22c4: The engine's `bin` path drops its leading `./`. With it, `npm publish` on npm 11 removes the command from the manifest it publishes.
- 978daa8: Both packages declare Node 16 or later in `engines`, list keywords and include their licence. The engine no longer calls `Object.hasOwn`, which Node 16 has only from 16.9, so a filter or a write works on any Node 16. The engine's description no longer names menu linksets, which the Umami preset answers 404.
- eab96d1: `serve`, `presetDir` and everything that names a preset, such as `startMock`, `spawnMock`, `loadPreset` and `globalSetup`, find a preset installed beside the engine when the current directory has none. So `npx -p decoupled-drupal-mock@alpha -p decoupled-drupal-mock-umami@alpha decoupled-drupal-mock serve umami` works from any directory. A preset the current directory has still comes first. A package of the same name that doesn't hold a build, such as the `umami` analytics package, no longer hides the preset, and nor does a directory of the short name that holds no build.
- 4de8999: A type change only: `WriteScript` and its steps type `as` as `Runner`, which names `anonymous`, the visitor who sends no credentials.

## 1.0.0-alpha.2

### Minor Changes

- d0c1845: The root entry imports no Node built-in, so `createDrupal` runs in a browser or a service worker over a dump read in Node.

### Patch Changes

- c0d1efe: The engine's build clears `dist` first, so a package built after another branch has no files left over from it.
- 5a15f9b: The packages' npm pages link to the repository, and the engine's has a README.

## 1.0.0-alpha.1

### Minor Changes

- 02ef512: First release. The mock answers Drupal's JSON:API, Decoupled Router, menu and Simple OAuth requests from a preset recorded from a real Drupal. It runs inside tests, through msw or as an HTTP server, with entry points for Jest, Vitest, Playwright and Cypress, and takes extensions for what a preset does not have. A site with contrib modules or patches records them as an overlay, aligned to the preset from any install of the same site.
