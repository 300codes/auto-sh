import {
  buildDeliveryError,
  isSameRevision,
  type CheckStatus,
  type DeliveryCheckResult,
  type DeliveryErrorCode,
  type DeliveryErrorDetail,
  type ResultCheck,
  type SourceRevision,
  type ValidationProfile,
} from './contracts'

export type ReportedChecksInput = {
  checks: readonly ResultCheck[]
  resultRevision: SourceRevision
  validationProfile: ValidationProfile
  acceptanceCriteriaIds: readonly string[]
  knownTestIds: readonly string[]
  pathPrefix?: string
}

type CheckIssue = { code: DeliveryErrorCode; detail: DeliveryErrorDetail }

const REPORTED_CHECK_ERROR_PRIORITY: readonly DeliveryErrorCode[] = ['unknown_ac', 'unknown_test_id', 'correlation_mismatch']

const REPORTED_CHECK_ERROR_MESSAGES: Partial<Record<DeliveryErrorCode, string>> = {
  unknown_ac: 'A check refers to an acceptance criterion outside this task',
  unknown_test_id: 'A check is not part of the frozen test catalogue',
  correlation_mismatch: 'A check does not match the reserved attempt',
}

export function mapRunnerStatus(status: string): CheckStatus {
  if (status === 'passed' || status === 'failed') return status
  return 'not_run'
}

function requiredTestsFor(validationProfile: ValidationProfile, acId: string): readonly string[] {
  return Object.hasOwn(validationProfile.requiredTests, acId) ? validationProfile.requiredTests[acId] : []
}

export function checkReportedChecks(input: ReportedChecksInput): DeliveryCheckResult {
  const { checks, resultRevision, validationProfile, pathPrefix = 'checks.' } = input
  const acIds = new Set(input.acceptanceCriteriaIds)
  const knownTestIds = new Set(input.knownTestIds)
  const issues: CheckIssue[] = []
  const add = (code: DeliveryErrorCode, index: number, field: string, detailCode: string, message: string) => {
    issues.push({ code, detail: { path: `${pathPrefix}${index}.${field}`, code: detailCode, message } })
  }

  checks.forEach((check, index) => {
    const definitions = validationProfile.checks.filter((definition) => definition.commandProfileId === check.commandProfileId)
    const isProfileCheck = definitions.some((definition) => definition.kind !== 'test' && definition.checkId === check.testId)
    if (definitions.length === 0) {
      add('unknown_test_id', index, 'commandProfileId', 'unknown_command_profile', `${check.commandProfileId} is not a check of the validation profile`)
    } else if (!isProfileCheck && !definitions.some((definition) => definition.kind === 'test')) {
      add('unknown_test_id', index, 'testId', 'check_id_mismatch', `${check.testId} is not the profile check run by ${check.commandProfileId}`)
    } else if (!isProfileCheck && !knownTestIds.has(check.testId)) {
      add('unknown_test_id', index, 'testId', 'unknown_test_id', `${check.testId} is not a declared test`)
    }

    check.acIds.forEach((acId, acIndex) => {
      if (!acIds.has(acId)) {
        add('unknown_ac', index, `acIds.${acIndex}`, 'unknown_ac', `${acId} is not an acceptance criterion of this task on the pinned baseline`)
      } else if (!requiredTestsFor(validationProfile, acId).includes(check.testId)) {
        add('unknown_test_id', index, `acIds.${acIndex}`, 'test_not_mapped_to_ac', `${check.testId} is not mapped to ${acId} in the approved baseline`)
      }
    })

    if (check.validationProfileVersion !== validationProfile.version) {
      add('correlation_mismatch', index, 'validationProfileVersion', 'validation_profile_version_mismatch', `The task package uses validation profile version ${validationProfile.version}`)
    }
    if (!isSameRevision(check.sourceRevision, resultRevision)) {
      add('correlation_mismatch', index, 'sourceRevision', 'source_revision_mismatch', 'The check ran on another revision than the result')
    }
  })

  if (issues.length === 0) return { ok: true }
  const top = REPORTED_CHECK_ERROR_PRIORITY.find((code) => issues.some((issue) => issue.code === code)) ?? issues[0].code
  return {
    ok: false,
    ...buildDeliveryError(top, REPORTED_CHECK_ERROR_MESSAGES[top] ?? 'Validation failed', issues.map((issue) => issue.detail)),
  }
}
