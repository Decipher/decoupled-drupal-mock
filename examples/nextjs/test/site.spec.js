import { expect, test } from '@playwright/test'
import { connectMock } from 'decoupled-drupal-mock/testing'

const mock = connectMock('http://127.0.0.1:3105')
const RECIPE = '/en/recipes/borscht-with-pork-ribs'

test.afterEach(() => mock.reset())

test('a page renders from the mock, on the server', async ({ page }) => {
  await page.goto(RECIPE)
  await expect(page.locator('#title')).toHaveText('Borscht with pork ribs')
  const paths = (await mock.requests()).map((request) => request.path)
  expect(paths).toContain('/router/translate-path')
})

test('a draft link with a bad secret is refused by the extension', async ({ request }) => {
  const answer = await request.get(`/api/draft?path=${RECIPE}&secret=wrong`, { maxRedirects: 0 })
  expect(answer.status()).toBe(422)
  expect(await answer.text()).toBe('Invalid or missing draft secret.')
})

test('a good draft link shows the latest revision, and only to that browser', async ({ page, browser }) => {
  await page.goto(`/api/draft?path=${RECIPE}&secret=test-secret`)
  await expect(page.locator('#title')).toHaveText('Draft: Borscht with pork ribs')
  const asked = (await mock.requests()).find((request) => request.path === '/next/draft-url')
  expect(JSON.parse(asked.body)).toMatchObject({ path: RECIPE, secret: 'test-secret' })
  const other = await browser.newPage()
  await other.goto(RECIPE)
  await expect(other.locator('#title')).toHaveText('Borscht with pork ribs')
  await other.close()
})

test('a scenario takes Drupal down for the site', async ({ page }) => {
  await mock.scenario('drupal-down')
  await page.goto(RECIPE)
  await expect(page.locator('#error')).toHaveText('Drupal is not answering')
})

test('a save calls the site back, and the site answers', async ({ page, request }) => {
  await page.goto(RECIPE)
  const { access } = await mock.tokenFor('editor')
  const { entity } = await (await request.get(`http://127.0.0.1:3105/router/translate-path?path=${RECIPE}`)).json()
  const answer = await request.patch(`http://127.0.0.1:3105/en/jsonapi/node/recipe/${entity.uuid}`, {
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/vnd.api+json' },
    data: { data: { type: 'node--recipe', id: entity.uuid, attributes: { title: 'Changed' } } },
  })
  expect(answer.status()).toBe(200)
  await expect.poll(async () => (await mock.sent())[0]?.status).toBe(200)
  await page.reload()
  await expect(page.locator('#title')).toHaveText('Changed')
})
