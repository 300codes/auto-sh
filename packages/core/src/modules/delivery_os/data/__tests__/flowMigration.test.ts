import { readFileSync } from 'fs'
import { join } from 'path'

const MIGRATION_FILE = join(__dirname, '..', '..', 'migrations', 'Migration20260919111236_delivery_os_flow_f1.ts')
const NEW_TABLES = ['delivery_intakes', 'delivery_flow_stage_artifacts', 'delivery_flow_stage_decisions']
const PROJECT_FLOW_COLUMNS = [
  'flow_template_id',
  'flow_template_version',
  'flow_template_hash',
  'flow_template_snapshot',
  'flow_pinned_at',
  'flow_workflow_instance_id',
  'flow_workflow_definition_id',
]

function readSection(source: string, method: 'up' | 'down'): string[] {
  const start = source.indexOf(`override ${method}()`)
  const end = method === 'up' ? source.indexOf('override down()') : source.length
  return [...source.slice(start, end).matchAll(/this\.addSql\(`([^`]*)`\)/g)].map((match) => match[1])
}

describe('delivery_os FLOW-F1 migration', () => {
  const source = readFileSync(MIGRATION_FILE, 'utf8')
  const up = readSection(source, 'up')
  const down = readSection(source, 'down')

  it('touches only delivery_* tables', () => {
    expect(up.length).toBeGreaterThan(0)
    for (const statement of [...up, ...down]) {
      const tables = [...statement.matchAll(/(?:table(?: if exists)?|on|index) "([a-z_]+)"/g)].map((match) => match[1])
      expect(tables.length).toBeGreaterThan(0)
      for (const table of tables) expect(table).toMatch(/^delivery_/)
    }
  })

  it('is additive: up only creates tables/indexes/constraints and adds nullable project columns', () => {
    for (const statement of up) {
      expect(statement).toMatch(/^(create table|create index|create unique index|alter table "[a-z_]+" add )/)
      expect(statement).not.toMatch(/\b(drop|rename|alter column|set not null|type )\b/i)
    }
    const projectAlter = up.find((statement) => statement.startsWith('alter table "delivery_projects" add '))
    expect(projectAlter).toBeDefined()
    for (const column of PROJECT_FLOW_COLUMNS) expect(projectAlter).toContain(`add "${column}" `)
    expect(projectAlter?.match(/ not null/g) ?? []).toHaveLength(0)
  })

  it('creates the three flow tables with the spec uniques', () => {
    for (const table of NEW_TABLES) expect(up.some((statement) => statement.startsWith(`create table "${table}"`))).toBe(true)
    const joined = up.join('\n')
    expect(joined).toContain('"delivery_intakes_scope_project_uq" unique ("tenant_id", "organization_id", "project_id")')
    expect(joined).toContain(
      '"delivery_flow_stage_artifacts_project_stage_version_uq" unique ("tenant_id", "organization_id", "project_id", "stage_id", "version")',
    )
    expect(joined).toContain(
      '"delivery_flow_stage_artifacts_project_stage_hash_uq" unique ("tenant_id", "organization_id", "project_id", "stage_id", "content_hash")',
    )
    expect(joined).toContain(
      '"delivery_flow_stage_decisions_project_idempotency_uq" unique ("tenant_id", "organization_id", "project_id", "idempotency_key")',
    )
    expect(joined).toContain('"delivery_projects_scope_flow_template_idx"')
  })

  it('down only reverts what up added', () => {
    for (const table of NEW_TABLES) expect(down).toContain(`drop table if exists "${table}" cascade;`)
    for (const statement of down) {
      expect(statement).not.toMatch(/drop table if exists "delivery_(projects|baselines|tasks|evidence|decisions)"/)
    }
  })
})
