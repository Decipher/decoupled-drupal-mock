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

const readJson = <T>(path: string): T => JSON.parse((path.endsWith('.gz') ? gunzipSync(readFileSync(path)) : readFileSync(path)).toString('utf8')) as T

/**
 * Reads a preset build from its directory and checks every file against the manifest's hashes, so a consumer
 * knows the fixtures it has are the ones it pinned.
 *
 * @param dir - The build directory, holding `manifest.json`.
 */
export const loadDump = (dir: string): Dump => {
  const manifest = readJson<Manifest>(join(dir, 'manifest.json'))
  for (const file of walk(dir)) {
    if (file === 'manifest.json') continue
    const expected = manifest.files[file]
    if (!expected) throw new Error(`${file} is not in the manifest of ${manifest.preset}.`)
    const actual = createHash('sha256').update(readFileSync(join(dir, file))).digest('hex')
    if (actual !== expected) throw new Error(`${file} does not match the manifest of ${manifest.preset}: it has changed since the build.`)
  }
  for (const file of Object.keys(manifest.files)) {
    try {
      statSync(join(dir, file))
    } catch {
      throw new Error(`${file} is in the manifest of ${manifest.preset} but missing from ${dir}.`)
    }
  }
  const dump: Dump = { manifest, index: {}, resources: {}, recorded: {} }
  for (const file of Object.keys(manifest.files)) {
    const [kind, ...rest] = file.split('/')
    if (kind === 'index') {
      dump.index[rest[0]!.replace(/\.json(\.gz)?$/, '')] = readJson<Document>(join(dir, file))
    } else if (kind === 'resources') {
      const [langcode, name] = rest as [string, string]
      dump.resources[langcode] = dump.resources[langcode] || {}
      dump.resources[langcode]![name.replace(/\.json(\.gz)?$/, '')] = readJson<Resource[]>(join(dir, file))
    } else if (kind === 'access') {
      dump.access = dump.access || {}
      dump.access[rest[0]!.replace(/\.json(\.gz)?$/, '')] = readJson<NonNullable<Dump['access']>[string]>(join(dir, file))
    } else if (kind === 'recorded') {
      const entries = readJson<Record<string, Recorded>>(join(dir, file))
      Object.assign(dump.recorded, entries)
    }
  }
  return dump
}
