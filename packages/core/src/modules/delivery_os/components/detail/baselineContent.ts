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

/**
 * A decision is recorded against a version that is not yet active, so the
 * sections have to be able to show one. `selectedId === null` keeps the old
 * behaviour — the active version — and a selected id that no longer exists
 * falls back to it rather than rendering a dead reference.
 */
export function resolveBaseline(baselines: readonly BaselineDto[], selectedId: string | null): ActiveBaseline {
  const selected = selectedId === null ? undefined : baselines.find((baseline) => baseline.id === selectedId)
  const chosen = selected ?? baselines.find((baseline) => baseline.isActive)
  if (!chosen) return { kind: 'none' }
  const parsed = baselineContentV1Schema.safeParse(chosen.content)
  if (!parsed.success) return { kind: 'unreadable', baseline: chosen }
  return { kind: 'ready', baseline: chosen, content: parsed.data }
}

export function resolveActiveBaseline(baselines: readonly BaselineDto[]): ActiveBaseline {
  return resolveBaseline(baselines, null)
}

export type BaselineDecisionState = 'approved' | 'rejected' | 'pending'

/**
 * A baseline activates only once BOTH kinds are approved, so a version with one
 * approval is still pending. The latest decision of a kind wins — the decision
 * log is append-only and a rejection can be followed by an approval.
 */
export function decisionStateFor(baseline: BaselineDto, kind: 'requirements' | 'design'): BaselineDecisionState {
  const forKind = baseline.decisions.filter((decision) => decision.kind === kind)
  const latest = forKind[forKind.length - 1]
  if (!latest) return 'pending'
  return latest.verdict === 'approved' ? 'approved' : 'rejected'
}

export function overallDecisionState(baseline: BaselineDto): BaselineDecisionState {
  const requirements = decisionStateFor(baseline, 'requirements')
  const design = decisionStateFor(baseline, 'design')
  if (requirements === 'rejected' || design === 'rejected') return 'rejected'
  if (requirements === 'approved' && design === 'approved') return 'approved'
  return 'pending'
}

/**
 * Which version the operator should be looking at by default: the active one,
 * and the newest when nothing is active yet — a freshly frozen version is
 * exactly what a decision is about.
 */
export function defaultSelectedBaselineId(baselines: readonly BaselineDto[]): string | null {
  const active = baselines.find((baseline) => baseline.isActive)
  if (active) return active.id
  const newest = [...baselines].sort((first, second) => second.version - first.version)[0]
  return newest?.id ?? null
}

/**
 * After a refetch, a selection pointing at a version the list no longer carries
 * is cleared rather than kept — a dead id would render as "no baseline" without
 * saying why.
 */
export function reconcileSelectedBaselineId(
  baselines: readonly BaselineDto[],
  selectedId: string | null,
): string | null {
  if (selectedId !== null && baselines.some((baseline) => baseline.id === selectedId)) return selectedId
  return defaultSelectedBaselineId(baselines)
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12)
}
