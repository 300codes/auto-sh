import type { BootstrapData } from '../types'
import { commandRegistry, registerCommand, type CommandLoader } from '../../commands/registry'
import { createBootstrap, isBootstrapped, resetBootstrapState, waitForAsyncRegistration } from '../factory'

const registerCoreInjectionWidgetsMock = jest.fn()
const registerCoreInjectionTablesMock = jest.fn()
const registerEnabledModuleIdsMock = jest.fn()

jest.mock('@open-mercato/core/modules/widgets/lib/injection', () => ({
  registerCoreInjectionWidgets: registerCoreInjectionWidgetsMock,
  registerCoreInjectionTables: registerCoreInjectionTablesMock,
  registerEnabledModuleIds: registerEnabledModuleIdsMock,
}))

const emptyBootstrapData: BootstrapData = {
  modules: [],
  entities: [],
  diRegistrars: [],
  entityIds: {},
  dashboardWidgetEntries: [],
  injectionWidgetEntries: [],
  injectionTables: [],
  searchModuleConfigs: [],
}

describe('partitioned bootstrap registration', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    resetBootstrapState()
    commandRegistry.clear()
    process.env.NODE_ENV = 'production'
    registerCoreInjectionWidgetsMock.mockReset()
    registerCoreInjectionTablesMock.mockReset()
    registerEnabledModuleIdsMock.mockReset()
  })

  afterAll(() => {
    commandRegistry.clear()
    process.env.NODE_ENV = originalNodeEnv
  })

  it('runs distinct registration keys once each', async () => {
    const apiComplete = jest.fn()
    const fullComplete = jest.fn()
    const apiBootstrap = createBootstrap(emptyBootstrapData, {
      registrationKey: 'api',
      skipUiRegistries: true,
      onRegistrationComplete: apiComplete,
    })
    const fullBootstrap = createBootstrap(emptyBootstrapData, {
      registrationKey: 'full',
      onRegistrationComplete: fullComplete,
    })

    apiBootstrap()
    apiBootstrap()
    fullBootstrap()
    fullBootstrap()
    await waitForAsyncRegistration()

    expect(apiComplete).toHaveBeenCalledTimes(1)
    expect(fullComplete).toHaveBeenCalledTimes(1)
    expect(isBootstrapped()).toBe(true)
  })

  it.each([['api', 'full'], ['full', 'api']] as const)('shares generated command loader objects across %s then %s bootstrap', async (first, second) => {
    const exactExecute = jest.fn(async () => 'exact')
    const fallbackExecute = jest.fn(async () => 'fallback')
    const exactLoad = jest.fn(async () => {
      registerCommand({ id: 'bootstrap_test.exact', execute: exactExecute })
    })
    const fallbackLoad = jest.fn(async () => {
      registerCommand({ id: 'bootstrap_test.fallback', execute: fallbackExecute })
    })
    const commandLoaderEntries: CommandLoader[] = [
      { id: 'bootstrap_test.exact', moduleId: 'bootstrap_test', key: 'bootstrap_test:commands:exact', load: exactLoad },
      { moduleId: 'bootstrap_test', key: 'bootstrap_test:commands:fallback', load: fallbackLoad },
    ]
    const sharedData = { ...emptyBootstrapData, commandLoaderEntries }
    const completions = { api: jest.fn(), full: jest.fn() }
    const bootstraps = {
      api: createBootstrap(sharedData, { registrationKey: 'api', skipUiRegistries: true, onRegistrationComplete: completions.api }),
      full: createBootstrap(sharedData, { registrationKey: 'full', onRegistrationComplete: completions.full }),
    }
    bootstraps[first]()
    await waitForAsyncRegistration()
    bootstraps[second]()
    await waitForAsyncRegistration()
    bootstraps[first]()
    bootstraps[second]()
    expect(completions.api).toHaveBeenCalledTimes(1)
    expect(completions.full).toHaveBeenCalledTimes(1)
    expect(exactLoad).not.toHaveBeenCalled()
    expect(fallbackLoad).not.toHaveBeenCalled()
    expect((await commandRegistry.load('bootstrap_test.exact'))?.execute).toBe(exactExecute)
    expect((await commandRegistry.load('bootstrap_test.fallback'))?.execute).toBe(fallbackExecute)
    expect(exactLoad).toHaveBeenCalledTimes(1)
    expect(fallbackLoad).toHaveBeenCalledTimes(1)
    expect(commandRegistry.listLoaders()).toEqual(['bootstrap_test.exact', 'bootstrap_test:commands:fallback'])
  })

  it('keeps API-only bootstrap from replacing core injection widgets', async () => {
    const apiBootstrap = createBootstrap(emptyBootstrapData, {
      registrationKey: 'api-only',
      skipUiRegistries: true,
      skipCoreInjectionWidgets: true,
    })

    apiBootstrap()
    await waitForAsyncRegistration()

    expect(registerCoreInjectionWidgetsMock).not.toHaveBeenCalled()
    // The raw widget entries still travel with the tables so a `key`-spelled injection
    // override resolves to the `widgetId` the slots reference (#5152), even though this
    // bootstrap deliberately skips registering the widgets themselves.
    expect(registerCoreInjectionTablesMock).toHaveBeenCalledWith([], [])
    expect(registerEnabledModuleIdsMock).toHaveBeenCalledTimes(1)
  })
})
