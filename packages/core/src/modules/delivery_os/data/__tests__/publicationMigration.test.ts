import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')
const F4_FILE = 'Migration20260919152308_delivery_os_flow_f4.ts'

function readSection(source: string, method: 'up' | 'down'): string[] {
  const start = source.indexOf(`override ${method}()`)
  const end = method === 'up' ? source.indexOf('override down()') : source.length
  return [...source.slice(start, end).matchAll(/this\.addSql\(`([^`]*)`\)/g)].map((match) => match[1])
}

describe('delivery_os FLOW-F4 migration', () => {
  const source = readFileSync(join(MIGRATIONS_DIR, F4_FILE), 'utf8')
  const up = readSection(source, 'up')
  const down = readSection(source, 'down')

  it('is the only flow_f4 migration of the module', () => {
    expect(readdirSync(MIGRATIONS_DIR).filter((file) => file.includes('flow_f4'))).toEqual([F4_FILE])
  })

  it('touches only delivery_publications', () => {
    expect(up.length).toBeGreaterThan(0)
    for (const statement of [...up, ...down]) {
      const tables = [...statement.matchAll(/(?:table(?: if exists)?|on) "([a-z_]+)"/g)].map((match) => match[1])
      expect(tables).toEqual(['delivery_publications'])
    }
  })

  it('is additive and carries the scope-leading index and the payload-hash unique', () => {
    for (const statement of up) {
      expect(statement).toMatch(/^(create table|create index|alter table "delivery_publications" add constraint)/)
      expect(statement).not.toMatch(/\b(drop|rename|alter column)\b/i)
    }
    const joined = up.join('\n')
    expect(joined).toContain(
      '"delivery_publications_scope_project_payload_hash_uq" unique ("tenant_id", "organization_id", "project_id", "payload_hash")',
    )
    expect(joined).toContain(
      '"delivery_publications_scope_project_created_idx" on "delivery_publications" ("tenant_id", "organization_id", "project_id", "created_at")',
    )
    expect(joined).not.toMatch(/references|foreign key/i)
  })

  it('down drops only the publication table', () => {
    expect(down).toEqual(['drop table if exists "delivery_publications" cascade;'])
  })
})
