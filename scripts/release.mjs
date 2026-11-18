// What the Release workflow asks of the repository: which packages publish, what is pending, which versions are not
// released yet, the release notes for a version, and whether a packed tarball holds what its package names.
//
// Usage: node scripts/release.mjs pending | packages | unreleased | notes <name> | check <tarball> <name>
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The packages a release publishes. A package that another names as a dependency or a peer comes before it, so the
 * engine goes before every preset, whatever the directories are called. Packages otherwise keep their name order.
 *
 * @param root - The repository's root.
 * @returns Each package's name, directory, version and npm dist-tag.
 */
export const publicPackages = (root) => {
  const found = ['packages', 'presets']
    .flatMap((group) => readdirSync(join(root, group)).map((name) => join(group, name)))
    .filter((dir) => existsSync(join(root, dir, 'package.json')))
    .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) }))
    .filter(({ manifest }) => manifest.private !== true)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
  const names = new Set(found.map(({ manifest }) => manifest.name))
  const needs = new Map(found.map(({ manifest }) => [manifest.name, Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter((name) => names.has(name))]))
  const ordered = []
  const visit = (name, path = []) => {
    if (ordered.includes(name)) return
    if (path.includes(name)) throw new Error(`The packages depend on each other in a loop: ${[...path, name].join(' -> ')}.`)
    for (const need of needs.get(name)) visit(need, [...path, name])
    ordered.push(name)
  }
  for (const { manifest } of found) visit(manifest.name)
  return ordered.map((name) => found.find(({ manifest }) => manifest.name === name))
    .map(({ dir, manifest }) => ({ name: manifest.name, dir, version: manifest.version, tag: distTag(manifest.version) }))
}

/**
 * The npm dist-tag a version goes out under. npm 11 refuses to publish a prerelease without one, a prerelease under
 * `latest` would be what a plain install gets, and npm moves `latest` to whatever it publishes, so a stable release
 * from an older line takes a tag of its own.
 *
 * @param version - The version.
 * @param latest - The version npm calls `latest` for the package, or null when it has none or nobody asked.
 * @returns The prerelease's name, such as `alpha` or `dev`, `latest-<major>` below npm's latest, or `latest`.
 */
export const distTag = (version, latest = null) => {
  const prerelease = version.split('+')[0].split('-').slice(1).join('-')
  if (prerelease) return prerelease.split('.')[0]
  const core = (value) => value.split(/[-+]/)[0].split('.').map(Number)
  if (latest) {
    const [mine, theirs] = [core(version), core(latest)]
    const order = mine.map((part, index) => part - theirs[index]).find((difference) => difference !== 0) ?? 0
    if (order < 0) return `latest-${mine[0]}`
  }
  return 'latest'
}

/**
 * How much waits for the version pull request: each pending changeset, and leaving prerelease mode, which versions
 * the packages to their stable release with no changeset of its own.
 *
 * @param root - The repository's root.
 */
export const pendingChangesets = (root) => {
  const changesets = readdirSync(join(root, '.changeset')).filter((file) => file.endsWith('.md') && file !== 'README.md').length
  const pre = join(root, '.changeset', 'pre.json')
  const exiting = existsSync(pre) && JSON.parse(readFileSync(pre, 'utf8')).mode === 'exit'
  return changesets + (exiting ? 1 : 0)
}

/**
 * A version's section of a changelog, without its heading.
 *
 * @param changelog - The changelog's text.
 * @param version - The version.
 * @returns The section, or an empty string when the changelog has none.
 */
export const releaseNotes = (changelog, version) => {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${version}`)
  if (start < 0) return ''
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return `${lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()}\n`
}

/**
 * The packages whose version is not fully released. A version is released once npm has it and its GitHub Release
 * exists, so a run that published and then failed to create the Release finishes the job when it runs again. Each
 * keeps the dist-tag it goes out under, which needs npm's `latest` to tell a release from an older line.
 *
 * @param packages - The packages, as `publicPackages` gives them.
 * @param ask - How to ask npm and GitHub.
 * @param ask.onNpm - Whether npm has `name@version`.
 * @param ask.hasRelease - Whether GitHub has the Release tagged `name@version`.
 * @param ask.latest - The version npm calls `latest` for a package, or null.
 */
export const unreleased = (packages, { onNpm, hasRelease, latest = () => null }) => packages
  .map((pkg) => ({ ...pkg, published: onNpm(`${pkg.name}@${pkg.version}`) }))
  .filter((pkg) => !pkg.published || !hasRelease(`${pkg.name}@${pkg.version}`))
  .map((pkg) => ({ ...pkg, tag: distTag(pkg.version, latest(pkg.name)) }))

/**
 * What a packed tarball lacks of what its manifest names: every `bin`, every `exports` target and every `files` entry.
 *
 * @param manifest - The package's manifest.
 * @param entries - The tarball's entries, each under `package/`.
 * @returns The paths it lacks.
 */
export const missingFromTarball = (manifest, entries) => {
  const held = new Set(entries.map((entry) => entry.replace(/^package\//, '').replace(/\/$/, '')))
  const targets = (value) => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(targets) : []
  const wanted = [
    'package.json',
    ...targets(manifest.bin),
    ...targets(manifest.exports),
    ...(manifest.files ?? []),
  ].map((path) => path.replace(/^\.\//, ''))
  const has = (path) => held.has(path) || [...held].some((entry) => entry.startsWith(`${path}/`))
  return [...new Set(wanted)].filter((path) => !has(path))
}

/* c8 ignore start */
if (process.argv[1]?.endsWith('release.mjs')) {
  const root = process.cwd()
  const [command, ...rest] = process.argv.slice(2)
  const quiet = (file, args) => {
    try {
      execFileSync(file, args, { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  const find = (name) => {
    const pkg = publicPackages(root).find((candidate) => candidate.name === name)
    if (!pkg) throw new Error(`${name} is not a package a release publishes.`)
    return pkg
  }
  if (command === 'pending') console.log(pendingChangesets(root))
  else if (command === 'packages') console.log(JSON.stringify(publicPackages(root)))
  else if (command === 'unreleased') {
    const view = (...args) => {
      try {
        return execFileSync('npm', ['view', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      } catch {
        return ''
      }
    }
    const onNpm = (spec) => view(spec, 'version') !== ''
    const latest = (name) => view(name, 'dist-tags.latest') || null
    console.log(JSON.stringify(unreleased(publicPackages(root), { onNpm, latest, hasRelease: (tag) => quiet('gh', ['release', 'view', tag]) })))
  } else if (command === 'notes') {
    const pkg = find(rest[0])
    const changelog = join(root, pkg.dir, 'CHANGELOG.md')
    process.stdout.write(existsSync(changelog) ? releaseNotes(readFileSync(changelog, 'utf8'), pkg.version) : '')
  } else if (command === 'check') {
    const [tarball, name] = rest
    const manifest = JSON.parse(readFileSync(join(root, find(name).dir, 'package.json'), 'utf8'))
    const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n').filter(Boolean)
    const missing = missingFromTarball(manifest, entries)
    if (missing.length) {
      console.error(`${tarball} lacks ${missing.join(', ')}.`)
      process.exit(1)
    }
    console.log(`${tarball} holds everything ${name} names.`)
  } else {
    console.error('Usage: node scripts/release.mjs pending | packages | unreleased | notes <name> | check <tarball> <name>')
    process.exit(1)
  }
}
/* c8 ignore stop */
