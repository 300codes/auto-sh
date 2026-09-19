import { buildDeliveryError, type DeliveryCheckResult, type DeliveryErrorCode, type DeliveryErrorDetail } from './contracts'

export type DependencyNode = { key: string; dependsOn: readonly string[] }

export function findDependencyCycle(nodes: readonly DependencyNode[]): string[] | null {
  const dependencies = new Map<string, string[]>()
  for (const node of nodes) dependencies.set(node.key, [...(dependencies.get(node.key) ?? []), ...node.dependsOn])
  const finished = new Set<string>()
  for (const start of dependencies.keys()) {
    if (finished.has(start)) continue
    const path: string[] = [start]
    const pathIndex = new Map<string, number>([[start, 0]])
    const cursors: number[] = [0]
    while (path.length > 0) {
      const depth = path.length - 1
      const current = path[depth]
      const edges = dependencies.get(current) ?? []
      const cursor = cursors[depth]
      if (cursor >= edges.length) {
        finished.add(current)
        pathIndex.delete(current)
        path.pop()
        cursors.pop()
        continue
      }
      cursors[depth] = cursor + 1
      const next = edges[cursor]
      if (!dependencies.has(next) || finished.has(next)) continue
      const cycleStart = pathIndex.get(next)
      if (cycleStart !== undefined) return [...path.slice(cycleStart), next]
      pathIndex.set(next, path.length)
      path.push(next)
      cursors.push(0)
    }
  }
  return null
}

export function checkAcyclic(nodes: readonly DependencyNode[]): DeliveryCheckResult {
  const cycle = findDependencyCycle(nodes)
  if (!cycle) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError('cycle', 'Dependency graph contains a cycle', [
      { code: 'cycle', message: cycle.join(' -> ') },
    ]),
  }
}

export type TaskGraphNode = {
  id: string
  projectId: string
  baselineId?: string | null
  dependsOnTaskIds: readonly string[]
}

export type TaskGraphProblem =
  | { code: 'self_dependency'; taskId: string }
  | { code: 'cycle'; path: string[] }
  | { code: 'unknown_dependency'; taskId: string; dependencyId: string }
  | { code: 'foreign_dependency'; taskId: string; dependencyId: string; reason: 'other_project' | 'other_baseline' }

function isForeignBaseline(task: TaskGraphNode, dependency: TaskGraphNode): boolean {
  return Boolean(task.baselineId && dependency.baselineId && task.baselineId !== dependency.baselineId)
}

export function validateTaskGraph(tasks: readonly TaskGraphNode[], projectId: string): TaskGraphProblem[] {
  const problems: TaskGraphProblem[] = []
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const projectEdges: DependencyNode[] = []
  for (const task of tasks) {
    if (task.projectId !== projectId) continue
    const validDependencies: string[] = []
    for (const dependencyId of new Set(task.dependsOnTaskIds)) {
      const dependency = tasksById.get(dependencyId)
      if (dependencyId === task.id) {
        problems.push({ code: 'self_dependency', taskId: task.id })
      } else if (!dependency) {
        problems.push({ code: 'unknown_dependency', taskId: task.id, dependencyId })
      } else if (dependency.projectId !== projectId) {
        problems.push({ code: 'foreign_dependency', taskId: task.id, dependencyId, reason: 'other_project' })
      } else if (isForeignBaseline(task, dependency)) {
        problems.push({ code: 'foreign_dependency', taskId: task.id, dependencyId, reason: 'other_baseline' })
      } else {
        validDependencies.push(dependencyId)
      }
    }
    projectEdges.push({ key: task.id, dependsOn: validDependencies })
  }
  const cycle = findDependencyCycle(projectEdges)
  if (cycle) problems.push({ code: 'cycle', path: cycle })
  return problems
}

function describeProblem(problem: TaskGraphProblem): DeliveryErrorDetail {
  switch (problem.code) {
    case 'self_dependency':
      return { path: `tasks.${problem.taskId}`, code: 'self_dependency', message: 'A task cannot depend on itself' }
    case 'cycle':
      return { code: 'cycle', message: problem.path.join(' -> ') }
    case 'unknown_dependency':
      return { path: `tasks.${problem.taskId}.dependsOnTaskIds`, code: 'unknown_dependency', message: `Unknown dependency ${problem.dependencyId}` }
    case 'foreign_dependency':
      return {
        path: `tasks.${problem.taskId}.dependsOnTaskIds`,
        code: problem.reason,
        message: `Dependency ${problem.dependencyId} belongs to another ${problem.reason === 'other_project' ? 'project' : 'baseline'}`,
      }
  }
}

function problemErrorCode(problem: TaskGraphProblem): DeliveryErrorCode {
  return problem.code === 'self_dependency' || problem.code === 'cycle' ? 'cycle' : 'foreign_dependency'
}

export function taskGraphCheck(tasks: readonly TaskGraphNode[], projectId: string): DeliveryCheckResult {
  const problems = validateTaskGraph(tasks, projectId)
  const first = problems[0]
  if (!first) return { ok: true }
  const code = problemErrorCode(first)
  const error = code === 'cycle' ? 'Dependency graph contains a cycle' : 'Dependency must be a task of the same project and baseline'
  return { ok: false, ...buildDeliveryError(code, error, problems.map(describeProblem)) }
}

export function descendantsOf(taskId: string, tasks: readonly Pick<TaskGraphNode, 'id' | 'dependsOnTaskIds'>[]): string[] {
  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    for (const dependencyId of task.dependsOnTaskIds) {
      const existing = dependents.get(dependencyId)
      if (existing) existing.push(task.id)
      else dependents.set(dependencyId, [task.id])
    }
  }
  const visited = new Set<string>([taskId])
  const descendants: string[] = []
  const frontier = [taskId]
  for (let cursor = 0; cursor < frontier.length; cursor += 1) {
    for (const dependentId of dependents.get(frontier[cursor]) ?? []) {
      if (visited.has(dependentId)) continue
      visited.add(dependentId)
      descendants.push(dependentId)
      frontier.push(dependentId)
    }
  }
  return descendants
}

export function ancestorsOf(taskId: string, tasks: readonly Pick<TaskGraphNode, 'id' | 'dependsOnTaskIds'>[]): string[] {
  const dependencies = new Map(tasks.map((task) => [task.id, task.dependsOnTaskIds]))
  const visited = new Set<string>([taskId])
  const ancestors: string[] = []
  const frontier = [taskId]
  for (let cursor = 0; cursor < frontier.length; cursor += 1) {
    for (const dependencyId of dependencies.get(frontier[cursor]) ?? []) {
      if (visited.has(dependencyId)) continue
      visited.add(dependencyId)
      ancestors.push(dependencyId)
      frontier.push(dependencyId)
    }
  }
  return ancestors
}
