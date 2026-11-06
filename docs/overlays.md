# Overlays

A preset is a stock site, built from released modules alone. Your site may run a contrib module the preset lacks, or a patch no release holds yet. An overlay records what your site answers differently, as the difference between a build of the stock site and a build of yours, and the mock adds it to the preset on request. The answers come from your real Drupal, so the fidelity claim covers them too.

```js
const drupal = loadPreset('umami', { overlays: ['./overlays/language-routing-patches.json.gz'] });
```

The same option works on `startMock`, `spawnMock`, `globalSetup` and `withDrupal`, and `--overlay ./overlays/language-routing-patches.json.gz` works on the CLI.

## Making one

1. Install the release the preset names. Its `dump/manifest.json` gives the Drupal core version, the profile and each module's version: for Umami, the `demo_umami` profile in English and Spanish.
2. Add your change, whether a module and its configuration or a patch.
3. Build it as the preset is built, with `packages/build` and the preset's `oracle.txt`, plus the queries your change answers. If your change takes writes, give the build a `writesFile` of scripts for them too, or the mock answers them from its own model of the module rather than from your Drupal. See [Building a preset](building-a-preset.md). The build writes `<out>/` and its recordings beside it, in `<out>.oracle/`.
4. Keep the difference, against the preset's own dump:

   ```sh
   yarn overlay node_modules/decoupled-drupal-mock-umami/dump <your build> language-routing-patches overlays
   ```

   The arguments are the baseline, your build, the overlay's name and the directory to write it to. This writes `overlays/language-routing-patches.json.gz`, your site's answers as `overlays/oracle/language-routing-patches.json.gz`, and their hashes in `overlays/manifest.json`. A build with write scripts adds their answers as `overlays/oracle/language-routing-patches.writes.json.gz`.

5. Replay the answers against the preset and the overlay, as this repository's tests do. Each must match, or the overlay misses something your site does:

   ```js
   const { readFileSync } = require('node:fs');
   const { gunzipSync } = require('node:zlib');
   const { comparable, loadPreset } = require('decoupled-drupal-mock/jest');

   const drupal = loadPreset('umami', { overlays: ['./overlays/language-routing-patches.json.gz'] });
   const answers = JSON.parse(gunzipSync(readFileSync('./overlays/oracle/language-routing-patches.json.gz')));
   test.each(answers.map((entry) => [entry.request, entry]))('%s', (_request, entry) => {
     const answer = drupal.handle('GET', entry.request);
     expect(answer.status).toBe(entry.status);
     // `comparable` sets aside what Drupal salts afresh on every answer: the keys of omitted items' links.
     if (typeof entry.body !== 'string') expect(comparable(answer.body)).toEqual(comparable(entry.body));
   });
   ```

An overlay can only hold what your change makes the site answer differently. It can't add what the preset's own site lacks, such as a module that a different core installs with the same profile. Build on the core and profile the preset's manifest names, so the difference is your change alone. A module the preset's core leaves out, such as Contact on Drupal 11.4, goes in as your change.

Your install is not the preset's, so its UUIDs and install times are its own. The overlay tool aligns them before taking the difference. It matches each entity to the preset's by its internal id (`drupal_internal__nid` and its kin) or its machine name, and gives it the preset's UUID and install times (`created`, `changed` and the sign-in times). Anything else your site does differently is part of the overlay, so keep the site as the preset's apart from your change. Signing in as the preset's accounts changes what Views such as Who's new list.

## After the preset is rebuilt

A rebuild of the preset makes its UUIDs and install times afresh, so an overlay made against the old dump names entities the new one doesn't have. Move it onto the new dump, keeping a copy of the old one to match against:

```sh
yarn overlay realign <old dump> node_modules/decoupled-drupal-mock-umami/dump language-routing-patches overlays
```

Each entity is matched by its internal id or machine name, as when the overlay was made, and the recordings beside it move with it. It only renames. An index or collection the overlay replaces keeps what the old build served, and its recordings agree with it, so a replay passes either way. Compare the result with a fresh build of your site on the preset's core, and record the overlay again where the two differ.

## The examples

[`examples/overlays/`](../examples/overlays) holds three overlays of the Umami preset, which this repository's tests replay. None is published with the preset.

| Overlay                    | What it is                                                                                                                                                                                                                   | What it changes                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `language-routing-patches` | Druxt's patches, [Decoupled Router #3111456](https://www.drupal.org/i/3111456) and [Druxt #3273228](https://www.drupal.org/i/3273228), which no release holds yet. Recorded from another install of Umami, as yours would be | Decoupled Router's answers, so many Spanish paths resolve. The preset's own build site had GraphQL modules installed and accounts that had signed in, and this install neither, so the index and Who's new differ too |
| `contact-storage`          | The contrib Contact and Contact Storage modules, with a `feedback` form                                                                                                                                                      | Adds `contact_form--contact_form`, `contact_message--feedback` and `contact_message--personal` to the index, and the configuration the modules touch                                                                  |
| `jsonapi-extras`           | JSON:API Extras in its default configuration                                                                                                                                                                                 | Adds `jsonapi_resource_config--jsonapi_resource_config` to the index, and changes the `entity_view_mode` resources. It remaps no paths                                                                                |

Overlays combine, and each changes what a suite that counts or snapshots the site sees, by design.
