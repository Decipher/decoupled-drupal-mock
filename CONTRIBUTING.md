# Contributing

## Getting set up

```sh
corepack enable
yarn install
yarn workspace decoupled-drupal-mock build
```

Installing also enables the git hooks in `.githooks/`. The repository has a dev container too, and `.mise.toml` pins the same Node the pipeline uses.

## Before you push

```sh
yarn lint
yarn typecheck
yarn test
```

The pre-commit hook runs these. To run prose lint as well, `yarn lint:prose:install` once and then `yarn lint:prose`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org). Pull requests are squash-merged, so title yours the way you would title a commit.

## A change to the engine

Check what a real Drupal answers first. To cover it with a recording, add the request to `presets/umami/oracle.txt` or a script to `presets/umami/writes.json`. Then rebuild, as `docs/building-a-preset.md` describes.

## A change a consumer sees

Add a changeset with `yarn changeset`.

## Licence

GPL-2.0-or-later. By contributing, you agree your work is released under it.
