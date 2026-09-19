import {
  attemptIntervalsOverlap,
  findActiveAttempt,
  isAttemptActive,
  readAttemptRegister,
} from '../attemptRegister'
import { buildAttempt } from './attemptFixtures'

const SECOND_ATTEMPT_ID = '32222222-2222-4222-8222-222222222222'
const now = new Date('2026-09-19T12:00:00.000Z')

describe('readAttemptRegister — three disjoint inputs', () => {
  it('reports an unreadable register as its own state, never as "no attempts"', () => {
    const state = readAttemptRegister({ executionAttempts: [], attemptRegisterReadable: false }, now)
    expect(state.kind).toBe('unreadable')
  })

  it('reports a task that has had no attempts as empty', () => {
    const state = readAttemptRegister({ executionAttempts: [], attemptRegisterReadable: true }, now)
    expect(state.kind).toBe('empty')
  })

  it('reports recorded attempts as entries', () => {
    const state = readAttemptRegister({ executionAttempts: [buildAttempt()], attemptRegisterReadable: true }, now)
    expect(state.kind).toBe('entries')
    if (state.kind !== 'entries') throw new Error('[internal] expected entries')
    expect(state.entries).toHaveLength(1)
  })

  it('keeps "unreadable" even when attempts happen to be present, because the register is not trustworthy', () => {
    const state = readAttemptRegister({ executionAttempts: [buildAttempt()], attemptRegisterReadable: false }, now)
    expect(state.kind).toBe('unreadable')
  })
})

describe('readAttemptRegister — ordering, activity and intervals', () => {
  it('numbers attempts by reservation order regardless of the order they arrive in', () => {
    const later = buildAttempt({ attemptId: SECOND_ATTEMPT_ID, reservedAt: '2026-09-19T11:00:00.000Z' })
    const state = readAttemptRegister({ executionAttempts: [later, buildAttempt()], attemptRegisterReadable: true }, now)
    if (state.kind !== 'entries') throw new Error('[internal] expected entries')
    expect(state.entries.map((entry) => entry.number)).toEqual([1, 2])
    expect(state.entries[1].attempt.attemptId).toBe(SECOND_ATTEMPT_ID)
  })

  it.each([
    ['reserved', true],
    ['claimed', true],
    ['cancel_requested', true],
    ['result_received', false],
    ['reconciliation_required', false],
    ['closed', false],
  ] as const)('treats %s as active=%s, matching ACTIVE_ATTEMPT_STATES', (state, active) => {
    expect(isAttemptActive(buildAttempt({ state }))).toBe(active)
  })

  it('runs an open attempt up to now, so its interval is never an unknown point', () => {
    const state = readAttemptRegister({ executionAttempts: [buildAttempt()], attemptRegisterReadable: true }, now)
    if (state.kind !== 'entries') throw new Error('[internal] expected entries')
    expect(state.entries[0].interval.end).toBe(now.getTime())
    expect(state.entries[0].closedAt).toBeNull()
  })

  it('ends a closed attempt at its closedAt, not at now', () => {
    const closed = buildAttempt({ state: 'closed', closedAt: '2026-09-19T10:30:00.000Z', outcome: 'cancelled' })
    const state = readAttemptRegister({ executionAttempts: [closed], attemptRegisterReadable: true }, now)
    if (state.kind !== 'entries') throw new Error('[internal] expected entries')
    expect(state.entries[0].interval.end).toBe(Date.parse('2026-09-19T10:30:00.000Z'))
  })

  it('names the single active attempt so the caller does not have to scan the register', () => {
    const closed = buildAttempt({ state: 'closed', closedAt: '2026-09-19T10:30:00.000Z', outcome: 'cancelled' })
    const running = buildAttempt({ attemptId: SECOND_ATTEMPT_ID, reservedAt: '2026-09-19T11:00:00.000Z', state: 'claimed' })
    const state = readAttemptRegister({ executionAttempts: [closed, running], attemptRegisterReadable: true }, now)
    if (state.kind !== 'entries') throw new Error('[internal] expected entries')
    expect(state.activeEntry?.attempt.attemptId).toBe(SECOND_ATTEMPT_ID)
  })

  it('flags a stop request and a reconciliation requirement separately', () => {
    const stopping = buildAttempt({ state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed' })
    const unresolved = buildAttempt({ attemptId: SECOND_ATTEMPT_ID, state: 'reconciliation_required' })
    const state = readAttemptRegister(
      { executionAttempts: [stopping, unresolved], attemptRegisterReadable: true },
      now,
    )
    if (state.kind !== 'entries') throw new Error('[internal] expected entries')
    expect(state.entries[0].awaitingStopConfirmation).toBe(true)
    expect(state.entries[0].reconciliationRequired).toBe(false)
    expect(state.entries[1].awaitingStopConfirmation).toBe(false)
    expect(state.entries[1].reconciliationRequired).toBe(true)
  })
})

describe('findActiveAttempt', () => {
  it('stays silent when the register is unreadable — an unreadable register proves nothing is idle', () => {
    const attempts = [buildAttempt({ state: 'claimed' })]
    expect(findActiveAttempt({ executionAttempts: attempts, attemptRegisterReadable: false })).toBeNull()
    expect(findActiveAttempt({ executionAttempts: attempts, attemptRegisterReadable: true })?.state).toBe('claimed')
  })
})

describe('attemptIntervalsOverlap', () => {
  function entriesFor(first: Parameters<typeof buildAttempt>[0], second: Parameters<typeof buildAttempt>[0]) {
    const state = readAttemptRegister(
      { executionAttempts: [buildAttempt(first), buildAttempt({ attemptId: SECOND_ATTEMPT_ID, ...second })], attemptRegisterReadable: true },
      now,
    )
    if (state.kind !== 'entries') throw new Error('[internal] expected entries')
    return state.entries
  }

  it('reports two runs that were open at the same time as overlapping', () => {
    const [first, second] = entriesFor(
      { reservedAt: '2026-09-19T10:00:00.000Z', closedAt: '2026-09-19T11:30:00.000Z', state: 'closed', outcome: 'cancelled' },
      { reservedAt: '2026-09-19T11:00:00.000Z' },
    )
    expect(attemptIntervalsOverlap(first, second)).toBe(true)
  })

  it('does not report a run that started exactly when the previous one closed', () => {
    const [first, second] = entriesFor(
      { reservedAt: '2026-09-19T10:00:00.000Z', closedAt: '2026-09-19T11:00:00.000Z', state: 'closed', outcome: 'cancelled' },
      { reservedAt: '2026-09-19T11:00:00.000Z' },
    )
    expect(attemptIntervalsOverlap(first, second)).toBe(false)
  })
})
