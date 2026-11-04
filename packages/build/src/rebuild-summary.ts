#!/usr/bin/env -S node --experimental-strip-types
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

/* c8 ignore start */
if (process.argv[1]?.endsWith('rebuild-summary.ts')) {
  const write = process.argv.includes('--write')
  const base = process.argv.slice(2).find((arg) => !arg.startsWith('--')) || process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || process.env.GITHUB_BASE_SHA || 'origin/1.0.x'
  const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' })
  let failed = false
  for (const preset of readdirSync('presets')) {
    const dir = join('presets', preset)
    if (!existsSync(join(dir, 'dump', 'manifest.json'))) continue
    const file = join(dir, 'REBUILD.md')
    // A pull request that leaves the recordings alone has nothing to describe, and the page stays as the last rebuild left it.
    try {
      git('diff', '--quiet', base, '--', join(dir, 'dump'), join(dir, 'oracle'))
      console.log(`${preset}: the recordings are as ${base} has them`)
      continue
    } catch {
      // They differ.
    }
    const before = mkdtempSync(join(tmpdir(), `${preset}-before-`))
    execFileSync('sh', ['-c', `git archive "${base}" "${dir}" | tar -x -C "${before}"`])
    const page = rebuildPage(preset, summarise(join(before, dir, 'dump'), join(dir, 'dump'), { from: join(before, dir, 'oracle'), to: join(dir, 'oracle') }))
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, page)
    if (write) {
      writeFileSync(file, page)
      console.log(`${preset}: wrote ${file}`)
    } else if (!existsSync(file) || readFileSync(file, 'utf8') !== page) {
      failed = true
      console.error(`${preset}: ${file} does not say what this rebuild changed. Run \`yarn rebuild:summary --write\`, read it, and commit it. It should say:\n\n${page}`)
    } else {
      console.log(`${preset}: ${file} says what this rebuild changed`)
    }
  }
  if (failed) process.exit(1)
}
/* c8 ignore stop */
