import { buildDeliveryError, type DeliveryCheckResult } from './contracts'

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
