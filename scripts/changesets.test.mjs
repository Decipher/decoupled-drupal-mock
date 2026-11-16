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

/**
 * The packages a changeset names, as `changeset version` reads them from its front matter. Changesets reads CRLF line
 * endings too, and `changeset add --empty` writes front matter that names nothing, which releases nothing.
 *
 * @param text - The changeset's text.
 * @returns The names, or undefined when the front matter is missing or holds a line that names no package.
 */
const namesIn = (text) => {
  const front = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n?---(?:\n|$)/)
  if (!front) return undefined
  const lines = front[1].split('\n').filter((line) => line.trim() !== '')
  const names = lines.map((line) => line.match(/^\s*['"]?([^'":\s]+)['"]?\s*:\s*['"]?(major|minor|patch)['"]?\s*$/)?.[1])
  return names.includes(undefined) ? undefined : names
}

/** The packages each pending changeset names. */
const pending = readdirSync(join(root, '.changeset'))
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .map((file) => ({ file, names: namesIn(readFileSync(join(root, '.changeset', file), 'utf8')) }))

describe('a changeset\'s front matter', () => {
  it('names the packages with their bumps, whatever the line endings', () => {
    expect(namesIn("---\n'a': minor\n\"b\": patch\n---\n\nText.\n")).toEqual(['a', 'b'])
    expect(namesIn("---\r\n'a': minor\r\nb: major\r\n---\r\n\r\nText.\r\n")).toEqual(['a', 'b'])
  })

  it('may name nothing, as changeset add --empty writes it', () => {
    expect(namesIn('---\n---\n')).toEqual([])
    expect(namesIn('---\r\n---\r\n\r\nNothing to release.\r\n')).toEqual([])
  })

  it('is unreadable when it is missing or holds a line that names no package', () => {
    expect(namesIn('Just text.\n')).toBeUndefined()
    expect(namesIn("---\n'a': sideways\n---\n")).toBeUndefined()
  })
})

describe('the pending changesets', () => {
  it('each have front matter that changeset version can read', () => {
    for (const { file, names } of pending) expect(names, file).toBeDefined()
  })

  // changeset version refuses a changeset that names an ignored package beside a released one, so a release cannot
  // be versioned until it is fixed.
  it.each(pending)('$file names only packages a release publishes', ({ names }) => {
    for (const name of names ?? []) {
      expect(packages.has(name), `${name} is not a workspace package`).toBe(true)
      expect(ignored(name), `${name} is ignored in .changeset/config.json`).toBe(false)
      expect(packages.get(name), `${name} is private`).toBe(false)
    }
  })
})
