import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { UNSAFE_KEYS } from './own.js'
import type { ComposeMeta, Document, Dump, Manifest, Recorded, Resource } from './types.js'

/** Every file under a directory, as paths relative to it. */
const walk = (dir: string, base = dir): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path).split('\\').join('/')]
})

/** A file's content: text for `.graphql`, else its JSON, gunzipped when its name ends in `.gz`. */
export const parseFile = <T>(file: string, bytes: Uint8Array | string): T => {
  const text = typeof bytes === 'string' ? bytes : (file.endsWith('.gz') ? gunzipSync(bytes) : Buffer.from(bytes)).toString('utf8')
  return (file.endsWith('.graphql') ? text : JSON.parse(text)) as T
}

const readJson = <T>(path: string): T => parseFile<T>(path, readFileSync(path))

/** A dump from its manifest and a reader of each file's parsed content, however the files are stored. */
export const assemble = (manifest: Manifest, read: <T>(file: string) => T): Dump => {
  // Maps with no prototype, and a file whose path names a prototype key refused, so no dump writes into Object.
  const dump: Dump = { manifest, index: Object.create(null), resources: Object.create(null), recorded: Object.create(null) }
  for (const file of Object.keys(manifest.files)) {
    const [kind, ...rest] = file.split('/')
    if (rest.some((segment) => UNSAFE_KEYS.has(segment.replace(/\.(json(\.gz)?|graphql)$/, '')))) throw new Error(`${file} names a key no dump may use.`)
    if (kind === 'index') {
      dump.index[rest[0]!.replace(/\.json(\.gz)?$/, '')] = read<Document>(file)
    } else if (kind === 'resources') {
      const [langcode, name] = rest as [string, string]
      dump.resources[langcode] = dump.resources[langcode] || Object.create(null)
      dump.resources[langcode]![name.replace(/\.json(\.gz)?$/, '')] = read<Resource[]>(file)
    } else if (kind === 'access') {
      const access: NonNullable<Dump['access']> = dump.access ?? (dump.access = Object.create(null) as NonNullable<Dump['access']>)
      access[rest[0]!.replace(/\.json(\.gz)?$/, '')] = read<NonNullable<Dump['access']>[string]>(file)
    } else if (kind === 'identities.json') {
      dump.identities = read<NonNullable<Dump['identities']>>(file)
    } else if (kind === 'recorded') {
      Object.assign(dump.recorded, read<Record<string, Recorded>>(file))
    } else if (kind === 'graphql' && rest[0] === 'schema.graphql') {
      dump.graphql = { ...(dump.graphql || { compose: { endpoint: '/graphql', types: {} } }), schema: read<string>(file) }
    } else if (kind === 'graphql' && rest[0] === 'compose.json') {
      dump.graphql = { ...(dump.graphql || { schema: '' }), compose: read<ComposeMeta>(file) }
    }
  }
  return dump
}

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
    if (!bytes.has(file)) throw new Error(`${file} is in the manifest of ${manifest.preset} but missing from ${dir}.`)
  }
  return assemble(manifest, (file) => parseFile(file, bytes.get(file)!))
}
