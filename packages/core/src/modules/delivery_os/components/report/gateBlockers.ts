import type { ReportGateBlocker } from '../../lib/contracts'

export function gateBlockerAnchor(blocker: ReportGateBlocker): string | null {
  if (blocker.kind === 'ac') return `#${encodeURIComponent(`report-ac-${blocker.id}`)}`
  if (blocker.kind === 'scan') return `#${encodeURIComponent(`report-scan-${blocker.id}`)}`
  if (blocker.kind === 'deployment') return '#report-deployment'
  if (blocker.kind === 'revision') return '#report-summary'
  if (blocker.kind === 'deploy_decision') return '#report-decisions'
  return null
}

export function gateBlockerSentenceKey(blocker: ReportGateBlocker): string {
  return `delivery_os.report.gate.blockerSentence.${blocker.kind}`
}

export function gateBlockerKey(blocker: ReportGateBlocker, index: number): string {
  return `${blocker.kind}:${blocker.id}:${index}`
}
