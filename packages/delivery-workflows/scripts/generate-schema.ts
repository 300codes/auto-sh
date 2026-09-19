import { MikroORM } from '@mikro-orm/postgresql'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DeliveryWorkflowSettings, DeliveryWorkflowProjectBinding } from '../src/modules/delivery_workflows/data/entities'
const directory = fileURLToPath(new URL('../src/modules/delivery_workflows/migrations/', import.meta.url))
const orm = await MikroORM.init({ entities: [DeliveryWorkflowSettings, DeliveryWorkflowProjectBinding], dbName: 'open-mercato', connect: false })
try {
  const generator = orm.schema
  const sql = await generator.getCreateSchemaSQL({ wrap: false })
  const schema = generator.getTargetSchema()
  await mkdir(directory, { recursive: true })
  await writeFile(directory + '.snapshot-open-mercato.json', JSON.stringify(schema, null, 2) + '\n')
  const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean)
  const lines = statements.map((statement) => '    this.addSql(' + JSON.stringify(statement + ';') + ');').join('\n')
  await writeFile(directory + 'Migration20260919190000.ts', "import { Migration } from '@mikro-orm/migrations';\n\nexport class Migration20260919190000 extends Migration {\n  override async up(): Promise<void> {\n" + lines + "\n  }\n}\n")
  console.log('Generated isolated optional Delivery Workflows schema; no database connection.')
} finally { await orm.close() }
