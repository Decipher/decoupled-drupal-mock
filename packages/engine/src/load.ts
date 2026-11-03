import { createHash, randomFillSync } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { useRandomSource } from './bytes.js'
import { UNSAFE_KEYS } from './own.js'
import type { Document, Dump, Manifest, Recorded, Resource } from './types.js'
import type { Extension, RecordedOverlay } from './extend.js'
import { DUMP_FORMAT } from './format.js'

// Node 16 and 18 have no Web Crypto global, so a dump read in Node takes its random values from node:crypto.
useRandomSource((bytes) => {
  randomFillSync(bytes)
})

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
  // A dump in a layout this engine does not know would load, and then answer from keys that are not there.
  const format = manifest.format ?? 1
  if (format !== DUMP_FORMAT) throw new Error(`${manifest.preset} is a dump of format ${format}, and this engine reads format ${DUMP_FORMAT}. Install the release of the engine built for it.`)
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
  // Maps with no prototype, and a file whose path names a prototype key refused, so no dump writes into Object.
  const dump: Dump = { manifest, index: Object.create(null), resources: Object.create(null), recorded: Object.create(null) }
  const parsed = <T>(file: string): T => parseBytes<T>(file, bytes.get(file)!)
  for (const file of Object.keys(manifest.files)) {
    const [kind, ...rest] = file.split('/')
    if (rest.some((segment) => UNSAFE_KEYS.has(segment.replace(/\.json(\.gz)?$/, '')))) throw new Error(`${file} names a key no dump may use.`)
    if (kind === 'index') {
      dump.index[rest[0]!.replace(/\.json(\.gz)?$/, '')] = parsed<Document>(file)
    } else if (kind === 'resources') {
      const [langcode, name] = rest as [string, string]
      dump.resources[langcode] = dump.resources[langcode] || Object.create(null)
      dump.resources[langcode]![name.replace(/\.json(\.gz)?$/, '')] = parsed<Resource[]>(file)
    } else if (kind === 'access') {
      const access: NonNullable<Dump['access']> = dump.access ?? (dump.access = Object.create(null) as NonNullable<Dump['access']>)
      access[rest[0]!.replace(/\.json(\.gz)?$/, '')] = parsed<NonNullable<Dump['access']>[string]>(file)
    } else if (kind === 'identities.json') {
      dump.identities = parsed<NonNullable<Dump['identities']>>(file)
    } else if (kind === 'recorded') {
      const entries = parsed<Record<string, Recorded>>(file)
      Object.assign(dump.recorded, entries)
    }
  }
  return dump
}

/**
 * An extension from a recorded overlay: what the same site answers with a module or a patch the preset's baseline
 * does not have. A path names an overlay file of your own, as `overlay.ts` writes one; a bare name, one the preset
 * ships beside its dump.
 *
 * @param dumpDir - The preset's dump directory.
 * @param overlay - A path to an overlay file (`./overlays/my-patch.json.gz`), or the name of one the preset ships.
 * @returns The extension.
 * @throws {Error} When there is no such file or overlay, naming the ones the preset has.
 */
export const loadOverlay = (dumpDir: string, overlay: string): Extension => {
  const isPath = overlay.endsWith('.json.gz') || overlay.includes('/') || overlay.includes('\\')
  const dir = join(dumpDir, '..', 'overlays')
  const file = isPath ? resolve(overlay) : join(dir, `${overlay}.json.gz`)
  if (!existsSync(file)) {
    if (isPath) throw new Error(`No overlay file at ${file}.`)
    const known = existsSync(dir) ? readdirSync(dir).map((entry) => entry.replace(/\.json\.gz$/, '')) : []
    throw new Error(`No overlay named ${overlay}. This preset has: ${known.join(', ') || 'none'}. An overlay of your own is named by its path.`)
  }
  const recorded = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as RecordedOverlay & { name?: string }
  return { name: recorded.name || basename(file).replace(/\.json\.gz$/, ''), overlay: recorded }
}
