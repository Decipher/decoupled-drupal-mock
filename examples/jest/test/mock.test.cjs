const axios = require('axios').default || require('axios')
const mockAxios = require('jest-mock-axios').default
const { axiosAdapter, axiosVerbs, connectMock, loadPreset } = require('decoupled-drupal-mock/jest')

const baseUrl = 'https://drupal.test'
const drupal = loadPreset('umami', { baseUrl })

describe('the engine in the test process', () => {
  it('answers axios spies, whose calls can still be asserted', async () => {
    mockAxios.get = jest.fn(axiosVerbs(drupal, baseUrl).get)
    const { data, status } = await mockAxios.get('/en/jsonapi/node/recipe')
    expect(status).toBe(200)
    expect(data.data.length).toBeGreaterThan(0)
    expect(mockAxios.get).toHaveBeenCalledTimes(1)
    expect(mockAxios.get).toHaveBeenLastCalledWith('/en/jsonapi/node/recipe')
  })

  it('answers real axios through an adapter, errors and all', async () => {
    const client = axios.create({ baseURL: baseUrl, adapter: axiosAdapter(drupal) })
    expect((await client.get('/en/jsonapi/node/recipe')).status).toBe(200)
    await expect(client.get('/en/jsonapi/nope')).rejects.toMatchObject({ response: { status: 404 } })
  })

  it('takes a signed-in write and drops it on reset', async () => {
    const verbs = axiosVerbs(drupal, baseUrl)
    const headers = { Authorization: `Bearer ${drupal.tokenFor('admin').access}`, 'Content-Type': 'application/vnd.api+json' }
    const { data: { data: [recipe] } } = await verbs.get('/en/jsonapi/node/recipe')
    await verbs.patch(`/en/jsonapi/node/recipe/${recipe.id}`, { data: { type: recipe.type, id: recipe.id, attributes: { title: 'Changed' } } }, { headers })
    expect((await verbs.get(`/en/jsonapi/node/recipe/${recipe.id}`)).data.data.attributes.title).toBe('Changed')
    drupal.reset()
    expect((await verbs.get(`/en/jsonapi/node/recipe/${recipe.id}`)).data.data.attributes.title).toBe(recipe.attributes.title)
  })
})

describe('the server globalSetup started', () => {
  it('answers real axios over HTTP, and takes orders', async () => {
    const mock = connectMock()
    // jsdom's XMLHttpRequest, from its own origin: the CORS a browser would need.
    const client = axios.create({ baseURL: mock.url })
    expect((await client.get('/en/jsonapi/node/recipe')).status).toBe(200)
    const token = await mock.tokenFor('admin')
    const { data: { data: [recipe] } } = await client.get('/en/jsonapi/node/recipe')
    const headers = { Authorization: `Bearer ${token.access}`, 'Content-Type': 'application/vnd.api+json' }
    await client.patch(`/en/jsonapi/node/recipe/${recipe.id}`, { data: { type: recipe.type, id: recipe.id, attributes: { title: 'Changed' } } }, { headers })
    await mock.reset()
    expect((await client.get(`/en/jsonapi/node/recipe/${recipe.id}`)).data.data.attributes.title).toBe(recipe.attributes.title)
  })
})
