#!/usr/bin/env -S node --experimental-strip-types
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarise } from './dump-diff.ts'

/**
 * The page that says what a preset's rebuild changed, against the dump as it was before.
 *
 * @param preset - The preset's name, as its directory under `presets/` names it.
 * @param summary - What `summarise` wrote.
 * @returns The page's text, the summary's sections under its title.
 */
export const rebuildPage = (preset: string, summary: string): string => `# The ${preset} rebuild

\`yarn rebuild:summary --write\` writes this page from the dump before the rebuild and the dump after it. The pipeline
writes it again and fails when the two differ, so a change to the recordings merges only with this page beside it.

${summary}`

/**
 * Writes or checks the page beside every preset whose recordings differ from those at a base.
 *
 * @param options - What to compare, and where.
 * @param options.base - The commit to compare with.
 * @param options.write - Whether to write each page, rather than check the one committed.
 * @param options.root - The repository's root.
 * @param options.log - Where progress goes.
 * @param options.error - Where a page that does not match goes.
 * @returns Whether every page says what its rebuild changed.
 */
export const rebuildSummaries = ({ base, write, root, log = console.log, error = console.error }: { base: string, write: boolean, root: string, log?: (line: string) => void, error?: (line: string) => void }): boolean => {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  // The base comes from the command line or the pipeline. Git reads its commit id, never the name, so a name cannot pass as an option.
  let commit: string
  try {
    commit = git('rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`).trim()
  } catch {
    throw new Error(`${base} is not a commit in this repository.`)
  }
  let ok = true
  for (const preset of readdirSync(join(root, 'presets')).sort()) {
    const dir = join('presets', preset)
    if (!existsSync(join(root, dir, 'dump', 'manifest.json'))) continue
    const file = join(dir, 'REBUILD.md')
    // A pull request that leaves the recordings alone has nothing to describe, and the page stays as the last rebuild left it.
    const recordings = [join(dir, 'dump'), join(dir, 'oracle')]
    // git diff does not see untracked files, so a recording not yet staged is looked for separately.
    let differs = git('ls-files', '--others', '--exclude-standard', '--', ...recordings).trim() !== ''
    try {
      git('diff', '--quiet', commit, '--', ...recordings)
    } catch {
      differs = true
    }
    if (!differs) {
      log(`${preset}: the recordings are as ${base} has them`)
      continue
    }
    const before = mkdtempSync(join(tmpdir(), `${preset}-before-`))
    let page: string
    try {
      // A preset the base does not have yet is summarised against no build at all.
      let atBase = true
      try {
        git('cat-file', '-e', `${commit}:${dir}`)
      } catch {
        atBase = false
      }
      // Two commands and a file between them, rather than a shell pipe.
      if (atBase) {
        const archive = join(before, 'base.tar')
        git('archive', `--output=${archive}`, commit, '--', dir)
        execFileSync('tar', ['-x', '-f', archive, '-C', before])
      }
      page = rebuildPage(preset, summarise(join(before, dir, 'dump'), join(root, dir, 'dump'), { from: join(before, dir, 'oracle'), to: join(root, dir, 'oracle') }))
    } finally {
      rmSync(before, { recursive: true, force: true })
    }
    /* c8 ignore next */
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, page)
    if (write) {
      writeFileSync(join(root, file), page)
      log(`${preset}: wrote ${file}`)
    } else if (!existsSync(join(root, file)) || readFileSync(join(root, file), 'utf8') !== page) {
      ok = false
      error(`${preset}: ${file} does not say what this rebuild changed. Run \`yarn rebuild:summary ${base} --write\`, read it, and commit it. It should say:\n\n${page}`)
    } else {
      log(`${preset}: ${file} says what this rebuild changed`)
    }
  }
  return ok
}

/* c8 ignore start */
if (process.argv[1]?.endsWith('rebuild-summary.ts')) {
  const base = process.argv.slice(2).find((arg) => !arg.startsWith('--')) || process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || process.env.GITHUB_BASE_SHA || 'origin/1.0.x'
  if (!rebuildSummaries({ base, write: process.argv.includes('--write'), root: process.cwd() })) process.exit(1)
}
/* c8 ignore stop */
