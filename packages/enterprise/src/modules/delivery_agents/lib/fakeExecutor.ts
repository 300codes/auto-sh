import type { TaskPackage } from '@open-mercato/delivery-cezar/lib/contracts'
import type { CezarRunResult } from '@open-mercato/delivery-cezar/lib/runner'

export interface ITaskExecutor {
  run(taskPackage: TaskPackage, baseDir: string): Promise<CezarRunResult>
}

const FAKE_RUN_ID = 'fake-run-1'
const FAKE_STDOUT = 'EXEC-02-RUNNER-OK\n'

export class FakeTaskExecutor implements ITaskExecutor {
  async run(_taskPackage: TaskPackage, _baseDir: string): Promise<CezarRunResult> {
    return {
      exitCode: 0,
      stdout: FAKE_STDOUT,
      stderr: '',
      runId: FAKE_RUN_ID,
      durationMs: 100,
    }
  }
}

export class ControllableFakeTaskExecutor implements ITaskExecutor {
  private gateResolve: (() => void) | null = null
  readonly blocker: Promise<void>

  constructor() {
    this.blocker = new Promise<void>((resolve) => {
      this.gateResolve = resolve
    })
  }

  open(): void {
    this.gateResolve?.()
  }

  async run(_taskPackage: TaskPackage, _baseDir: string): Promise<CezarRunResult> {
    await this.blocker
    return {
      exitCode: 0,
      stdout: FAKE_STDOUT,
      stderr: '',
      runId: FAKE_RUN_ID,
      durationMs: 100,
    }
  }
}
