# Agent instructions

Drupal's decoupled APIs without a Drupal site, answered from recordings of a real one. `packages/engine` answers, `packages/build` records, `presets/` holds what was recorded, and `examples/` uses it as a consumer would.

## Rules

- **This repository is public.** Nothing that resolves only on a private network may reach a tracked file: no internal URLs, hostnames, repository names or issue links, in any file. `yarn lint:private` enforces the URL-shaped half, and the rest is on you.
- **Real Drupal decides.** An answer comes from a recording or a probe of a real site, never from what seems right. Check a claim about Drupal's behaviour before changing the engine to match it.
- **Never edit a recording or a dump by hand.** Rebuild them. A hand-written answer belongs in an extension, which the fidelity claim does not cover.
- **The coverage floor in `vitest.config.ts` goes up, never down.**
- **Conventional Commits,** and the same for pull request titles. These repositories squash-merge, so the title becomes the commit subject.
- **No AI tool is credited** in commits, pull requests or tracked files.
- **A review finding is fixed on the pull request it was raised on,** not answered with a later one.

## Checks

```sh
yarn workspace decoupled-drupal-mock build
yarn lint
yarn typecheck
yarn test
```

The pre-commit hook runs these. `examples/` runs in CI, as it needs browsers.
