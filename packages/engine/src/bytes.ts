// Hashing and random values on the globals a browser has, so the root entry imports no Node built-in and runs in a
// page, a service worker or Node alike. Random values come from Web Crypto. Node 16 and 18 have none as a global, so
// the Node-only loader registers node:crypto as the source, and a runtime with neither refuses rather than guess.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotateRight = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/** A string's UTF-8 bytes. Written out because Jest's jsdom environment has no TextEncoder. */
export const utf8 = (text: string): Uint8Array => {
  const bytes: number[] = []
  for (const char of text) {
    // A lone surrogate becomes U+FFFD, as Buffer and TextEncoder encode it, so hashes match node:crypto's.
    const point = char.codePointAt(0)!
    const code = point >= 0xd800 && point <= 0xdfff ? 0xfffd : point
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return Uint8Array.from(bytes)
}

/** SHA-256 of a string's UTF-8 bytes, or of the bytes given. Synchronous, unlike Web Crypto's `digest()`. */
export const sha256 = (input: string | Uint8Array): Uint8Array => {
  const data = typeof input === 'string' ? utf8(input) : input
  // Pad to a multiple of 64 bytes: a 1 bit, zeros, then the length in bits as a 64-bit big-endian number.
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000))
  view.setUint32(padded.length - 4, (data.length << 3) >>> 0)

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const w = new Uint32Array(64)
  // Typed arrays are always in range here, so their reads are numbers.
  const k = (i: number): number => K[i]!
  const at = (i: number): number => w[i]!
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotateRight(at(i - 15), 7) ^ rotateRight(at(i - 15), 18) ^ (at(i - 15) >>> 3)
      const s1 = rotateRight(at(i - 2), 17) ^ rotateRight(at(i - 2), 19) ^ (at(i - 2) >>> 10)
      w[i] = (at(i - 16) + s0 + at(i - 7) + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) + ((e & f) ^ (~e & g)) + k(i) + at(i)) >>> 0
      const t2 = ((rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    ;[a, b, c, d, e, f, g, hh].forEach((value, i) => {
      h[i] = (h[i]! + value) >>> 0
    })
  }
  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  h.forEach((word, i) => outView.setUint32(i * 4, word))
  return out
}

const webCrypto = (): Crypto | undefined => (globalThis as { crypto?: Crypto }).crypto

let fallback: ((bytes: Uint8Array) => void) | undefined

/** Sets the secure random source for a runtime without Web Crypto. `decoupled-drupal-mock/node` sets node:crypto. */
export const useRandomSource = (fill: ((bytes: Uint8Array) => void) | undefined): void => {
  fallback = fill
}

/** `length` random bytes, from Web Crypto, or from the source `useRandomSource` set. */
export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length)
  const crypto = webCrypto()
  if (crypto?.getRandomValues) return crypto.getRandomValues(bytes)
  if (!fallback) throw new Error('No secure random source: this runtime has no Web Crypto. Load the dump through decoupled-drupal-mock/node, or call useRandomSource().')
  fallback(bytes)
  return bytes
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** A version 4 UUID, as Drupal's uuid service makes them. */
export const randomUUID = (): string => {
  const crypto = webCrypto()
  if (crypto?.randomUUID) return crypto.randomUUID()
  const bytes = randomBytes(16)
  // The version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const h = hex(bytes)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Lower-case hexadecimal. */
export const toHex = hex

/** Base64 of bytes, or of a string's UTF-8 bytes. */
export const toBase64 = (input: string | Uint8Array): string => {
  const bytes = typeof input === 'string' ? utf8(input) : input
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** URL-safe, unpadded base64, as JWTs and PKCE use. */
export const base64url = (input: string | Uint8Array): string => toBase64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
