import { runCezarTask } from '@open-mercato/delivery-cezar/lib/runner'
import type { TaskPackage } from '@open-mercato/delivery-cezar/lib/contracts'
import type { CezarRunResult } from '@open-mercato/delivery-cezar/lib/runner'
import type { ITaskExecutor } from './fakeExecutor'

export class CezarTaskExecutor implements ITaskExecutor {
  async run(taskPackage: TaskPackage, baseDir: string): Promise<CezarRunResult> {
    return runCezarTask({ task: taskPackage.taskId, baseDir })
  }
}
