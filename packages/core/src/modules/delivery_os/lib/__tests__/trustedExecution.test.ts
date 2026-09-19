import { isIssuedTrustedExecution, issueTrustedExecution, readTrustedExecutionOption } from '../trustedExecution'

const ACTOR_ID = '55555555-5555-4555-8555-555555555555'

describe('trusted execution option', () => {
  it('recognises only the object issued in this process', () => {
    const issued = issueTrustedExecution(ACTOR_ID)
    expect(issued).toEqual({ source: 'delivery_agents', actorUserId: ACTOR_ID })
    expect(isIssuedTrustedExecution(issued)).toBe(true)
    expect(isIssuedTrustedExecution({ ...issued })).toBe(false)
    expect(isIssuedTrustedExecution(JSON.parse(JSON.stringify(issued)))).toBe(false)
    for (const value of [undefined, null, 'delivery_agents', 1, []]) expect(isIssuedTrustedExecution(value)).toBe(false)
  })

  it('cannot be re-pointed at another actor after it was issued', () => {
    const issued = issueTrustedExecution(ACTOR_ID)
    expect(Object.isFrozen(issued)).toBe(true)
    expect(() => Object.assign(issued, { actorUserId: 'someone-else' })).toThrow()
  })

  it('survives the shallow input copy of the command bus and reads nothing from non-objects', () => {
    const issued = issueTrustedExecution(ACTOR_ID)
    expect(isIssuedTrustedExecution(readTrustedExecutionOption({ ...{ taskId: 'x', trustedExecution: issued } }))).toBe(true)
    expect(readTrustedExecutionOption(null)).toBeUndefined()
    expect(readTrustedExecutionOption('trustedExecution')).toBeUndefined()
  })
})
