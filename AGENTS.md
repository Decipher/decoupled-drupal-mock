# Agent instructions

Drupal's decoupled APIs without a Drupal site, answered from recordings of a real one. `packages/engine` serves the mock's answers. `packages/build` records presets from a real site, and `presets/` stores them. `examples/` holds projects that use the mock as a consumer would.

## Rules

- **This repository is public.** Nothing that resolves only on a private network may reach a tracked file: no internal URLs, hostnames, repository names or issue links, in any file. `yarn lint:private` enforces the URL-shaped half. Check the rest yourself.
- **Match real Drupal.** An answer comes from a recording or a probe of a real site, never from what seems right. Check a claim about Drupal's behaviour before changing the engine to match it.
- **Never edit a recording or a dump by hand.** Rebuild them. A hand-written answer belongs in an extension, which the fidelity claim does not cover.
- **The coverage floor in `vitest.config.ts` goes up, never down.**
- **Conventional Commits,** and the same for pull request titles. These repositories squash-merge, so the title becomes the commit subject.
- **No AI tool is credited** in commits or tracked files: commitlint refuses the trailers. AI use is disclosed in the merge request's AI disclosure section instead, as Drupal.org's policy asks. Fill it in for every merge request an agent writes.
- **A review finding is fixed on the pull request it was raised on,** not answered with a later one.
- **Target `1.0.x`.** A change someone using the packages sees gets its own changeset.
- **Commit headers and body lines are 100 characters at most,** and the subject starts in lower case.
- **The prose linter reads commit messages and the merge request description too,** not only Markdown. No em-dashes, semicolons joining sentences, three-item lists of parallel phrases, or the other patterns `.vale/styles` lists.

## Checks

```sh
yarn workspace decoupled-drupal-mock build
yarn lint
yarn typecheck
yarn test
yarn test:coverage
yarn size
```

The pre-commit hook runs the first four. `examples/vitest` runs inside `yarn test`. The browser examples run in CI only: GitLab runs Playwright and Next.js, and GitHub runs Jest, Cypress and Playwright. [Contributing](CONTRIBUTING.md) lists everything else the pipeline checks.
