'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { useFlowController, type ProjectDetailTab } from './FlowController'
import { FlowNextStep } from './FlowNextStep'
import { ProjectOverview } from './ProjectOverview'

export type ProjectTabsShellProps = {
  projectId: string
  projectUpdatedAt: string
  actorUserId: string | null
  canManage: boolean
  canImport: boolean
  canApproveStages: boolean
  canManageFlow: boolean
  clientRequest: string | null
  linkedStageId: string | null
  initialTab: ProjectDetailTab
  taskCount: number | null
  onChanged: () => Promise<void>
  executionHost: React.ReactNode
  baseline: React.ReactNode
  tasks: React.ReactNode
  evidence: React.ReactNode
}

/**
 * Header plus tabs. The next step is deliberately outside the tab strip: it is
 * the one thing an operator must see whichever part of the project they opened.
 */
export function ProjectTabsShell({
  projectId,
  projectUpdatedAt,
  actorUserId,
  canManage,
  canImport,
  canApproveStages,
  canManageFlow,
  clientRequest,
  linkedStageId,
  initialTab,
  taskCount,
  onChanged,
  executionHost,
  baseline,
  tasks,
  evidence,
}: ProjectTabsShellProps) {
  const t = useT()
  const [tab, setTab] = React.useState<ProjectDetailTab>(initialTab)
  const requestTab = React.useCallback((next: ProjectDetailTab) => { setTab(next) }, [])
  const controller = useFlowController({
    projectId,
    projectUpdatedAt,
    canManageFlow,
    linkedStageId,
    onChanged,
    onRequestTab: requestTab,
  })

  return (
    <div className="space-y-6">
      <FlowNextStep projectId={projectId} canManageFlow={canManageFlow} controller={controller} />
      {executionHost}
      <Tabs value={tab} onValueChange={(value) => setTab(value as ProjectDetailTab)} variant="underline">
        <TabsList aria-label={t('delivery_os.project.tabs.label')}>
          <TabsTrigger value="process">{t('delivery_os.project.tabs.process')}</TabsTrigger>
          <TabsTrigger value="baseline">{t('delivery_os.project.tabs.baseline')}</TabsTrigger>
          <TabsTrigger value="tasks" count={taskCount ?? undefined}>{t('delivery_os.project.tabs.tasks')}</TabsTrigger>
          <TabsTrigger value="evidence">{t('delivery_os.project.tabs.evidence')}</TabsTrigger>
        </TabsList>
        <TabsContent value="process" className="mt-4">
          <ProjectOverview
            projectId={projectId}
            actorUserId={actorUserId}
            canManage={canManage}
            canImport={canImport}
            canApprove={canApproveStages}
            clientRequest={clientRequest}
            controller={controller}
          />
        </TabsContent>
        <TabsContent value="baseline" className="mt-4">{baseline}</TabsContent>
        <TabsContent value="tasks" className="mt-4">{tasks}</TabsContent>
        <TabsContent value="evidence" className="mt-4">{evidence}</TabsContent>
      </Tabs>
    </div>
  )
}
