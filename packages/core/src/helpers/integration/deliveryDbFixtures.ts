import { z } from 'zod'
import { withClient } from './dbFixtures'

const sentinelSchema = z.object({
  projectId: z.uuid(),
  tenantId: z.uuid(),
  organizationId: z.uuid(),
  runId: z.string().min(1),
  projectName: z.string().min(1),
}).refine((value) => value.projectName.startsWith(`${value.runId}-`))

const targetSchema = z.object({ taskId: z.uuid(), attemptId: z.uuid().optional() })
const countSchema = z.union([z.number(), z.string().regex(/^\d+$/)])
  .pipe(z.coerce.number<string | number>().int().nonnegative().max(Number.MAX_SAFE_INTEGER))
const countsSchema = z.object({
  projects: countSchema,
  baselines: countSchema,
  tasks: countSchema,
  decisions: countSchema,
  evidence: countSchema,
  attempts: countSchema,
  resultManifests: countSchema,
})
const sentinelRowSchema = z.object({
  id: z.uuid(),
  tenant_id: z.uuid(),
  organization_id: z.uuid(),
  name: z.string(),
})

export type DeliveryDbSentinel = z.infer<typeof sentinelSchema>
export type DeliveryDbCounts = z.infer<typeof countsSchema>
export type DeliveryDbCountResult =
  | { ok: true; counts: DeliveryDbCounts }
  | {
      ok: false
      status: 'not_run'
      category: 'environment'
      reason: 'database_url_missing' | 'invalid_sentinel' | 'sentinel_mismatch' | 'database_query_failed' | 'invalid_database_result'
    }

function unavailable(reason: Extract<DeliveryDbCountResult, { ok: false }>['reason']): DeliveryDbCountResult {
  return { ok: false, status: 'not_run', category: 'environment', reason }
}

export async function readDeliveryDbCounts(
  sentinel: DeliveryDbSentinel,
  target?: z.infer<typeof targetSchema>,
): Promise<DeliveryDbCountResult> {
  if (!process.env.DATABASE_URL?.trim()) return unavailable('database_url_missing')
  const parsedSentinel = sentinelSchema.safeParse(sentinel)
  const parsedTarget = targetSchema.optional().safeParse(target)
  if (!parsedSentinel.success || !parsedTarget.success) return unavailable('invalid_sentinel')
  const expected = parsedSentinel.data
  try {
    return await withClient(async (client): Promise<DeliveryDbCountResult> => {
      const proof = await client.query(
        'select id, tenant_id, organization_id, name from delivery_projects where id = $1 and tenant_id = $2 and organization_id = $3 and name = $4',
        [expected.projectId, expected.tenantId, expected.organizationId, expected.projectName],
      )
      const record = sentinelRowSchema.safeParse(proof.rows[0])
      if (proof.rows.length !== 1 || !record.success
        || record.data.id !== expected.projectId
        || record.data.tenant_id !== expected.tenantId
        || record.data.organization_id !== expected.organizationId
        || record.data.name !== expected.projectName) return unavailable('sentinel_mismatch')

      const result = await client.query(`
        with scoped_tasks as (
          select execution_attempts from delivery_tasks
          where project_id = $1 and tenant_id = $2 and organization_id = $3
            and ($4::uuid is null or id = $4)
        ), scoped_evidence as (
          select kind, attempt_id from delivery_evidence
          where project_id = $1 and tenant_id = $2 and organization_id = $3
            and ($4::uuid is null or task_id = $4)
        )
        select
          (select count(*) from delivery_projects where id = $1 and tenant_id = $2 and organization_id = $3) as projects,
          (select count(*) from delivery_baselines where project_id = $1 and tenant_id = $2 and organization_id = $3) as baselines,
          (select count(*) from scoped_tasks) as tasks,
          (select count(*) from delivery_decisions where project_id = $1 and tenant_id = $2 and organization_id = $3) as decisions,
          (select count(*) from scoped_evidence) as evidence,
          (select count(*) from scoped_tasks cross join lateral jsonb_array_elements(execution_attempts) as attempt(value)
            where $5::uuid is null or attempt.value->>'attemptId' = $5::text) as attempts,
          (select count(*) from scoped_evidence where kind = 'result_manifest'
            and ($5::uuid is null or attempt_id = $5)) as "resultManifests"
      `, [expected.projectId, expected.tenantId, expected.organizationId, parsedTarget.data?.taskId ?? null, parsedTarget.data?.attemptId ?? null])
      const parsedCounts = countsSchema.safeParse(result.rows[0])
      if (result.rows.length !== 1 || !parsedCounts.success) return unavailable('invalid_database_result')
      return { ok: true, counts: parsedCounts.data }
    })
  } catch {
    return unavailable('database_query_failed')
  }
}
