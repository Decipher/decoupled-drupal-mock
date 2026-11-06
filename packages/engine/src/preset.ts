import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The build directory a preset names: a directory on disk, a preset package, or a package's short name (`umami`).
 *
 * @param target - The directory or the package.
 * @param from - The directory the package is looked up from first.
 * @param beside - The directory it is looked up from next. By default the engine's own, where `npx` installs a preset beside it.
 * @returns The directory.
 * @throws {Error} When nothing is there, with a message that names what was wrong.
 */
export const presetDir = (target: string, from = process.cwd(), beside?: string): string => {
  // A path that is not there is a mistake to name, not a package to look for.
  const isPackage = !target.startsWith('.') && !target.startsWith('/') && (target.startsWith('@') ? target.split('/').length === 2 : !target.includes('/'))
  // A bare name is served as a directory only when it holds a build, since a project can have its own `umami`.
  if (existsSync(target) && (!isPackage || existsSync(join(target, 'manifest.json')))) return target
  const candidates = !isPackage ? [] : target.includes('-') || target.startsWith('@') ? [target] : [`decoupled-drupal-mock-${target}`, target]
  // A package with no build in it is not a preset, so the search goes on past it.
  // An unrelated package can share the short name, as `umami` does on npm.
  const isPreset = (root: string) => existsSync(join(root, 'dump', 'manifest.json'))
  // The engine's own directory is worked out only when the current one has no preset.
  // A consumer's CommonJS bundle can leave import.meta empty, and then there is none to look in.
  const bases = [() => from, () => beside ?? (import.meta.url ? dirname(fileURLToPath(import.meta.url)) : undefined)]
  for (const base of bases) {
    const dir = base()
    if (!dir) continue
    const require = createRequire(join(dir, 'noop.js'))
    for (const candidate of candidates) {
      try {
        const root = dirname(require.resolve(`${candidate}/package.json`))
        if (isPreset(root)) return join(root, 'dump')
      } catch {
        // A package whose exports leave out its package.json is still found where Node looks for it.
        const found = (require.resolve.paths(candidate) || []).map((path) => join(path, candidate)).find(isPreset)
        if (found) return join(found, 'dump')
      }
    }
  }
  throw new Error(`${target} is ${isPackage ? 'not an installed preset package' : 'not a directory'}. Name a preset package or a build directory holding manifest.json.`)
}
