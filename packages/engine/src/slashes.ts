/**
 * A string without the slashes that end it. A loop, as `/\/+$/` backtracks: a request path of many slashes would take
 * seconds to answer.
 *
 * @param text - A path or URL.
 * @returns It, without trailing slashes.
 */
export const withoutTrailingSlashes = (text: string): string => {
  let end = text.length
  while (end > 0 && text[end - 1] === '/') end--
  return text.slice(0, end)
}
