import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const config = JSON.parse(readFileSync(join(root, '.changeset', 'config.json'), 'utf8'))

/** Every workspace package, by name, with whether it is private. */
const packages = new Map(
  ['packages', 'presets', 'examples'].flatMap((group) => readdirSync(join(root, group))
    .map((name) => join(root, group, name, 'package.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')))
    .map((manifest) => [manifest.name, manifest.private === true])),
)

/** Whether a name matches one of the config's ignore patterns, where `*` stands for any run of characters. */
const ignored = (name) => config.ignore.some((pattern) => new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(name))

/** The packages each pending changeset names, as `changeset version` reads them from its front matter. */
const pending = readdirSync(join(root, '.changeset'))
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .map((file) => {
    const front = readFileSync(join(root, '.changeset', file), 'utf8').match(/^---\n([\s\S]*?)\n---/)
    const names = (front ? front[1].split('\n') : []).map((line) => line.match(/^['"]?([^'":]+)['"]?\s*:/)?.[1]).filter(Boolean)
    return { file, names }
  })

describe('the pending changesets', () => {
  it('each name at least one package', () => {
    for (const { file, names } of pending) expect(names, file).not.toEqual([])
  })

  // changeset version refuses a changeset that names an ignored package beside a released one, so a release cannot
  // be versioned until it is fixed.
  it.each(pending)('$file names only packages a release publishes', ({ names }) => {
    for (const name of names) {
      expect(packages.has(name), `${name} is not a workspace package`).toBe(true)
      expect(ignored(name), `${name} is ignored in .changeset/config.json`).toBe(false)
      expect(packages.get(name), `${name} is private`).toBe(false)
    }
  })
})
