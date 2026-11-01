import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Document, Dump, Manifest, Recorded, Resource } from './types.js'

/** Every file under a directory, as paths relative to it. */
const walk = (dir: string, base = dir): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path).split('\\').join('/')]
})

const parseBytes = <T>(file: string, content: Buffer): T => JSON.parse((file.endsWith('.gz') ? gunzipSync(content) : content).toString('utf8')) as T
const readJson = <T>(path: string): T => parseBytes<T>(path, readFileSync(path))

/**
 * Reads a preset build from its directory and checks every file against the manifest's hashes, so a consumer
 * knows the fixtures it has are the ones it pinned.
 *
 * @param dir - The build directory, holding `manifest.json`.
 */
export const loadDump = (dir: string): Dump => {
  const manifest = readJson<Manifest>(join(dir, 'manifest.json'))
  // Each file is read once: the bytes that pass the hash check are the bytes parsed.
  const bytes = new Map<string, Buffer>()
  for (const file of walk(dir)) {
    if (file === 'manifest.json') continue
    const expected = manifest.files[file]
    if (!expected) throw new Error(`${file} is not in the manifest of ${manifest.preset}.`)
    const content = readFileSync(join(dir, file))
    const actual = createHash('sha256').update(content).digest('hex')
    if (actual !== expected) throw new Error(`${file} does not match the manifest of ${manifest.preset}: it has changed since the build.`)
    bytes.set(file, content)
  }
  for (const file of Object.keys(manifest.files)) {
    try {
      statSync(join(dir, file))
    } catch {
      throw new Error(`${file} is in the manifest of ${manifest.preset} but missing from ${dir}.`)
    }
  }
  const dump: Dump = { manifest, index: {}, resources: {}, recorded: {} }
  const parsed = <T>(file: string): T => parseBytes<T>(file, bytes.get(file)!)
  for (const file of Object.keys(manifest.files)) {
    const [kind, ...rest] = file.split('/')
    if (kind === 'index') {
      dump.index[rest[0]!.replace(/\.json(\.gz)?$/, '')] = parsed<Document>(file)
    } else if (kind === 'resources') {
      const [langcode, name] = rest as [string, string]
      dump.resources[langcode] = dump.resources[langcode] || {}
      dump.resources[langcode]![name.replace(/\.json(\.gz)?$/, '')] = parsed<Resource[]>(file)
    } else if (kind === 'access') {
      dump.access = dump.access || {}
      dump.access[rest[0]!.replace(/\.json(\.gz)?$/, '')] = parsed<NonNullable<Dump['access']>[string]>(file)
    } else if (kind === 'identities.json') {
      dump.identities = parsed<NonNullable<Dump['identities']>>(file)
    } else if (kind === 'recorded') {
      const entries = parsed<Record<string, Recorded>>(file)
      Object.assign(dump.recorded, entries)
    }
  }
  return dump
}
