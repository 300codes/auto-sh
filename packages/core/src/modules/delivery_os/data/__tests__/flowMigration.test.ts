import { readFileSync } from 'fs'
import { join } from 'path'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')
const F1_FILE = 'Migration20260919111236_delivery_os_flow_f1.ts'
const F2_FILE = 'Migration20260919160535_delivery_os_flow_f2.ts'
const F1_TABLES = ['delivery_intakes', 'delivery_flow_stage_artifacts', 'delivery_flow_stage_decisions']
const F2_TABLES = ['delivery_staff_links', 'delivery_comment_threads', 'delivery_comment_replies']
const PROJECT_FLOW_COLUMNS = [
  'flow_template_id',
  'flow_template_version',
  'flow_template_hash',
  'flow_template_snapshot',
  'flow_pinned_at',
  'flow_workflow_instance_id',
  'flow_workflow_definition_id',
]
const F2_DEFINITIONS = [
  '"delivery_staff_links_scope_project_uq" unique ("tenant_id", "organization_id", "project_id")',
  '"delivery_staff_links_scope_staff_project_uq" unique ("tenant_id", "organization_id", "staff_project_id")',
  '"delivery_comment_threads_scope_file_thread_uq" unique ("tenant_id", "organization_id", "project_id", "source", "file_key", "thread_key")',
  'create index "delivery_comment_threads_scope_staff_task_idx" on "delivery_comment_threads" ("tenant_id", "organization_id", "staff_task_id")',
  'create index "delivery_comment_threads_scope_project_stage_idx" on "delivery_comment_threads" ("tenant_id", "organization_id", "project_id", "stage_id")',
  '"delivery_comment_replies_scope_thread_comment_revision_uq" unique ("tenant_id", "organization_id", "thread_id", "comment_key", "revision")',
  'create index "delivery_comment_replies_scope_thread_idx" on "delivery_comment_replies" ("tenant_id", "organization_id", "thread_id")',
]
const F2_ENCRYPTED_COLUMNS = ['"author" jsonb not null', '"body" text not null']

function readSection(source: string, method: 'up' | 'down'): string[] {
  const start = source.indexOf(`override ${method}()`)
  const end = method === 'up' ? source.indexOf('override down()') : source.length
  return [...source.slice(start, end).matchAll(/this\.addSql\(`([^`]*)`\)/g)].map((match) => match[1])
}

function loadMigration(file: string): { up: string[]; down: string[] } {
  const source = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
  return { up: readSection(source, 'up'), down: readSection(source, 'down') }
}

describe.each([
  { stage: 'FLOW-F1', file: F1_FILE, tables: F1_TABLES },
  { stage: 'FLOW-F2', file: F2_FILE, tables: F2_TABLES },
])('delivery_os $stage migration', ({ file, tables }) => {
  const { up, down } = loadMigration(file)

  it('touches only delivery_* tables', () => {
    expect(up.length).toBeGreaterThan(0)
    expect(down.length).toBeGreaterThan(0)
    for (const statement of [...up, ...down]) {
      const found = [...statement.matchAll(/(?:table(?: if exists)?|on|index) "([a-z_]+)"/g)].map((match) => match[1])
      expect(found.length).toBeGreaterThan(0)
      for (const table of found) expect(table).toMatch(/^delivery_/)
    }
  })

  it('is additive: up only creates tables/indexes/constraints or adds nullable columns', () => {
    for (const statement of up) {
      expect(statement).toMatch(/^(create table|create index|create unique index|alter table "[a-z_]+" add )/)
      expect(statement).not.toMatch(/\b(drop|rename|alter column|set not null|type )\b/i)
    }
  })

  it('creates the stage tables and down only reverts them', () => {
    for (const table of tables) {
      expect(up.some((statement) => statement.startsWith(`create table "${table}"`))).toBe(true)
      expect(down).toContain(`drop table if exists "${table}" cascade;`)
    }
    for (const statement of down) {
      expect(statement).not.toMatch(/drop table if exists "delivery_(projects|baselines|tasks|evidence|decisions)"/)
    }
  })
})

describe('delivery_os FLOW-F1 migration specifics', () => {
  const { up } = loadMigration(F1_FILE)

  it('adds only nullable flow columns to delivery_projects and the spec uniques', () => {
    const projectAlter = up.find((statement) => statement.startsWith('alter table "delivery_projects" add '))
    expect(projectAlter).toBeDefined()
    for (const column of PROJECT_FLOW_COLUMNS) expect(projectAlter).toContain(`add "${column}" `)
    expect(projectAlter?.match(/ not null/g) ?? []).toHaveLength(0)
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
})

describe('delivery_os FLOW-F2 migration specifics', () => {
  const { up } = loadMigration(F2_FILE)
  const joined = up.join('\n')

  it('creates only the three F2 tables and never alters existing ones', () => {
    expect(up.filter((statement) => statement.startsWith('create table ')).map((statement) => statement.match(/"([a-z_]+)"/)?.[1]).sort()).toEqual(
      [...F2_TABLES].sort(),
    )
    expect(up.some((statement) => statement.startsWith('alter table "delivery_projects"'))).toBe(false)
  })

  it('defines the spec uniques and indexes', () => {
    for (const definition of F2_DEFINITIONS) expect(joined).toContain(definition)
  })

  it('stores comment PII as plain columns that the encryption map covers and keeps revisions append-only', () => {
    for (const table of ['delivery_comment_threads', 'delivery_comment_replies']) {
      const create = up.find((statement) => statement.startsWith(`create table "${table}"`)) ?? ''
      for (const column of F2_ENCRYPTED_COLUMNS) expect(create).toContain(column)
    }
    const replies = up.find((statement) => statement.startsWith('create table "delivery_comment_replies"')) ?? ''
    expect(replies).toContain('"revision" int not null')
    expect(replies).toContain('"deleted" boolean not null default false')
    expect(replies).not.toContain('"updated_at"')
    const threads = up.find((statement) => statement.startsWith('create table "delivery_comment_threads"')) ?? ''
    expect(threads).toContain('"version_confirmed" boolean not null default false')
    expect(threads).toContain('"triage_status" text not null default \'new\'')
    expect(threads).toContain('"updated_at" timestamptz not null')
    const links = up.find((statement) => statement.startsWith('create table "delivery_staff_links"')) ?? ''
    expect(links).toContain('"sync_cursors" jsonb not null default \'{}\'')
    expect(links).toContain('"updated_at" timestamptz not null')
  })
})
