'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { resolveStageContent, shortenHash } from './artifactContent'
import type { DesignStageContent, ScopeContent, StageArtifactListItem } from '../../lib/contracts'

export function HashValue({ hash, label }: { hash: string; label?: string }) {
  return (
    <span className="font-mono text-xs text-muted-foreground" title={label ? `${label}: ${hash}` : hash}>
      {shortenHash(hash)}
    </span>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">{title}</h4>
      {children}
    </div>
  )
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

function Prose({ text }: { text: string }) {
  return <p className="whitespace-pre-line text-sm">{text}</p>
}

/**
 * A render whose bytes cannot be fetched is a named state, not a blank box: the
 * operator approving a design has to know they are looking at metadata only.
 */
function ScreenThumbnail({ attachmentId, name }: { attachmentId: string; name: string }) {
  const t = useT()
  const [failed, setFailed] = React.useState(false)
  if (failed) {
    return (
      <p data-testid={`delivery-stage-screen-unavailable-${attachmentId}`} className="text-xs text-status-error-text">
        {t('delivery_os.flow.artifact.renderUnavailable')}
      </p>
    )
  }
  return (
    <img
      data-testid={`delivery-stage-screen-${attachmentId}`}
      src={`/api/attachments/image/${encodeURIComponent(attachmentId)}?width=480&height=320`}
      alt={name}
      loading="lazy"
      className="max-h-48 rounded-md border border-border"
      onError={() => setFailed(true)}
    />
  )
}

function ScopeView({ scope }: { scope: ScopeContent }) {
  const t = useT()
  return (
    <div className="space-y-4" data-testid="delivery-stage-scope-content">
      <Prose text={scope.summary} />
      <div className="grid gap-4 md:grid-cols-2">
        <Block title={t('delivery_os.flow.artifact.inScope')}>
          {scope.inScope.length ? <Bullets items={scope.inScope} /> : <p className="text-sm text-muted-foreground">{t('delivery_os.flow.artifact.nothingListed')}</p>}
        </Block>
        <Block title={t('delivery_os.flow.artifact.outOfScope')}>
          {scope.outOfScope.length ? <Bullets items={scope.outOfScope} /> : <p className="text-sm text-muted-foreground">{t('delivery_os.flow.artifact.nothingListed')}</p>}
        </Block>
      </div>
      {scope.pages.length ? (
        <Block title={t('delivery_os.flow.artifact.pages')}>
          <ul className="space-y-1 text-sm">
            {scope.pages.map((page) => (
              <li key={page.id}>
                <span className="font-medium">{page.title}</span>
                {page.purpose ? <span className="text-muted-foreground"> — {page.purpose}</span> : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {scope.keyFlows.length ? (
        <Block title={t('delivery_os.flow.artifact.keyFlows')}>
          <ul className="space-y-2 text-sm">
            {scope.keyFlows.map((flow) => (
              <li key={flow.id}>
                <span className="font-medium">{flow.title}</span>
                <Bullets items={flow.steps} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      <Block title={t('delivery_os.flow.artifact.requirements')}>
        <ul className="space-y-1 text-sm" data-testid="delivery-stage-requirements">
          {scope.requirements.map((requirement) => (
            <li key={requirement.id} className="flex flex-wrap items-baseline gap-2">
              <Badge variant="muted" className="font-mono text-xs">
                {requirement.id}
              </Badge>
              <span className="font-medium">{requirement.title}</span>
              {requirement.description ? <span className="text-muted-foreground">{requirement.description}</span> : null}
            </li>
          ))}
        </ul>
      </Block>
      <Block title={t('delivery_os.flow.artifact.acceptanceCriteria')}>
        <ul className="space-y-1 text-sm" data-testid="delivery-stage-acceptance-criteria">
          {scope.acceptanceCriteria.map((criterion) => (
            <li key={criterion.id} className="flex flex-wrap items-baseline gap-2">
              <Badge variant="muted" className="font-mono text-xs">
                {criterion.id}
              </Badge>
              <span>{criterion.description}</span>
            </li>
          ))}
        </ul>
      </Block>
      {scope.risks.length ? (
        <Block title={t('delivery_os.flow.artifact.risks')}>
          <ul className="space-y-1 text-sm">
            {scope.risks.map((risk) => (
              <li key={risk.id}>
                <span>{risk.text}</span>
                {risk.mitigation ? (
                  <span className="text-muted-foreground"> — {t('delivery_os.flow.artifact.mitigation')}: {risk.mitigation}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {scope.assumptions.length ? (
        <Block title={t('delivery_os.flow.artifact.assumptions')}>
          <Bullets items={scope.assumptions} />
        </Block>
      ) : null}
      <Block title={t('delivery_os.flow.artifact.platform')}>
        <p className="text-sm">
          <span className="font-medium">{scope.platform.profileId}</span>
          <span className="text-muted-foreground"> — {scope.platform.rationale}</span>
        </p>
      </Block>
    </div>
  )
}

function DesignView({ design }: { design: DesignStageContent }) {
  const t = useT()
  const figmaUrl = (fileKey: string, nodeId: string) =>
    design.figmaRefs.find((reference) => reference.fileKey === fileKey && reference.nodeId === nodeId)?.url ?? null
  return (
    <div className="space-y-4" data-testid="delivery-stage-design-content">
      <Prose text={design.summary} />
      <Block title={t('delivery_os.flow.artifact.screens')}>
        {design.screens.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('delivery_os.flow.artifact.noScreens')}</p>
        ) : (
          <ul className="space-y-3">
            {design.screens.map((screen) => {
              const url = figmaUrl(screen.fileKey, screen.nodeId)
              return (
                <li key={`${screen.fileKey}:${screen.nodeId}:${screen.attachmentId}`} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{screen.name}</span>
                    <Badge variant="muted" size="sm">
                      {t('delivery_os.flow.artifact.viewport', { width: screen.viewport.width, height: screen.viewport.height })}
                    </Badge>
                    {url ? (
                      <a className="text-sm underline" href={url} target="_blank" rel="noreferrer">
                        {t('delivery_os.flow.artifact.openInFigma')}
                      </a>
                    ) : null}
                  </div>
                  <ScreenThumbnail attachmentId={screen.attachmentId} name={screen.name} />
                </li>
              )
            })}
          </ul>
        )}
      </Block>
      {design.figmaRefs.length ? (
        <Block title={t('delivery_os.flow.artifact.figmaRefs')}>
          <ul className="space-y-1 text-sm">
            {design.figmaRefs.map((reference) => (
              <li key={`${reference.fileKey}:${reference.nodeId ?? 'file'}`}>
                {reference.url ? (
                  <a className="underline" href={reference.url} target="_blank" rel="noreferrer">
                    {reference.name}
                  </a>
                ) : (
                  reference.name
                )}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {design.notes ? (
        <Block title={t('delivery_os.flow.artifact.notes')}>
          <Prose text={design.notes} />
        </Block>
      ) : null}
    </div>
  )
}

export function StageArtifactContent({ content }: { content: unknown }) {
  const t = useT()
  const view = resolveStageContent(content)
  if (view.kind === 'scope') return <ScopeView scope={view.scope} />
  if (view.kind === 'design') return <DesignView design={view.design} />
  return (
    <Alert status="warning" style="lighter" size="sm" data-testid="delivery-stage-content-unreadable">
      {t('delivery_os.flow.artifact.unreadable')}
    </Alert>
  )
}

/**
 * Hashes, ids and upstream versions are audit material, not reading material:
 * they stay one click away from the content the operator judges.
 */
export function StageArtifactTechnicalDetails({ artifact }: { artifact: StageArtifactListItem }) {
  const t = useT()
  return (
    <CollapsibleSection title={t('delivery_os.flow.artifact.technicalDetails')} defaultCollapsed>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4" data-testid="delivery-stage-technical-details">
        <div>
          <dt className="font-medium">{t('delivery_os.flow.artifact.contentHash')}</dt>
          <dd>
            <HashValue hash={artifact.contentHash} label={t('delivery_os.flow.artifact.contentHash')} />
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t('delivery_os.flow.artifact.sourceLabel')}</dt>
          <dd>{t(`delivery_os.flow.artifact.sourceKind.${artifact.source}`)}</dd>
        </div>
        <div>
          <dt className="font-medium">{t('delivery_os.flow.artifact.templateHash')}</dt>
          <dd>
            <HashValue hash={artifact.templateHash} label={t('delivery_os.flow.artifact.templateHash')} />
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t('delivery_os.flow.artifact.attachments')}</dt>
          <dd>{artifact.attachmentIds.length}</dd>
        </div>
      </dl>
      <div className="mt-3">
        <h4 className="text-xs font-medium">{t('delivery_os.flow.dependencies')}</h4>
        {artifact.dependsOn.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('delivery_os.flow.artifact.noDependencies')}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {artifact.dependsOn.map((dependency) => (
              <li key={dependency.stageId} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span>{t(`delivery_os.flow.stage.${dependency.stageId}`)}</span>
                <span className="text-muted-foreground">{t('delivery_os.flow.version', { version: dependency.version })}</span>
                <HashValue hash={dependency.contentHash} label={t('delivery_os.flow.artifact.contentHash')} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </CollapsibleSection>
  )
}
