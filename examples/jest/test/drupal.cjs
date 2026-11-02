// The engine every test file shares, as a test's own modules and a manual mock of axios require it.
const { axiosVerbs, loadPreset } = require('decoupled-drupal-mock/jest')

const baseUrl = 'https://drupal.test'
// Reading the dump is the slow part, and a suite that calls jest.resetModules() runs this module again: the engine
// is kept on globalThis, so it is read once per test file. No hooks here, for the same reason: a module first required
// inside a test cannot add one.
const drupal = (globalThis.__decoupledDrupalMock ||= loadPreset('umami', { baseUrl }))

module.exports = { baseUrl, drupal, verbs: axiosVerbs(drupal, baseUrl) }
