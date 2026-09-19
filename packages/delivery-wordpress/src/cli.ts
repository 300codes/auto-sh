import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createSiteRequestSchema, parseInput, toolError } from './contracts.ts'
import { createWordPressStudioTools } from './index.ts'
import { assertRegularFile, assertSafeDirectory } from './paths.ts'
import { pathToFileURL } from 'node:url'
import { errorCode, runCreateScenario } from './cli-support.ts'

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      'sites-root': { type: 'string' }, 'state-root': { type: 'string' },
      request: { type: 'string' }, output: { type: 'string' },
    },
  })
  if (positionals.length !== 1 || positionals[0] !== 'create' || !values['sites-root'] ||
    !values['state-root'] || !values.request || !values.output) throw toolError('invalid_cli_arguments')
  const requestPath = path.resolve(values.request)
  const outputPath = path.resolve(values.output)
  await assertRegularFile(requestPath)
  if ((await fs.stat(requestPath)).size > 64 * 1024) throw toolError('request_size_limit')
  const request = parseInput(createSiteRequestSchema, JSON.parse(await fs.readFile(requestPath, 'utf8')))
  await assertSafeDirectory(path.dirname(outputPath))
  const output = await fs.open(outputPath, 'wx', 0o600)
  try {
    const tools = createWordPressStudioTools({ sitesRoot: values['sites-root'], stateRoot: values['state-root'] })
    const report = await runCreateScenario(request, tools, { provenance: 'live' })
    await output.writeFile(JSON.stringify(report, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ status: report.status, siteId: report.siteId,
      ...(report.site ? { localUrl: report.site.localUrl } : {}),
      report: outputPath, omIntegration: 'not_connected', preview: 'not_published' }) + '\n')
    if (report.status === 'blocked') process.exitCode = 1
  } finally {
    await output.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(JSON.stringify({ status: 'blocked', code: errorCode(error) }) + '\n')
    process.exitCode = 1
  })
}
