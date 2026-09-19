import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { FakeTaskExecutor, type ITaskExecutor } from './lib/fakeExecutor'
import { CezarTaskExecutor } from './lib/cezarExecutor'
import { DELIVERY_AGENTS_EXECUTION_HOST_KEY } from './lib/executionHost'
import { createConfiguredWordpressExecutionHost } from './lib/wordpressExecutionHost'

// Import commands to register them via side effects
import './commands/executions'

export function register(container: AppContainer): void {
  const useFakeExecutor =
    process.env.DELIVERY_EXECUTOR !== 'cezar' && process.env.NODE_ENV !== 'production'

  const taskExecutor: ITaskExecutor = useFakeExecutor ? new FakeTaskExecutor() : new CezarTaskExecutor()

  container.register({
    deliveryAgentsTaskExecutor: {
      resolve: () => taskExecutor,
    },
  })

  const wordpressHostConfig = process.env.DELIVERY_WP_HOST_CONFIG
  if (wordpressHostConfig) {
    const executionHost = createConfiguredWordpressExecutionHost(wordpressHostConfig)
    container.register({
      [DELIVERY_AGENTS_EXECUTION_HOST_KEY]: {
        resolve: () => executionHost,
      },
    })
  }
}
