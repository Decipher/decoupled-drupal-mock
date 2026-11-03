import { base64url, sha256 } from './bytes.js'

/** Drupal's `Crypt::hashBase64()`: sha256, base64, URL-safe, unpadded. The first seven characters key an omitted item. */
export const keyOf = (text: string): string => base64url(sha256(text)).slice(0, 7)
