const path = require('node:path')
const core = require('../core/jest.config.cjs')
const coreRoot = path.resolve(__dirname, '../core')
const relocate = (value) => typeof value === 'string' ? value.replaceAll('<rootDir>', coreRoot) : value
module.exports = {
  ...core,
  rootDir: '.',
  moduleNameMapper: Object.fromEntries(Object.entries(core.moduleNameMapper).map(([key, value]) => [key, relocate(value)])),
  transform: Object.fromEntries(Object.entries(core.transform).map(([key, value]) => [key, [relocate(value[0]), value[1]]])),
  setupFilesAfterEnv: core.setupFilesAfterEnv.map(relocate),
  testMatch: ['<rootDir>/src/**/__tests__/*.test.ts'],
  passWithNoTests: false,
}
