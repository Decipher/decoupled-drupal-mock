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

/** A dump from its manifest and a reader of each file's parsed JSON, however the files are stored. */
export const assemble = (manifest: Manifest, read: <T>(file: string) => T): Dump => {
  const dump: Dump = { manifest, index: {}, resources: {}, recorded: {} }
  for (const file of Object.keys(manifest.files)) {
    const [kind, ...rest] = file.split('/')
    if (kind === 'index') {
      dump.index[rest[0]!.replace(/\.json(\.gz)?$/, '')] = read<Document>(file)
    } else if (kind === 'resources') {
      const [langcode, name] = rest as [string, string]
      dump.resources[langcode] = dump.resources[langcode] || {}
      dump.resources[langcode]![name.replace(/\.json(\.gz)?$/, '')] = read<Resource[]>(file)
    } else if (kind === 'access') {
      dump.access = dump.access || {}
      dump.access[rest[0]!.replace(/\.json(\.gz)?$/, '')] = read<NonNullable<Dump['access']>[string]>(file)
    } else if (kind === 'identities.json') {
      dump.identities = read<NonNullable<Dump['identities']>>(file)
    } else if (kind === 'recorded') {
      Object.assign(dump.recorded, read<Record<string, Recorded>>(file))
    }
  }
  return dump
}

/** A file's JSON, gunzipped when its name ends in `.gz`. */
export const parseFile = <T>(file: string, bytes: Uint8Array | string): T => JSON.parse(typeof bytes === 'string' ? bytes : (file.endsWith('.gz') ? gunzipSync(bytes) : Buffer.from(bytes)).toString('utf8')) as T

/**
 * A dump from wherever its files are kept, such as a server's asset storage: the reader gives each file's bytes.
 * The manifest's hashes are not checked here; `loadDump` checks them where the files are on disk.
 */
export const loadDumpFrom = async (read: (file: string) => Promise<Uint8Array | string | null | undefined>): Promise<Dump> => {
  const manifestBytes = await read('manifest.json')
  if (!manifestBytes) throw new Error('manifest.json was not found.')
  const manifest = parseFile<Manifest>('manifest.json', manifestBytes)
  const files = new Map<string, unknown>()
  for (const file of Object.keys(manifest.files)) {
    const bytes = await read(file)
    if (!bytes) throw new Error(`${file} is in the manifest of ${manifest.preset} but was not found.`)
    files.set(file, parseFile(file, bytes))
  }
  return assemble(manifest, <T>(file: string) => files.get(file) as T)
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
    try {
      statSync(join(dir, file))
    } catch {
      throw new Error(`${file} is in the manifest of ${manifest.preset} but missing from ${dir}.`)
    }
  }
  // The bytes that passed the hash check are the bytes parsed.
  return assemble(manifest, (file) => parseBytes(file, bytes.get(file)!))
}
