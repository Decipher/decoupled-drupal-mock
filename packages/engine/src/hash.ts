import { createHash } from 'node:crypto'

/** Drupal's `Crypt::hashBase64()`: sha256, base64, URL-safe, unpadded. The first seven characters key an omitted item. */
export const keyOf = (text: string): string => createHash('sha256').update(text).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 7)
