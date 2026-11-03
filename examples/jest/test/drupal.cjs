// The engine every test file shares, as a test's own modules and a manual mock of axios require it.
const { axiosVerbs, loadPreset } = require('decoupled-drupal-mock/jest')

const baseUrl = 'https://drupal.test'
// Reading the dump is the slow part, and a suite that calls jest.resetModules() runs this module again: the engine
// is kept on `global`, so it is read once per test file. `global` and an `if`, not `globalThis` and `||=`, which an
// ESLint config at ecmaVersion 2020 with ES2015 globals refuses. No hooks here: a module first required inside a test
// cannot add one.
if (!global.__decoupledDrupalMock) {
  global.__decoupledDrupalMock = loadPreset('umami', { baseUrl })
}
const drupal = global.__decoupledDrupalMock

module.exports = { baseUrl, drupal, verbs: axiosVerbs(drupal, baseUrl) }
