import { withoutTrailingSlashes } from './slashes.js'

/**
 * How an origin is written inside a recorded document: plainly in a link, and percent-encoded where it sits in a
 * query value. Drupal Canvas writes an image's origin into `alternateWidths` with its colons encoded and its slashes
 * not. A form the build does not recognise carries the crawled address into the dump.
 */
const ENCODINGS: Array<(url: string) => string> = [
  (url) => url,
  (url) => url.replace(/:/g, '%3A'),
  encodeURIComponent,
]

/** Text as a literal in a regular expression. */
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Replaces every written form of one origin with the same form of another. A longer form goes first, so a shorter
 * pattern never matches inside a longer encoded one.
 *
 * @param from - The origin to replace. A trailing slash is dropped.
 * @param to - The origin to write in its place. A trailing slash is dropped.
 * @returns A function that replaces every form of `from` in a text.
 */
export const relinker = (from: string, to: string): ((text: string) => string) => {
  const substitutions = ENCODINGS
    .map((encode) => ({ pattern: encode(withoutTrailingSlashes(from)), replacement: encode(withoutTrailingSlashes(to)) }))
    .filter(({ pattern }, index, all) => all.findIndex((other) => other.pattern === pattern) === index)
    .sort((a, b) => b.pattern.length - a.pattern.length)
    // Only the origin itself: a host that merely begins with it is another site's.
    .map(({ pattern, replacement }) => ({ pattern: new RegExp(`${escape(pattern)}(?![\\w.:-])`, 'g'), replacement }))
  return (text) => substitutions.reduce((out, { pattern, replacement }) => out.replace(pattern, replacement), text)
}
