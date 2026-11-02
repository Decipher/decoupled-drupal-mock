import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startMock } from 'decoupled-drupal-mock/testing'
import type { Mock } from 'decoupled-drupal-mock/testing'
// @ts-expect-error A plain module, as a site's extension would be.
import { nodePreview } from '../../extensions/node-preview.mjs'

describe('a module the preset does not have: JSON:API Node Preview', () => {
  const uuid = '9af15b20-9480-459c-bce5-d00b5d41fa32'
  const paragraph = { type: 'paragraph--text', id: '11111111-1111-4111-8111-111111111111', attributes: { field_text: 'Unsaved' } }
  let mock: Mock
  const preview = (id: string, headers: Record<string, string> = {}) => fetch(`${mock.url}/jsonapi/node/recipe/${id}/preview?include=field_content`, { headers })

  beforeAll(async () => { mock = await startMock('umami', { extensions: [nodePreview({ [uuid]: { title: 'Unsaved title' } }, [paragraph])] }) })
  afterEach(() => mock.reset())
  afterAll(() => mock.close())

  it('gives a signed-in editor the unsaved node and its paragraphs, as the frontend checks them', async () => {
    const { access } = await mock.tokenFor('editor')
    const response = await preview(uuid, { authorization: `Bearer ${access}` })
    expect(response.headers.get('content-type')).toContain('application/vnd.api+json')
    const document = await response.json() as { data: { id: string, type: string, attributes: { title: string } }, included: Array<{ id: string }> }
    expect(document.data.id).toBe(uuid)
    expect(document.data.type).toBe('node--recipe')
    expect(document.data.attributes.title).toBe('Unsaved title')
    expect(document.included.map((resource) => resource.id)).toEqual([paragraph.id])
  })

  it('refuses a visitor', async () => {
    expect((await preview(uuid)).status).toBe(403)
  })

  it('has no preview of a node nobody is editing', async () => {
    const { access } = await mock.tokenFor('editor')
    expect((await preview('00000000-0000-4000-8000-000000000000', { authorization: `Bearer ${access}` })).status).toBe(404)
  })

  it('leaves the saved node as it was', async () => {
    const { data } = await (await fetch(`${mock.url}/en/jsonapi/node/recipe/${uuid}`)).json() as { data: { attributes: { title: string } } }
    expect(data.attributes.title).not.toBe('Unsaved title')
  })
})
