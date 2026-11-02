import { defineConfig } from '@playwright/test'

const MOCK = 'http://127.0.0.1:3105'
const SITE = 'http://127.0.0.1:3106'

// One worker: the tests share the mock the site is pointed at.
export default defineConfig({
  testDir: 'test',
  workers: 1,
  timeout: 90000,
  use: { browserName: 'chromium', baseURL: SITE },
  webServer: [
    {
      command: 'node ../../packages/engine/dist/cli.js serve umami --port 3105 --control --extension ../extensions/next.mjs',
      url: `${MOCK}/jsonapi`,
      env: { NEXT_SITE: SITE },
    },
    {
      command: 'next build && next start --port 3106 --hostname 127.0.0.1',
      // Answers 401 without its secret. Playwright does not take the 404 of an empty front page as ready.
      url: `${SITE}/api/revalidate`,
      timeout: 120000,
      env: { NEXT_PUBLIC_DRUPAL_BASE_URL: MOCK },
    },
  ],
})
