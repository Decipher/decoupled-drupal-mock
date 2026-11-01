import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startMock } from 'decoupled-drupal-mock/testing'
import type { Mock } from 'decoupled-drupal-mock/testing'

describe('a server per suite', () => {
  let mock: Mock
  beforeAll(async () => { mock = await startMock('umami') })
  afterEach(() => mock.reset())
  afterAll(() => mock.close())

  it('answers over HTTP, with links naming its own URL', async () => {
    const response = await fetch(`${mock.url}/en/jsonapi/node/recipe`)
    const body = await response.json() as { links: { self: { href: string } } }
    expect(response.status).toBe(200)
    expect(body.links.self.href.startsWith(mock.url)).toBe(true)
  })

  it('signs a request in', async () => {
    const { access } = await mock.tokenFor('admin')
    const anonymous = await fetch(`${mock.url}/en/jsonapi/user_role/user_role`)
    const signedIn = await fetch(`${mock.url}/en/jsonapi/user_role/user_role`, { headers: { authorization: `Bearer ${access}` } })
    expect(signedIn.status).toBe(200)
    expect(anonymous.status).not.toBe(500)
  })
})
