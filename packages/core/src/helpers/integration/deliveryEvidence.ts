import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test, type TestInfo } from '@playwright/test'
import { createDeliveryFixtureSession, readDeliveryFixtureEnvironment } from './deliveryFixtures'

export type DeliveryFixtureSession = Awaited<ReturnType<typeof createDeliveryFixtureSession>>

export async function attachDeliveryEvidence(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  if (!/^[a-zA-Z0-9-]+$/.test(name)) throw new Error('[internal] Invalid delivery evidence name')
  const bytes = Buffer.from(JSON.stringify(value, null, 2))
  const path = testInfo.outputPath(`${name}.json`)
  await writeFile(path, bytes)
  await testInfo.attach(`${name}.json`, { path, contentType: 'application/json' })
  await testInfo.attach(`${name}.sha256`, { body: createHash('sha256').update(bytes).digest('hex'), contentType: 'text/plain' })
}

export async function withDeliveryFixture(
  testInfo: TestInfo,
  run: (fixture: DeliveryFixtureSession) => Promise<void>,
  options: { full?: boolean } = {},
): Promise<void> {
  const environment = readDeliveryFixtureEnvironment()
  if (!environment.ok) {
    test.skip(true, environment.reason)
    return
  }
  const suiteRunId = process.env.OM_DELIVERY_QA_RUN_ID ?? randomUUID()
  const fixture = await createDeliveryFixtureSession(environment.value, { runId: suiteRunId, testId: testInfo.testId, retry: testInfo.retry })
  try {
    if (options.full) await fixture.provision()
    else await fixture.provisionControl()
    await run(fixture)
  } finally {
    try {
      const cleanup = await fixture.ledger.cleanup()
      await attachDeliveryEvidence(testInfo, 'delivery-case', {
        schemaVersion: 1, suiteRunId, testId: testInfo.testId, title: testInfo.title,
        provenance: 'http-fixture', codeRevision: process.env.OM_DELIVERY_QA_CODE_REVISION ?? null,
        appRevision: process.env.OM_DELIVERY_QA_APP_REVISION ?? null,
        environmentId: fixture.environment.environmentId,
        namespace: fixture.namespace, scopes: fixture.scopes,
        timestamp: new Date().toISOString(), cleanup,
        cleanupStatus: fixture.unmanagedMutations.length > 0 ? 'incomplete_unmanaged_mutation' : cleanup.failures.length > 0 ? 'failed' : 'pending_environment_disposal',
        unmanagedMutations: fixture.unmanagedMutations,
        assertionOutcome: 'see-native-playwright-result',
      })
      expect.soft(cleanup.failures, 'Every owned resource must be cleaned').toEqual([])
      expect.soft(fixture.unmanagedMutations, 'Unexpected or uncertain writes require environment disposal and cannot claim scenario cleanup').toEqual([])
      expect.soft(cleanup.resources.every((resource) => resource.state === 'cleaned')).toBe(true)
    } finally {
      await fixture.dispose()
    }
  }
}

export function requireDeliveryResource<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error('[internal] Delivery fixture resource missing')
  return value
}
