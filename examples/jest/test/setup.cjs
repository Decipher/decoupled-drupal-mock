// The file setupFilesAfterEnv names: the reset between tests lives here, where Jest takes hooks.
const { drupal } = require('./drupal.cjs')

afterEach(() => drupal.reset())
