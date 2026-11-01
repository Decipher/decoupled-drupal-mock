const { defineConfig } = require('cypress')
const { cypressTasks, spawnMock } = require('decoupled-drupal-mock/cypress')

module.exports = defineConfig({
  video: false,
  e2e: {
    supportFile: false,
    async setupNodeEvents(on, config) {
      // A frontend started beforehand would be pointed at a fixed `--port`, and only the tasks are needed here.
      const mock = await spawnMock('umami')
      on('task', cypressTasks(mock.url))
      on('after:run', () => mock.close())
      config.env.drupalUrl = mock.url
      config.baseUrl = mock.url
      return config
    },
  },
})
