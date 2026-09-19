'use client'

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  baselineListResponseSchema,
  taskListResponseSchema,
  type BaselineDto,
  type TaskDto,
} from '@open-mercato/core/modules/delivery_os/api/schemas'

export type SectionSource<TData> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: TData }

export type ProjectSections = {
  baselines: SectionSource<BaselineDto[]>
  tasks: SectionSource<TaskDto[]>
  reloadBaselines: () => Promise<void>
  reloadTasks: () => Promise<void>
  reloadSections: () => Promise<void>
}

function parseBaselines(value: unknown): BaselineDto[] | null {
  const parsed = baselineListResponseSchema.safeParse(value)
  return parsed.success ? parsed.data.items : null
}

function parseTasks(value: unknown): TaskDto[] | null {
  const parsed = taskListResponseSchema.safeParse(value)
  return parsed.success ? parsed.data.items : null
}

/**
 * One project sub-resource, fetched on its own. Every source carries its own
 * loading/error state and its own request-sequence guard, so a slow response
 * for a project the operator already navigated away from can never fill the
 * section of the project now on screen, and a failure of one source never
 * takes down the others.
 *
 * `scopeVersion` is a dependency, not a value: switching organization has to
 * refetch, otherwise the sections keep showing the previous scope's records
 * until someone presses Retry.
 */
function useProjectResource<TData>(
  projectId: string,
  path: string,
  parse: (value: unknown) => TData | null,
  scopeVersion: number,
): { state: SectionSource<TData>; reload: () => Promise<void> } {
  const [state, setState] = React.useState<SectionSource<TData>>({ status: 'loading' })
  const requestSequence = React.useRef(0)

  const reload = React.useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current
    setState({ status: 'loading' })
    try {
      const response = await apiCall<unknown>(`/api/delivery_os/projects/${encodeURIComponent(projectId)}/${path}`)
      if (sequence !== requestSequence.current) return
      const parsed = response.ok ? parse(response.result) : null
      setState(parsed === null ? { status: 'error' } : { status: 'ready', data: parsed })
    } catch {
      if (sequence === requestSequence.current) setState({ status: 'error' })
    }
  }, [projectId, path, parse, scopeVersion])

  React.useEffect(() => {
    void reload()
    return () => { requestSequence.current += 1 }
  }, [reload])

  return { state, reload }
}

export function useProjectSections(projectId: string): ProjectSections {
  const scopeVersion = useOrganizationScopeVersion()
  const baselines = useProjectResource(projectId, 'baselines', parseBaselines, scopeVersion)
  const tasks = useProjectResource(projectId, 'tasks', parseTasks, scopeVersion)

  const reloadSections = React.useCallback(async (): Promise<void> => {
    await Promise.all([baselines.reload(), tasks.reload()])
  }, [baselines.reload, tasks.reload])

  return {
    baselines: baselines.state,
    tasks: tasks.state,
    reloadBaselines: baselines.reload,
    reloadTasks: tasks.reload,
    reloadSections,
  }
}
