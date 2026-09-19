import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'

let directory: string
let workerFile: string
const repositoryRoot = path.resolve(__dirname, '../../../../../..')

const worker = String.raw`
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { captureSiteSnapshot } from './operator/dist/snapshot.js';
import { siteIdFor, requestHashFor, writeRecord } from './operator/dist/ownership.js';
const require = createRequire(process.argv[1]);
const { mapOwnedWordpressResult } = require('./core/wordpressResultFixtures.js');
const caseName = process.argv[2];
const root = await fs.mkdtemp(path.join(path.dirname(process.argv[1]), 'case-'));
const hash = value => createHash('sha256').update(value).digest('hex');
try {
  const taskPackage = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: taskPackage.projectId };
  const siteId = siteIdFor(scope);
  const stateRoot = path.join(root, 'state');
  const statePath = path.join(stateRoot, siteId);
  const snapshotsRoot = path.join(statePath, 'snapshots');
  const sitePath = path.join(root, 'site');
  for (const folder of [stateRoot, statePath, snapshotsRoot, sitePath]) await fs.mkdir(folder, { mode: 0o700 });
  const creationAttemptId = randomUUID();
  const request = { scope, attemptId: creationAttemptId, idempotencyKey: 'bridge-unit', name: 'Bridge fixture', themeSlug: 'fixture' };
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready', result: {
    schemaVersion: 1, provenance: 'live', siteId, scope, attemptId: creationAttemptId, toolExecutionId: randomUUID(), studioSiteId: 'simulated-unit-owner', localUrl: 'http://localhost:9999', themeSlug: 'fixture', themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: []
  } });
  const themeRoot = path.join(sitePath, 'wp-content/themes/fixture/templates');
  await fs.mkdir(themeRoot, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(themeRoot, 'front-page.html'), 'before');
  const dbRoot = path.join(sitePath, 'wp-content/database');
  await fs.mkdir(dbRoot, { mode: 0o700 });
  const db = new DatabaseSync(path.join(dbRoot, '.ht.sqlite'));
  db.exec('CREATE TABLE bridge_fixture (id INTEGER); INSERT INTO bridge_fixture VALUES (1)');
  db.close();
  async function capture() {
    const captured = await captureSiteSnapshot({ sitePath, themeSlug: 'fixture', artifactRoot: snapshotsRoot });
    return { snapshotId: path.basename(captured.artifactDirectory), snapshot: {
      schemaVersion: 1, provenance: 'live', siteId, creationAttemptId, toolExecutionId: randomUUID(), capturedAt: new Date().toISOString(),
      sourceRevision: { kind: 'snapshot', contentHash: captured.contentHash, externalWorkspaceId: siteId }, themeFiles: captured.themeFiles, databaseHash: captured.databaseHash
    } };
  }
  const base = await capture();
  await fs.writeFile(path.join(themeRoot, 'front-page.html'), 'after');
  const result = await capture();
  taskPackage.baseRevision = base.snapshot.sourceRevision;
  const execution = { projectId: taskPackage.projectId, taskId: taskPackage.taskId, attemptId: taskPackage.attemptId, baselineId: taskPackage.baselineId, baselineHash: taskPackage.baselineHash, targetProfileId: taskPackage.targetProfileId, targetProfileVersion: taskPackage.targetProfileVersion, packageSchemaVersion: taskPackage.schemaVersion, externalRunId: 'unit-bridge-not-live' };
  const definition = Buffer.from('unit fixture definition; no live checks executed');
  const report = Buffer.from(JSON.stringify({ status: 'not_run', reason: 'unit-only transport check' }));
  const input = { taskPackage, trusted: { scope, siteId, creationAttemptId, execution: { ...execution }, baseToolExecutionId: base.snapshot.toolExecutionId, resultToolExecutionId: result.snapshot.toolExecutionId }, execution, base, result,
    config: { operatorRoot: path.join(path.dirname(process.argv[1]), 'operator'), stateRoot },
    checks: [{ check: { checkId: 'smoke-tests', testId: taskPackage.validationProfile.requiredTests['AC-101'][0], acIds: ['AC-101'], commandProfileId: 'playwright-smoke', validationProfileVersion: 1, testDefinitionHash: hash(definition), status: 'not_run', exitCode: null, durationMs: 0, sourceRevision: result.snapshot.sourceRevision, rawReportHash: hash(report) }, definition: { path: 'checks/definition.txt', bytes: definition }, report: { path: 'checks/report.json', bytes: report } }],
    usage: { source: 'runner', values: 'unknown' }
  };
  if (caseName === 'foreign-workspace') input.result.snapshot.sourceRevision.externalWorkspaceId = 'b'.repeat(64);
  if (caseName === 'corrupt-snapshot') await fs.writeFile(path.join(snapshotsRoot, result.snapshotId, 'theme/templates/front-page.html'), 'corrupt');
  if (caseName === 'foreign-scope') input.trusted.scope = { ...scope, organizationId: randomUUID() };
  if (caseName === 'corrupt-report') input.checks[0].report.bytes = Buffer.from('corrupt');
  if (caseName === 'foreign-attempt') input.execution.attemptId = randomUUID();
  if (caseName === 'snapshot-traversal') input.base.snapshotId = '../foreign';
  if (caseName === 'operator-symlink') { const alias = path.join(root, 'operator-link'); await fs.symlink(input.config.operatorRoot, alias); input.config.operatorRoot = alias; }
  if (caseName === 'artifact-limit-before-operator-read') {
    input.config.operatorRoot = path.join(root, 'nonexistent-operator');
    input.result.snapshot.themeFiles = Object.fromEntries(Array.from({ length: 201 }, (_, index) => ['templates/file-' + index + '.html', 'a'.repeat(64)]));
  }
  try {
    const manifest = await mapOwnedWordpressResult(input);
    console.log(JSON.stringify({ status: 'mapped', provenance: 'unit_fixture_simulated_live_metadata', changedPaths: manifest.changedPaths, checks: manifest.checks.map(check => check.status), workspaceMatches: manifest.resultRevision.externalWorkspaceId === siteId, baseMatches: manifest.baseRevision.contentHash === base.snapshot.sourceRevision.contentHash, artifactCount: manifest.artifacts.length, exactReportHash: manifest.artifacts.some(artifact => artifact.path === 'checks/report.json' && artifact.sha256 === hash(report) && artifact.sizeBytes === report.length), dbArtifactCount: manifest.artifacts.filter(artifact => artifact.path.endsWith('/database.sqlite')).length }));
  } catch (error) { console.log(JSON.stringify({ status: 'rejected', message: error.message })); }
} finally { await fs.rm(root, { recursive: true, force: true }); }
`

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-result-bridge-unit-'))
  const core = path.join(directory, 'core')
  const operator = path.join(directory, 'operator')
  await fs.mkdir(core)
  await fs.mkdir(path.join(operator, 'dist'), { recursive: true })
  await fs.writeFile(path.join(core, 'package.json'), JSON.stringify({ type: 'commonjs' }))
  await fs.writeFile(path.join(operator, 'package.json'), JSON.stringify({ name: '@open-mercato/delivery-wordpress', type: 'module' }))
  await fs.mkdir(path.join(operator, 'node_modules'))
  const zodRoot = path.dirname(createRequire(path.join(repositoryRoot, 'packages/delivery-wordpress/package.json')).resolve('zod/package.json'))
  await fs.mkdir(path.join(core, 'node_modules'))
  await fs.symlink(zodRoot, path.join(core, 'node_modules/zod'))
  await fs.symlink(zodRoot, path.join(operator, 'node_modules/zod'))
  for (const name of ['snapshot-reader', 'snapshot', 'ownership', 'paths', 'contracts']) {
    const source = await fs.readFile(path.join(repositoryRoot, `packages/delivery-wordpress/src/${name}.ts`), 'utf8')
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022, rewriteRelativeImportExtensions: true }, fileName: `${name}.ts` })
    await fs.writeFile(path.join(operator, 'dist', `${name}.js`), output.outputText)
  }
  for (const name of ['wordpressResultMapper', 'allowedPaths', 'contracts', 'canonicalConstants', 'resultChecks', 'targetProfiles']) {
    const source = await fs.readFile(path.join(repositoryRoot, `packages/core/src/modules/delivery_os/lib/${name}.ts`), 'utf8')
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext }, fileName: `${name}.cts` })
    await fs.writeFile(path.join(core, `${name}.js`), output.outputText)
  }
  const source = (await fs.readFile(path.join(repositoryRoot, 'packages/core/src/helpers/integration/wordpressResultFixtures.ts'), 'utf8')).replace('@open-mercato/core/modules/delivery_os/lib/wordpressResultMapper', './wordpressResultMapper')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext }, fileName: 'wordpressResultFixtures.cts' })
  await fs.writeFile(path.join(core, 'wordpressResultFixtures.js'), compiled.outputText)
  workerFile = path.join(directory, 'worker.mjs')
  await fs.writeFile(workerFile, worker)
})

afterAll(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }) })

function run(caseName: string) {
  return JSON.parse(execFileSync(process.execPath, [workerFile, caseName, path.join(repositoryRoot, 'packages/core/src/modules/delivery_os/lib/fixtures/task-package.snapshot.v1.json')], { encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024, env: { ...process.env, NODE_NO_WARNINGS: '1' } }))
}

it('executes compiled reader → mapper on real frozen SQLite/theme/report bytes without claiming live checks', () => {
  expect(run('positive')).toEqual({ status: 'mapped', provenance: 'unit_fixture_simulated_live_metadata', changedPaths: ['templates/front-page.html'], checks: ['not_run'], workspaceMatches: true, baseMatches: true, artifactCount: 6, exactReportHash: true, dbArtifactCount: 2 })
})

it.each([
  ['foreign-workspace', 'snapshot_reader_binding_mismatch'],
  ['corrupt-snapshot', 'snapshot_reader_hash_mismatch'],
  ['foreign-scope', 'snapshot_reader_ownership_mismatch'],
  ['corrupt-report', 'wordpress_result_artifact_hash_mismatch'],
  ['foreign-attempt', 'wordpress_result_correlation_mismatch'],
  ['snapshot-traversal', 'snapshot_reader_failed'],
  ['operator-symlink', 'wordpress_operator_path_invalid'],
  ['artifact-limit-before-operator-read', 'wordpress_result_artifact_count_limit'],
])('rejects %s before returning a manifest', (caseName, code) => {
  expect(run(caseName)).toEqual({ status: 'rejected', message: `[internal] ${code}` })
})
