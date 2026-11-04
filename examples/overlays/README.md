# Example overlays

Overlays of the Umami preset, made as [Overlays](../../docs/overlays.md) describes, which the engine's fidelity tests replay. None is published with the preset.

- `language-routing-patches.json.gz`, Druxt's, recorded from another install of Umami with two patches no release holds yet.
- `contact-storage.json.gz`, the contrib Contact and Contact Storage modules, with the answers to a visitor's two contact form submissions.
- `jsonapi-extras.json.gz`, JSON:API Extras in its default configuration.

`oracle/` holds each site's real answers, and `manifest.json` the hash of every file here. The overlay tool writes all three: none is edited by hand.

## Recording one again

`recipes/` holds a Drupal recipe for each overlay a recipe can express. `record.sh` builds the preset's site as `presets/umami/site.sh` does, applies the recipe over it, then crawls the site and writes the overlay:

```sh
export DECOUPLED_DRUPAL_MOCK_CLIENT_SECRET=$(openssl rand -hex 24)
examples/overlays/record.sh contact-storage ../contact-storage-site 8907
```

A recipe's `writes.json` holds write scripts, recorded with the site's answers. `language-routing-patches` has no recipe, because a recipe can't patch a module. Build the preset's site, add [Decoupled Router #3111456](https://www.drupal.org/i/3111456) and [Druxt #3273228](https://www.drupal.org/i/3273228) to its `composer.json` as patches, then crawl it and run `yarn overlay` as [Overlays](../../docs/overlays.md) describes.
