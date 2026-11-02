// As druxt.js 0.x loads axios: its mock is first required inside beforeEach, after jest.resetModules().
describe('an engine required lazily, as a manual mock of axios is', () => {
  let shared

  beforeEach(() => {
    jest.resetModules()
    shared = require('./drupal.cjs')
  })

  it('is the same engine after the modules are reset', () => {
    jest.resetModules()
    expect(require('./drupal.cjs').drupal).toBe(shared.drupal)
  })

  const write = async (title) => {
    const { drupal, verbs } = shared
    const { data: { data: [recipe] } } = await verbs.get('/en/jsonapi/node/recipe')
    // reset() revokes every token, so a test mints the one it writes with.
    const headers = { Authorization: `Bearer ${drupal.tokenFor('admin').access}`, 'Content-Type': 'application/vnd.api+json' }
    const { status } = await verbs.patch(`/en/jsonapi/node/recipe/${recipe.id}`, { data: { type: recipe.type, id: recipe.id, attributes: { title } } }, { headers })
    return status
  }

  it('takes a signed-in write', async () => {
    expect(await write('First')).toBe(200)
  })

  it('takes one in the next test too, after the reset', async () => {
    expect(await write('Second')).toBe(200)
  })

  it('refuses a token from before a reset, as Drupal refuses a revoked one', async () => {
    const { drupal, verbs } = shared
    const stale = drupal.tokenFor('admin').access
    drupal.reset()
    const answer = await verbs.get('/en/jsonapi/node/recipe', { headers: { Authorization: `Bearer ${stale}` }, validateStatus: null })
    expect(answer.status).toBe(401)
    expect(answer.headers['content-type']).toContain('text/html')
  })
})
