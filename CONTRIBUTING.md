# Contributing

Changes go to the `1.0.x` branch, by a merge request on GitLab or a pull request on GitHub. GitLab's pipeline is the full gate: GitHub's runs the lint, type checks, tests and examples, but not the coverage floor, the size budget, the prose linter, the link checker or the secret scan.

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

The maintainer cuts releases from `1.0.x`: `yarn changeset version` writes the versions and changelogs, and `yarn changeset publish` publishes both packages.

## Licence

GPL-2.0-or-later. By contributing, you agree your work is released under it.
