// What the `next` Drupal module adds, as next-drupal uses it. Written from next-drupal's source: not recorded from a
// real Drupal, so the mock's fidelity claim does not cover it.
const SECRET = 'test-secret'

/** @type {import('decoupled-drupal-mock').Extension} */
export default {
  name: 'next',
  routes: {
    // next-drupal's `validateDraftUrl` posts every query parameter of the draft link here.
    'POST /next/draft-url': ({ json }) => {
      if (json?.secret !== SECRET) return { status: 422, body: { message: 'Invalid or missing draft secret.' } }
      if (!json?.path) return { status: 422, body: { message: 'Missing path.' } }
      return { body: { path: json.path, maxAge: 30 } }
    },
  },
  // A draft is another revision, which a dump does not hold: this one shows as its title.
  answer: ({ query }, next) => {
    const stock = next()
    if (!query.resourceVersion?.includes('latest') || stock.status !== 200 || !stock.body?.data?.attributes) return stock
    const { data } = stock.body
    return { ...stock, body: { ...stock.body, data: { ...data, attributes: { ...data.attributes, title: `Draft: ${data.attributes.title}` } } } }
  },
  // On a save, as the module's on-demand revalidation does.
  onWrite: ({ resource, send }) => {
    const path = resource?.attributes?.path?.alias
    if (process.env.NEXT_SITE && path) send(`${process.env.NEXT_SITE}/api/revalidate?path=${encodeURIComponent(path)}&secret=${SECRET}`)
  },
  scenarios: {
    'drupal-down': { answer: () => ({ status: 503, body: 'Service unavailable' }) },
  },
}
