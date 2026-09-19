import { deliveryErrorBodySchema } from '../contracts'
import { ancestorsOf, descendantsOf, taskGraphCheck, validateTaskGraph, type TaskGraphNode } from '../dag'

const projectId = 'project-1'
const otherProjectId = 'project-2'

function node(id: string, dependsOnTaskIds: string[] = [], overrides: Partial<TaskGraphNode> = {}): TaskGraphNode {
  return { id, projectId, baselineId: 'baseline-1', dependsOnTaskIds, ...overrides }
}

describe('validateTaskGraph', () => {
  it('accepts a diamond: two tasks sharing a dependency and a join task', () => {
    const tasks = [node('A'), node('B', ['A']), node('C', ['A']), node('D', ['B', 'C'])]
    expect(validateTaskGraph(tasks, projectId)).toEqual([])
    expect(taskGraphCheck(tasks, projectId)).toEqual({ ok: true })
  })

  it('rejects a 2-node cycle with its path, while the same two tasks in one direction pass', () => {
    expect(validateTaskGraph([node('A', ['B']), node('B')], projectId)).toEqual([])
    expect(validateTaskGraph([node('A', ['B']), node('B', ['A'])], projectId)).toEqual([
      { code: 'cycle', path: ['A', 'B', 'A'] },
    ])
  })

  it('rejects a 3-node cycle with its path, while the open chain passes', () => {
    expect(validateTaskGraph([node('A', ['B']), node('B', ['C']), node('C')], projectId)).toEqual([])
    const result = taskGraphCheck([node('A', ['B']), node('B', ['C']), node('C', ['A'])], projectId)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('cycle')
    expect(result.body.details).toEqual([{ code: 'cycle', message: 'A -> B -> C -> A' }])
    expect(deliveryErrorBodySchema.safeParse(result.body).success).toBe(true)
  })

  it('reports a self-dependency as its own problem and maps it to cycle', () => {
    expect(validateTaskGraph([node('A', ['A'])], projectId)).toEqual([{ code: 'self_dependency', taskId: 'A' }])
    const result = taskGraphCheck([node('A', ['A'])], projectId)
    expect(result.ok || result.body.code).toBe('cycle')
  })

  it('rejects a dependency on a task of another project, while the same edge inside the project passes', () => {
    const foreign = node('X', [], { projectId: otherProjectId })
    expect(validateTaskGraph([node('A', ['X']), foreign], projectId)).toEqual([
      { code: 'foreign_dependency', taskId: 'A', dependencyId: 'X', reason: 'other_project' },
    ])
    expect(validateTaskGraph([node('A', ['X']), node('X')], projectId)).toEqual([])
    const result = taskGraphCheck([node('A', ['X']), foreign], projectId)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('foreign_dependency')
    expect(result.body.details[0]).toMatchObject({ code: 'other_project' })
  })

  it('rejects a dependency pinned to another baseline of the same project', () => {
    const otherBaseline = node('X', [], { baselineId: 'baseline-2' })
    expect(validateTaskGraph([node('A', ['X']), otherBaseline], projectId)).toEqual([
      { code: 'foreign_dependency', taskId: 'A', dependencyId: 'X', reason: 'other_baseline' },
    ])
  })

  it('rejects an unknown dependency id with the foreign_dependency code', () => {
    expect(validateTaskGraph([node('A', ['ghost'])], projectId)).toEqual([
      { code: 'unknown_dependency', taskId: 'A', dependencyId: 'ghost' },
    ])
    const result = taskGraphCheck([node('A', ['ghost'])], projectId)
    expect(result.ok || result.body.code).toBe('foreign_dependency')
  })

  it('still finds a cycle when another task has an invalid edge, and ignores tasks of other projects as sources', () => {
    const tasks = [node('A', ['B', 'ghost']), node('B', ['A']), node('Y', ['Z'], { projectId: otherProjectId })]
    expect(validateTaskGraph(tasks, projectId)).toEqual([
      { code: 'unknown_dependency', taskId: 'A', dependencyId: 'ghost' },
      { code: 'cycle', path: ['A', 'B', 'A'] },
    ])
  })
})

describe('descendantsOf / ancestorsOf', () => {
  const tasks = [node('A'), node('B', ['A']), node('C', ['B']), node('D', ['C']), node('E'), node('F', ['E', 'B'])]

  it('returns transitive dependents only, never the task, its ancestors or independent tasks', () => {
    expect(descendantsOf('B', tasks)).toEqual(['C', 'F', 'D'])
    expect(descendantsOf('B', tasks)).not.toContain('A')
    expect(descendantsOf('B', tasks)).not.toContain('E')
    expect(descendantsOf('D', tasks)).toEqual([])
  })

  it('returns transitive dependencies for ancestorsOf', () => {
    expect(ancestorsOf('D', tasks)).toEqual(['C', 'B', 'A'])
    expect(ancestorsOf('F', tasks)).toEqual(['E', 'B', 'A'])
    expect(ancestorsOf('A', tasks)).toEqual([])
  })

  it('terminates on a cyclic graph', () => {
    const cyclic = [node('A', ['C']), node('B', ['A']), node('C', ['B'])]
    expect(descendantsOf('A', cyclic)).toEqual(['B', 'C'])
    expect(ancestorsOf('A', cyclic)).toEqual(['C', 'B'])
  })
})
