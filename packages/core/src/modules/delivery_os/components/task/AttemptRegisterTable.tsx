'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import type { AttemptState } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { AttemptRegisterEntry, AttemptRegisterState } from './attemptRegister'
import { TechnicalValue } from './TechnicalValue'

export type AttemptRegisterTableProps = {
  register: AttemptRegisterState
  actionsFor?: (entry: AttemptRegisterEntry) => React.ReactNode
}

/** Module-owned status map; the design system forbids raw Tailwind status colors. */
export const attemptStateStatusMap: StatusMap<AttemptState> = {
  reserved: 'info',
  claimed: 'info',
  result_received: 'success',
  cancel_requested: 'warning',
  reconciliation_required: 'warning',
  closed: 'neutral',
}

const EMPTY_CELL = '—'

function formatMoment(value: string | null): string {
  if (value === null) return EMPTY_CELL
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/**
 * The worker reference and the external run id name the same thing from two
 * sides: who picked the attempt up in-process, and what the external run was
 * called. A manual hand-off usually carries only the second one.
 */
function formatRunReference(entry: AttemptRegisterEntry): string {
  const parts = [entry.attempt.workerRef, entry.attempt.externalRunId].filter((part): part is string => part !== null)
  return parts.length === 0 ? EMPTY_CELL : parts.join(' · ')
}

function AttemptRow({ entry, action }: { entry: AttemptRegisterEntry; action: React.ReactNode }) {
  const t = useT()
  return (
    <TableRow
      data-testid={`attempt-row-${entry.attempt.attemptId}`}
      data-attempt-live={entry.active ? 'true' : 'false'}
      className={entry.active ? 'bg-status-info-bg' : undefined}
    >
      <TableCell className="text-xs tabular-nums">{entry.number}</TableCell>
      <TableCell className="text-xs">{t(`delivery_os.task.attempts.mode.${entry.attempt.mode}`)}</TableCell>
      <TableCell>
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge variant={attemptStateStatusMap[entry.attempt.state] ?? 'neutral'} dot>
            {t(`delivery_os.task.attempts.state.${entry.attempt.state}`)}
          </StatusBadge>
          {entry.active ? (
            <span data-testid={`attempt-active-${entry.attempt.attemptId}`}>
              <StatusBadge variant="info">{t('delivery_os.task.attempts.badge.active')}</StatusBadge>
            </span>
          ) : null}
          {entry.awaitingStopConfirmation ? (
            <span data-testid={`attempt-stop-unconfirmed-${entry.attempt.attemptId}`}>
              <StatusBadge variant="warning">{t('delivery_os.task.attempts.stopConfirmation.stop_unconfirmed')}</StatusBadge>
            </span>
          ) : null}
          {entry.reconciliationRequired ? (
            <span data-testid={`attempt-reconciliation-${entry.attempt.attemptId}`}>
              <StatusBadge variant="warning">{t('delivery_os.task.attempts.badge.reconciliationRequired')}</StatusBadge>
            </span>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="text-xs">{formatMoment(entry.startedAt)}</TableCell>
      <TableCell className="text-xs">{formatMoment(entry.attempt.claimedAt)}</TableCell>
      <TableCell className="text-xs" data-testid={`attempt-closed-${entry.attempt.attemptId}`}>
        {entry.closedAt === null
          ? t('delivery_os.task.attempts.stillRunning')
          : formatMoment(entry.closedAt)}
      </TableCell>
      <TableCell className="text-xs"><TechnicalValue value={formatRunReference(entry)} maxWidth="max-w-[12rem]" /></TableCell>
      <TableCell className="text-xs" data-testid={`attempt-outcome-${entry.attempt.attemptId}`}>
        {entry.attempt.outcome === null
          ? t('delivery_os.task.attempts.outcome.none')
          : t(`delivery_os.task.attempts.outcome.${entry.attempt.outcome}`)}
      </TableCell>
      {action ? <TableCell>{action}</TableCell> : <TableCell />}
    </TableRow>
  )
}

/**
 * The register is the only readable source of what ran: `GET /tasks/[id]/attempts`
 * does not exist, so this table renders exactly what `TaskDto` carried and never
 * infers a run it was not told about.
 */
export function AttemptRegisterTable({ register, actionsFor }: AttemptRegisterTableProps) {
  const t = useT()
  return (
    <section data-testid="delivery-attempt-register" className="space-y-3">
      <SectionHeader
        title={t('delivery_os.task.attempts.title')}
        count={register.kind === 'entries' ? register.entries.length : undefined}
      />
      {register.kind === 'unreadable' ? (
        <div data-testid="attempt-register-unreadable">
          <TabEmptyState
            title={t('delivery_os.task.attempts.register.unreadableTitle')}
            description={t('delivery_os.task.attempts.register.unreadableDescription')}
          />
        </div>
      ) : null}
      {register.kind === 'empty' ? (
        <div data-testid="attempt-register-empty">
          <TabEmptyState
            title={t('delivery_os.task.attempts.register.emptyTitle')}
            description={t('delivery_os.task.attempts.register.emptyDescription')}
          />
        </div>
      ) : null}
      {register.kind === 'entries' ? (
        <p className="text-xs text-muted-foreground" data-testid="attempt-register-live">
          {register.activeEntry !== null
            ? t('delivery_os.task.attempts.liveAttempt', {
              number: register.activeEntry.number,
              state: t(`delivery_os.task.attempts.state.${register.activeEntry.attempt.state}`),
            })
            : t('delivery_os.task.attempts.noLiveAttempt')}
        </p>
      ) : null}
      {register.kind === 'entries' ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('delivery_os.task.attempts.columns.number')}</TableHead>
                <TableHead>{t('delivery_os.task.attempts.columns.mode')}</TableHead>
                <TableHead>{t('delivery_os.task.attempts.columns.state')}</TableHead>
                <TableHead>{t('delivery_os.task.attempts.columns.reservedAt')}</TableHead>
                <TableHead>{t('delivery_os.task.attempts.columns.claimedAt')}</TableHead>
                <TableHead>{t('delivery_os.task.attempts.columns.closedAt')}</TableHead>
                <TableHead>{t('delivery_os.task.attempts.columns.runReference')}</TableHead>
                <TableHead>{t('delivery_os.task.attempts.columns.outcome')}</TableHead>
                <TableHead>{t('delivery_os.task.attempts.columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {register.entries.map((entry) => (
                <AttemptRow key={entry.attempt.attemptId} entry={entry} action={actionsFor?.(entry) ?? null} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  )
}
