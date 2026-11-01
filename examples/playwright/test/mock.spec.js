import { createServer } from 'node:http'
import { test as base, expect } from '@playwright/test'
import { withDrupal } from 'decoupled-drupal-mock/testing'

const test = withDrupal(base, 'umami')

/** A page on an origin of its own, as a frontend would be. */
const frontend = (page) => new Promise((resolve) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>frontend</title>')
  })
  server.listen(0, 'localhost', async () => {
    await page.goto(`http://localhost:${server.address().port}/`)
    server.close()
    server.closeAllConnections()
    resolve()
  })
})

test('a browser reads the mock across origins', async ({ page, drupal }) => {
  await frontend(page)
  const count = await page.evaluate(async (url) => (await (await fetch(`${url}/en/jsonapi/node/recipe`)).json()).data.length, drupal.url)
  expect(count).toBeGreaterThan(0)
})

test('a signed-in write from the browser is gone in the next test', async ({ page, request, drupal }) => {
  const { data: [recipe] } = await (await request.get(`${drupal.url}/en/jsonapi/node/recipe`)).json()
  const { access } = await drupal.tokenFor('admin')
  await frontend(page)
  const status = await page.evaluate(async ({ url, recipe, access }) => (await fetch(`${url}/en/jsonapi/node/recipe/${recipe.id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/vnd.api+json' },
    body: JSON.stringify({ data: { type: recipe.type, id: recipe.id, attributes: { title: 'Changed' } } }),
  })).status, { url: drupal.url, recipe, access })
  expect(status).toBe(200)
  expect((await (await request.get(`${drupal.url}/en/jsonapi/node/recipe/${recipe.id}`)).json()).data.attributes.title).toBe('Changed')
})

test('the write before this test is gone', async ({ request, drupal }) => {
  const { data } = await (await request.get(`${drupal.url}/en/jsonapi/node/recipe`)).json()
  expect(data.map((recipe) => recipe.attributes.title)).not.toContain('Changed')
})
