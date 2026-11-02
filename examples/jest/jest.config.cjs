// As druxt.js's 0.x branch runs: CommonJS, in jsdom. Runs on Node 16.
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/test/*.test.cjs'],
  setupFilesAfterEnv: ['./test/setup.cjs'],
  globalSetup: './test/global-setup.cjs',
  globalTeardown: './test/global-teardown.cjs',
}
