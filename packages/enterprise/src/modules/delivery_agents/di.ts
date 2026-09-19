import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { FakeTaskExecutor, type ITaskExecutor } from './lib/fakeExecutor'
import { CezarTaskExecutor } from './lib/cezarExecutor'

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
}
