import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { baselineContentV1Schema, type BaselineContentV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'

/**
 * Three outcomes, never two. `none` is a domain state (the project has no
 * approved baseline yet); `unreadable` is a failure (an active baseline exists
 * but its content does not satisfy the frozen contract) and must not be shown
 * as an empty section.
 */
export type ActiveBaseline =
  | { kind: 'none' }
  | { kind: 'unreadable'; baseline: BaselineDto }
  | { kind: 'ready'; baseline: BaselineDto; content: BaselineContentV1 }

export function resolveActiveBaseline(baselines: readonly BaselineDto[]): ActiveBaseline {
  const active = baselines.find((baseline) => baseline.isActive)
  if (!active) return { kind: 'none' }
  const parsed = baselineContentV1Schema.safeParse(active.content)
  if (!parsed.success) return { kind: 'unreadable', baseline: active }
  return { kind: 'ready', baseline: active, content: parsed.data }
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12)
}
