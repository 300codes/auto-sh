import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  baselineCreateResponseSchema,
  decisionCreateResponseSchema,
  projectCreateResponseSchema,
  projectDetailSchema,
} from '../api/schemas'
import { DELIVERY_SCHEMA_VERSIONS, deliveryReportV1Schema } from '../lib/contracts'
import en from '../i18n/en.json'

const labels: Record<string, string> = en
const api = '/api/delivery_os/projects'

async function createProject(request: APIRequestContext, token: string, profile: string) {
  const response = await apiRequest(request, 'POST', api, {
    token,
    data: {
      name: `TC-DELIVERY-UI-005 ${randomUUID()}`,
      inputMode: 'from_brief',
      brief: 'Report missing evidence without claiming delivery success.',
      targetProfileId: profile,
    },
  })
  expect(response.status()).toBe(201)
  return projectCreateResponseSchema.parse(await readJsonSafe(response))
}

async function archiveProject(request: APIRequestContext, token: string, projectId: string) {
  const response = await apiRequest(request, 'GET', `${api}/${projectId}`, { token })
  expect(response.ok()).toBe(true)
  const project = projectDetailSchema.parse(await readJsonSafe(response))
  if (project.archivedAt) return
  expect(project.updatedAt).not.toBeNull()
  const archived = await apiRequest(request, 'DELETE', `${api}?id=${projectId}`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: project.updatedAt! },
  })
  expect(archived.ok(), 'archive only this test project').toBe(true)
}

async function activateLegacyBaseline(
  request: APIRequestContext,
  token: string,
  project: { id: string; updatedAt: string },
) {
  const response = await apiRequest(request, 'POST', `${api}/${project.id}/baselines`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: project.updatedAt },
    data: {
      source: 'requirements_proposal',
      manifest: {
        schemaVersion: DELIVERY_SCHEMA_VERSIONS.requirementsProposal,
        projectId: project.id,
        manifestId: `ui-05-${randomUUID()}`,
        requirements: [{ id: 'REQ-1', title: 'A report preserves missing proof' }],
        acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'Missing evidence never becomes passed.' }],
        questions: [],
        risks: [],
        producedBy: { tool: 'claude-code', sessionRef: null },
      },
    },
  })
  expect(response.status()).toBe(201)
  const baseline = baselineCreateResponseSchema.parse(await readJsonSafe(response))
  let version = baseline.projectUpdatedAt
  for (const kind of ['requirements', 'design'] as const) {
    const decision = await apiRequest(request, 'POST', `/api/delivery_os/baselines/${baseline.baselineId}/decisions`, {
      token,
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: version },
      data: { kind, verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version },
    })
    expect(decision.status()).toBe(201)
    const accepted = decisionCreateResponseSchema.parse(await readJsonSafe(decision))
    version = accepted.projectUpdatedAt
    if (kind === 'design') expect(accepted.activeBaselineId).toBe(baseline.baselineId)
  }
  return baseline
}

test.describe('TC-DELIVERY-UI-005: real report API and UI, dependency-limited scope', () => {
  test('project navigation hydrates a named no-baseline state', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const project = await createProject(request, token, 'react-vite')
    try {
      await login(page, 'admin')
      await page.goto(`/backend/delivery/projects/${project.id}`)
      await page.getByTestId('delivery-report-link').click()
      await expect(page).toHaveURL(new RegExp(`/backend/delivery/projects/${project.id}/report$`))
      await expect(page.getByText(labels['delivery_os.report.noBaseline'], { exact: true })).toBeVisible()
      await expect(page.getByTestId('delivery-report-summary')).toHaveCount(0)
      await expect(page.getByRole('link', { name: labels['delivery_os.report.project'], exact: true }))
        .toHaveAttribute('href', `/backend/delivery/projects/${project.id}`)
    } finally {
      await archiveProject(request, token, project.id)
    }
  })

  for (const fixture of [
    { profile: 'react-vite', revision: `git:${'a'.repeat(40)}`, display: `git:${'a'.repeat(40)}`, width: 1440 },
    { profile: 'wordpress-theme', revision: `snapshot:${'b'.repeat(64)}:ui-05:workspace`, display: `snapshot:${'b'.repeat(64)}`, width: 390 },
  ]) {
    test(`${fixture.profile}: current missing evidence and pinned history remain unapproved`, async ({ page, request }) => {
      const token = await getAuthToken(request, 'admin')
      const project = await createProject(request, token, fixture.profile)
      try {
        const baseline = await activateLegacyBaseline(request, token, project)
        const response = await apiRequest(request, 'GET', `${api}/${project.id}/report`, { token })
        expect(response.status()).toBe(200)
        const report = deliveryReportV1Schema.parse(await readJsonSafe(response))
        expect(report.baselineId).toBe(baseline.baselineId)
        expect(report.revision).toBeNull()
        expect(report.gates.publishable.ok).toBe(false)
        expect(report.gates.releasable.ok).toBe(false)
        expect(report.acceptanceCriteria.every((criterion) => criterion.status !== 'passed')).toBe(true)

        await page.setViewportSize({ width: fixture.width, height: 900 })
        await login(page, 'admin')
        const route = `/backend/delivery/projects/${project.id}/report`
        await page.goto(route)
        await expect(page.getByTestId('delivery-report-summary')).toContainText(baseline.baselineId)
        await expect(page.getByText(labels['delivery_os.report.summary.noRevision'], { exact: true })).toBeVisible()
        await expect(page.getByTestId('report-evidence-unavailable')).toBeVisible()
        await expect(page.getByRole('button', { name: labels['delivery_os.report.decisions.deploy'], exact: true })).toBeDisabled()
        await expect(page.getByRole('button', { name: labels['delivery_os.report.decisions.release'], exact: true })).toBeDisabled()

        const query = new URLSearchParams({ baselineId: baseline.baselineId, revision: fixture.revision })
        const historyResponse = await apiRequest(request, 'GET', `${api}/${project.id}/report?${query}`, { token })
        expect(historyResponse.status()).toBe(200)
        const history = deliveryReportV1Schema.parse(await readJsonSafe(historyResponse))
        expect(history.revision?.kind).toBe(fixture.profile === 'react-vite' ? 'git' : 'snapshot')
        expect(history.gates.releasable.ok).toBe(false)
        const writes: string[] = []
        page.on('request', (outgoing) => {
          if (outgoing.url().includes('/api/delivery_os/') && outgoing.method() !== 'GET') writes.push(outgoing.url())
        })
        await page.goto(`${route}?${query}`)
        await expect(page.getByTestId('delivery-report-summary')).toContainText(fixture.display)
        await expect(page.getByText(labels['delivery_os.report.historical'], { exact: true })).toBeVisible()
        await expect(page.getByTestId('delivery-report-decisions')).toHaveCount(0)
        if (fixture.profile === 'wordpress-theme') {
          await expect(page.getByTestId('delivery-report-summary')).toContainText('ui-05:workspace')
        }

        query.set('baselineId', randomUUID())
        await page.goto(`${route}?${query}`)
        await expect(page.getByText(labels['delivery_os.report.notFound'], { exact: true })).toBeVisible()
        await expect(page.getByTestId('delivery-report-summary')).toHaveCount(0)
        await expect(page).toHaveURL(`${new URL(page.url()).origin}${route}?${query}`)
        expect(writes, 'history and missing history never append a decision').toEqual([])
      } finally {
        await archiveProject(request, token, project.id)
      }
    })
  }

  test('D1: source record and screenshot open through the published evidence API', async () => {
    test.skip(true, 'Blocked: OSS has not published the D1 paginated evidence/detail/attachment DTO. No mocked endpoint substitutes for integration.')
  })

  test('D2: new project flow approvals are enforced by the real runtime gate', async () => {
    test.skip(true, 'Blocked: OSS D2 flow report projection and runtime gate are absent. Legacy approvals do not prove the new flow.')
  })

  test('D3: deploy consent, verified external deployment and separate release acceptance', async () => {
    test.skip(true, 'Blocked: OSS D3 authoritative acceptance candidate is absent. Latest task result cannot authorize approval; 409/422 mutation coverage awaits the real integration.')
  })
})
