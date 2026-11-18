# Contributing

Changes go to the `1.0.x` branch, by a merge request on GitLab or a pull request on GitHub. GitLab's pipeline is the full gate: GitHub's runs the lint, type checks, tests with the coverage floor and examples, and uploads coverage to Codecov, but not the size budget, the prose linter, the link checker or the secret scan.

## Getting set up

```sh
corepack enable
yarn install
yarn workspace decoupled-drupal-mock build
```

Installing also enables the git hooks in `.githooks/`. The repository has a dev container too, and `.mise.toml` pins the same Node the pipeline uses.

## Before you push

The pre-commit hook runs the fast checks, the same as `mise run check`:

```sh
yarn lint
yarn typecheck
yarn test
```

The pipeline runs more, and each has a local command:

| Check                                                                       | Locally                                                                                                   |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The coverage floor in `vitest.config.ts`, which `yarn test` does not apply  | `yarn test:coverage`                                                                                      |
| The size budget in `.size-limit.json`                                       | `yarn size`, after a build                                                                                |
| Known vulnerabilities in production dependencies                            | `yarn lint:audit`                                                                                         |
| Prose, in changed Markdown, every commit message and the description        | `yarn lint:prose:install` once, then `PROSE_BASE_SHA=$(git merge-base HEAD origin/1.0.x) yarn lint:prose` |
| Links between the repository's files                                        | CI only (lychee `--offline`)                                                                              |
| Secrets, in the whole history and inside every gzipped recording            | CI only (gitleaks)                                                                                        |
| A packed install, which refuses a `workspace:` range in a published package | CI only (`test:pack`)                                                                                     |
| YAML and the workflows                                                      | CI only (yamllint and actionlint)                                                                         |

The prose linter reads the merge request description too. To check one before you open it, set `MERGE_REQUEST_DESCRIPTION="$(cat description.md)"` as well.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org), checked by commitlint in the `commit-msg` hook and in the pipeline (`yarn lint:commit`):

- The header and each body line are 100 characters at most, and the subject starts in lower case.
- A line crediting an AI tool, such as `Co-authored-by: Claude` or `Generated with Copilot`, is refused. Disclose AI use in the description instead: see below.

Merge requests are squash-merged, so give yours the title you would give its commit.

## AI use

This project follows [Drupal.org's policy on AI-generated contributions](https://www.drupal.org/docs/develop/issues/issue-procedures-and-etiquette/issue-etiquette#s-ai-generated-content). If an AI tool wrote code, tests, documentation or recordings in your change, say so in the description's AI disclosure section, and name the tool and what it did. Single-line autocomplete doesn't need disclosing. Whoever opens the merge request is responsible for all of it, however it was written, and a change to what the mock answers is still checked against a real Drupal.

## A change to the engine

Check what a real Drupal answers first. To cover it with a recording, add the request to `presets/umami/oracle.txt` or a script to `presets/umami/writes.json`. Then rebuild, as [Building a preset](docs/building-a-preset.md) describes. A recording is rebuilt, never edited by hand.

## Changes that affect users

Add a changeset with `yarn changeset`. The engine and the Umami preset are versioned together, so a changeset names both. `packages/build` and the examples are not published and need none.

## Releases

Releases come from `1.0.x`, through the Release workflow in `.github/workflows/release.yml`:

1. A merged change with a changeset publishes a dev snapshot of every package it releases, such as `1.0.0-dev.20261118084548`, under the `dev` dist-tag. Install one with `decoupled-drupal-mock@dev`. Nothing is committed and no git tag is made. A manual run of the workflow cuts a snapshot too, and does nothing else.
2. The same push opens or updates the "version packages" pull request. It holds the new versions with their changelogs, and the lock file that matches them. Its description lists what merging it releases, and under which dist-tag.
3. Merging that pull request is the release decision. The push that follows packs every package npm does not have at its version yet and publishes it under its dist-tag. That is `alpha` while the line is in alpha, `latest` for a stable release, and `latest-<major>` for a stable release from an older line, so `latest` never moves back. Each published version gets a tag and a GitHub Release.

Publishing uses npm trusted publishing, so no token is stored. It runs only once the repository variable `NPM_PUBLISH` is `true`, and the `release` environment can hold a release for a reviewer. Until then each run packs and checks the tarballs as a dry run. A pull request that changes how a release is made gets the same rehearsal, for a snapshot and for a release.

A package npm has never seen needs its first version published by hand before npm lets it trust the workflow. After that, set up the trusted publisher on npmjs.com for each package. It names this repository and the `release.yml` workflow, and leaves the environment empty: npm holds one environment per package, and the dev snapshots publish without one. npm drops a trusted publisher that has not published within two days of being set up, so set them up shortly before the release that will use them.

## Licence

GPL-2.0-or-later. By contributing, you agree your work is released under it.
