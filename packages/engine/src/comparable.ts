/**
 * A document as a recorded answer is compared with the mock's, replaying an overlay's recordings, say. Drupal keys an
 * omitted item's link with a hash of a random salt, so the omitted links become a sorted list of hrefs.
 */
export const comparable = (body: unknown): unknown => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const document = body as { meta?: { omitted?: { links?: Record<string, { href?: string }> } } }
  const links = document.meta?.omitted?.links
  if (!links) return body
  const { help, ...items } = links
  return { ...document, meta: { ...document.meta, omitted: { ...document.meta!.omitted, links: { help, items: Object.values(items).map((item) => item.href).sort() } } } }
}
