import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { FakeTaskExecutor, type ITaskExecutor } from './lib/fakeExecutor'
import { CezarTaskExecutor } from './lib/cezarExecutor'
import { DELIVERY_AGENTS_EXECUTION_HOST_KEY } from './lib/executionHost'
import { DELIVERY_BRIEF_STRUCTURER_KEY } from '@open-mercato/core/modules/delivery_os/lib/briefStructuring'
import { DELIVERY_DESIGN_AGENT_KEY } from '@open-mercato/core/modules/delivery_os/lib/designAgent'
import { createCliBriefStructurer } from './lib/cliBriefStructurer'
import { createFigmaDesignAgent } from './lib/figmaDesignAgent'
import { createConfiguredWordpressExecutionHost } from './lib/wordpressExecutionHost'
import { createCezarGitExecutionHost } from './lib/cezarGitExecutionHost'

// Import commands to register them via side effects
import './commands/executions'

export function register(container: AppContainer): void {
  const useCezar = process.env.DELIVERY_EXECUTOR === 'cezar' || process.env.NODE_ENV === 'production'
  const taskExecutor: ITaskExecutor = useCezar ? new CezarTaskExecutor() : new FakeTaskExecutor()
  const briefStructurer = createCliBriefStructurer()
  const designAgent = createFigmaDesignAgent()

  container.register({
    deliveryAgentsTaskExecutor: {
      resolve: () => taskExecutor,
    },
  })

  container.register({
    [DELIVERY_BRIEF_STRUCTURER_KEY]: {
      resolve: () => briefStructurer,
    },
  })

  container.register({
    [DELIVERY_DESIGN_AGENT_KEY]: {
      resolve: () => designAgent,
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
  } else if (useCezar) {
    const baseDir = process.env.DELIVERY_CEZAR_BASE_DIR ?? process.cwd()
    const executionHost = createCezarGitExecutionHost(baseDir)
    container.register({
      [DELIVERY_AGENTS_EXECUTION_HOST_KEY]: {
        resolve: () => executionHost,
      },
    })
  }
}
