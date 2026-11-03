import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64url, randomBytes, randomUUID, sha256, toBase64, toHex, utf8 } from '../src/bytes'
import { keyOf } from '../src/hash'

const nodeSha = (input: string | Uint8Array): string => createHash('sha256').update(input).digest('hex')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('sha256', () => {
  // Every length around the padding boundaries: 55 bytes is the most one block holds with its length, 56 needs two.
  it('matches node:crypto for every length from 0 to 130 bytes', () => {
    for (let length = 0; length <= 130; length++) {
      const bytes = nodeRandomBytes(length)
      expect(toHex(sha256(new Uint8Array(bytes))), `length ${length}`).toBe(nodeSha(bytes))
    }
  })

  it('hashes a string as its UTF-8 bytes', () => {
    for (const text of ['', 'abc', 'Crème au café', '日本語のレシピ', '🥘 paella', 'x'.repeat(10_000)]) {
      expect(toHex(sha256(text))).toBe(nodeSha(text))
    }
  })

  it('matches node:crypto on a megabyte', () => {
    const bytes = nodeRandomBytes(1 << 20)
    expect(toHex(sha256(new Uint8Array(bytes)))).toBe(nodeSha(bytes))
  })

  it('keeps keyOf, the omitted-item key, as Drupal computes it', () => {
    const drupal = (text: string): string => createHash('sha256').update(text).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 7)
    for (const text of ['node--recipe', '/jsonapi/node/recipe?include=uid', 'Crème 🥘']) expect(keyOf(text)).toBe(drupal(text))
  })
})

describe('utf8', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('encodes as Buffer does, astral characters included', () => {
    for (const text of ['', 'abc', 'é', '€', 'Crème au café', '日本語', '🥘🇪🇸', '\u{10FFFF}']) {
      expect(Array.from(utf8(text))).toEqual(Array.from(Buffer.from(text, 'utf8')))
    }
  })

  it('hashes a string without TextEncoder, as under Jest jsdom', () => {
    vi.stubGlobal('TextEncoder', undefined)
    expect(toHex(sha256('Crème 日本語 🥘'))).toBe(nodeSha('Crème 日本語 🥘'))
  })
})

describe('base64', () => {
  it('matches Buffer for bytes and strings, URL-safe and unpadded', () => {
    for (let length = 0; length <= 40; length++) {
      const bytes = nodeRandomBytes(length)
      expect(toBase64(new Uint8Array(bytes))).toBe(bytes.toString('base64'))
      expect(base64url(new Uint8Array(bytes))).toBe(bytes.toString('base64url'))
    }
    expect(base64url('{"typ":"JWT","alg":"RS256"}')).toBe(Buffer.from('{"typ":"JWT","alg":"RS256"}').toString('base64url'))
    expect(toBase64('Crème')).toBe(Buffer.from('Crème').toString('base64'))
  })
})

describe('random values', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('makes bytes and version 4 UUIDs that differ', () => {
    expect(randomBytes(32)).toHaveLength(32)
    expect(toHex(randomBytes(16))).not.toBe(toHex(randomBytes(16)))
    const ids = new Set(Array.from({ length: 100 }, randomUUID))
    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(UUID)
  })

  it('still answers on a runtime without Web Crypto, as Node 16 is', () => {
    vi.stubGlobal('crypto', undefined)
    expect((globalThis as { crypto?: unknown }).crypto).toBeUndefined()
    expect(randomBytes(24)).toHaveLength(24)
    const ids = new Set(Array.from({ length: 100 }, randomUUID))
    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(UUID)
  })
})

describe('the root entry', () => {
  // A browser bundle of the package's main entry must not reach a Node built-in, however deep the import.
  it('imports no Node built-in, directly or through any module it imports', () => {
    const src = resolve(__dirname, '../src')
    const seen = new Set<string>()
    const builtins: string[] = []
    const walk = (file: string): void => {
      if (seen.has(file)) return
      seen.add(file)
      const code = readFileSync(file, 'utf8')
      for (const [, specifier = ''] of code.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
        if (/^\.\.?\//.test(specifier)) walk(join(dirname(file), specifier.replace(/\.js$/, '.ts')))
        else if (/^node:|^(fs|path|crypto|http|https|net|zlib|os|url|child_process|module|stream)$/.test(specifier)) builtins.push(`${file.slice(src.length + 1)}: ${specifier}`)
      }
    }
    walk(join(src, 'index.ts'))
    expect(seen.size).toBeGreaterThan(5)
    expect(builtins).toEqual([])
  })
})
