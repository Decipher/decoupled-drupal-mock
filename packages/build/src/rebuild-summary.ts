#!/usr/bin/env -S node --experimental-strip-types
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarise } from './dump-diff.ts'

/** What a pull request whose recordings are all as its base has them says, in place of a summary. */
export const NO_REBUILD = 'This change leaves every preset\'s recordings as the base has them.\n'

/**
 * The summary of one preset's rebuild, under the preset's name, with the summary's sections a level below it.
 *
 * @param preset - The preset's name, as its directory under `presets/` names it.
 * @param summary - What `summarise` wrote.
 * @returns The preset's part of the review summary.
 */
export const rebuildSection = (preset: string, summary: string): string => `## The ${preset} rebuild\n\n${summary.replace(/^## /gm, '### ')}`

/**
 * Says what each preset's rebuild changed against a base, for the review of the change that holds it. A rebuild's
 * recordings are gzipped, so a reviewer reads this rather than their diff. Nothing is written beside the recordings.
 *
 * @param options - What to compare, and where.
 * @param options.base - The commit to compare with.
 * @param options.root - The repository's root.
 * @param options.log - Where progress goes.
 * @param options.error - Where recordings that are not a build go.
 * @returns Whether every preset whose recordings changed is a build, and the summary of them all.
 */
export const rebuildSummaries = ({ base, root, log = console.log, error = console.error }: { base: string, root: string, log?: (line: string) => void, error?: (line: string) => void }): { ok: boolean, summary: string } => {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  // The base comes from the command line or the pipeline. Git reads its commit id, never the name, so a name cannot pass as an option.
  let commit: string
  try {
    commit = git('rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`).trim()
  } catch {
    throw new Error(`${base} is not a commit in this repository.`)
  }
  let ok = true
  const sections: string[] = []
  const presets = readdirSync(join(root, 'presets'), { withFileTypes: true }).filter((entry) => entry.isDirectory())
  for (const preset of presets.map((entry) => entry.name).sort()) {
    const dir = join('presets', preset)
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
    // Recordings that changed must still be a build, or there is nothing to summarise.
    const manifest = join(dir, 'dump', 'manifest.json')
    if (!existsSync(join(root, manifest))) {
      ok = false
      error(`${preset}: the recordings changed, but ${manifest} is missing, so they are not a build. Rebuild the preset.`)
      continue
    }
    const before = mkdtempSync(join(tmpdir(), `${preset}-before-`))
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
      sections.push(rebuildSection(preset, summarise(join(before, dir, 'dump'), join(root, dir, 'dump'), { from: join(before, dir, 'oracle'), to: join(root, dir, 'oracle') })))
      log(`${preset}: the recordings changed`)
    } finally {
      rmSync(before, { recursive: true, force: true })
    }
  }
  return { ok, summary: sections.length ? sections.join('\n') : NO_REBUILD }
}

/**
 * Reads the command's arguments: the base to compare with, and `--out` with the file to write the summary to.
 *
 * @param args - The arguments after the script's name.
 * @param env - Where a pipeline names the base, when the arguments do not.
 * @returns The base and the file, if one is named.
 */
export const rebuildArgs = (args: string[], env: Record<string, string | undefined> = {}): { base: string, out?: string } => {
  const at = args.indexOf('--out')
  const out = at >= 0 ? args[at + 1] : undefined
  const named = args.find((arg, index) => !arg.startsWith('--') && (at < 0 || index !== at + 1))
  const base = named || env.CI_MERGE_REQUEST_DIFF_BASE_SHA || env.GITHUB_BASE_SHA || 'origin/1.0.x'
  return out === undefined ? { base } : { base, out }
}

/* c8 ignore start */
if (process.argv[1]?.endsWith('rebuild-summary.ts')) {
  const { base, out } = rebuildArgs(process.argv.slice(2), process.env)
  const { ok, summary } = rebuildSummaries({ base, root: process.cwd(), log: console.error })
  process.stdout.write(summary)
  if (out) writeFileSync(out, summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  if (!ok) process.exit(1)
}
/* c8 ignore stop */
