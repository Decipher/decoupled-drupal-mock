// As druxt.js's server cache test needs: real HTTP from this process, and an extension that closes over a test's spy.
const { get } = require('http')
const { listen, loadPreset } = require('decoupled-drupal-mock/jest')

// Node 16 has no fetch, and jsdom's would be a browser's, so this reads over node's own client.
const read = (url) => new Promise((resolve, reject) => {
  get(url, (response) => {
    let text = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { text += chunk })
    response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(text) }))
  }).on('error', reject)
})

describe('a server in the test process, started after the engine is made', () => {
  const drupal = loadPreset('umami')
  let server

  beforeAll(async () => {
    server = await listen(drupal, 0, '127.0.0.1', { rebase: true })
  })
  afterAll(() => server.close())
  afterEach(() => drupal.reset())

  it('answers the JSON:API index over real HTTP, its links naming the port it bound', async () => {
    const { status, json } = await read(`${server.url}/jsonapi`)
    expect(status).toBe(200)
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(server.url).not.toBe('http://127.0.0.1:0')
    // Umami prefixes its default language, so its index names `/en/jsonapi`, as its Drupal does.
    expect(json.links.self.href).toBe(`${server.url}/en/jsonapi`)
    expect(json.links['node--recipe'].href).toBe(`${server.url}/en/jsonapi/node/recipe`)
    expect(Object.values(json.links).every(({ href }) => href.startsWith(`${server.url}/`))).toBe(true)
  })

  it('answers over that server from an extension added with use() after it started', async () => {
    const spy = jest.fn(() => ({ body: { cached: false } }))
    drupal.use({ routes: { 'GET /api/cache': spy } })
    const { status, json } = await read(`${server.url}/api/cache`)
    expect(status).toBe(200)
    expect(json).toEqual({ cached: false })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
