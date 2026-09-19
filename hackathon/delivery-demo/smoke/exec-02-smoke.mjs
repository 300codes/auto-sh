#!/usr/bin/env node
/**
 * EXEC-02 smoke test — runs without OSS-02.
 *
 * Tests:
 *   1. Zod schemas parse/reject correctly (no Cezar needed)
 *   2. Log redaction strips sensitive fields
 *   3. Real Cezar runner probe + resultManifest mapping
 *
 * Run from repo root:
 *   node hackathon/delivery-demo/smoke/exec-02-smoke.mjs
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '../../..')

// Import from built dist
const distPath = join(repoRoot, 'packages/delivery-cezar/dist/index.js')
const {
  parseTaskPackage,
  taskPackageSchema,
  resultManifestSchema,
  parseResultManifest,
  redactTaskPackageForLogs,
  runCezarTask,
  mapCezarRunToResultManifest,
} = await import(distPath)

// ─── helpers ────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function ok(label) {
  console.log(`  ✓  ${label}`)
  passed++
}

function fail(label, err) {
  console.error(`  ✗  ${label}`)
  console.error(`     ${err?.message ?? err}`)
  failed++
}

function section(title) {
  console.log(`\n── ${title}`)
}

// ─── valid fixtures ──────────────────────────────────────────────────────────

const P = '00000001-0000-4000-8000-000000000001'
const T = '00000001-0000-4000-8000-000000000002'
const A = '00000001-0000-4000-8000-000000000003'
const B = '00000001-0000-4000-8000-000000000004'

const VALID_PKG = {
  schemaVersion: '1',
  projectId: P, taskId: T, attemptId: A, baselineId: B,
  baselineHash: 'sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  targetProfileId: 'react', targetProfileVersion: '1',
  requirements: [{ id: '00000001-0000-4000-8000-000000000010', title: 'Filter' }],
  ac: [{ id: '00000001-0000-4000-8000-000000000020', requirementId: '00000001-0000-4000-8000-000000000010', description: 'Filter works', requiredTestIds: ['TC-001'] }],
  repositoryRef: { url: 'https://github.com/example/react-app' },
  baseCommit: 'abc123def456',
  allowedPaths: ['src/'],
  validationProfile: { id: 'react-vite', version: '1' },
  limits: { maxDurationMs: 1_200_000 },
  idempotencyKey: 'secret-idem-key',
}

// ─── 1. Schema validation ────────────────────────────────────────────────────

section('1. Zod schema — TaskPackage v1')

try {
  parseTaskPackage(VALID_PKG)
  ok('valid TaskPackage parses')
} catch (e) { fail('valid TaskPackage parses', e) }

try {
  const result = taskPackageSchema.safeParse({ ...VALID_PKG, schemaVersion: '2' })
  if (!result.success) ok('unknown schemaVersion rejected')
  else fail('unknown schemaVersion rejected', new Error('should have failed'))
} catch (e) { fail('unknown schemaVersion rejected', e) }

try {
  const result = taskPackageSchema.safeParse({ ...VALID_PKG, baselineHash: 'nope' })
  if (!result.success) ok('missing sha256: prefix rejected')
  else fail('missing sha256: prefix rejected', new Error('should have failed'))
} catch (e) { fail('missing sha256: prefix rejected', e) }

section('2. Log redaction')

try {
  const redacted = redactTaskPackageForLogs(VALID_PKG)
  if (redacted.idempotencyKey === '[REDACTED]') ok('idempotencyKey redacted')
  else fail('idempotencyKey redacted', new Error(`got: ${redacted.idempotencyKey}`))
} catch (e) { fail('idempotencyKey redacted', e) }

try {
  const redacted = redactTaskPackageForLogs(VALID_PKG)
  if (redacted.projectId === P) ok('projectId preserved after redaction')
  else fail('projectId preserved after redaction', new Error(`got: ${redacted.projectId}`))
} catch (e) { fail('projectId preserved after redaction', e) }

// ─── 3. Real Cezar runner probe ──────────────────────────────────────────────

section('3. Cezar runner — live probe')
console.log('     task: output EXEC-02-RUNNER-OK (simple text, triggers CEZ:DONE)')
console.log('     (this takes ~15s and costs ~$0.10)')
console.log()

let runResult
try {
  runResult = await runCezarTask({
    task: 'Output the text EXEC-02-RUNNER-OK in your response.',
    baseDir: repoRoot,
    timeoutMs: 120_000,
  })

  if (runResult.exitCode === 0) ok(`exit code 0`)
  else fail(`exit code 0`, new Error(`got: ${runResult.exitCode}`))

  if (runResult.stdout.includes('EXEC-02-RUNNER-OK')) ok(`output contains EXEC-02-RUNNER-OK`)
  else fail(`output contains EXEC-02-RUNNER-OK`, new Error(`stdout: ${runResult.stdout.slice(0, 200)}`))

  if (runResult.runId) ok(`runId extracted: ${runResult.runId}`)
  else fail(`runId extracted`, new Error('runId undefined — branch pattern not matched'))

  console.log(`\n     stdout snippet:\n${runResult.stdout.split('\n').map(l => '     ' + l).join('\n').slice(0, 600)}`)

} catch (e) {
  fail('runCezarTask execution', e)
}

// ─── 4. ResultManifest mapping ───────────────────────────────────────────────

section('4. ResultManifest v1 mapping')

if (runResult) {
  try {
    const manifest = mapCezarRunToResultManifest({
      pkg: VALID_PKG,
      runResult,
    })

    parseResultManifest(manifest)
    ok('mapped ResultManifest passes Zod parse')

    if (manifest.taskId === T) ok(`taskId correlated: ${manifest.taskId}`)
    else fail('taskId correlated', new Error(`got: ${manifest.taskId}`))

    if (manifest.attemptId === A) ok(`attemptId correlated: ${manifest.attemptId}`)
    else fail('attemptId correlated', new Error(`got: ${manifest.attemptId}`))

    if (manifest.externalRunId) ok(`externalRunId from Cezar: ${manifest.externalRunId}`)
    else ok('externalRunId: undefined (branch not found in stdout, acceptable for probe)')

    if (manifest.usage.length > 0) ok(`usage captured: ${JSON.stringify(manifest.usage[0])}`)
    else fail('usage captured', new Error('empty usage'))

    console.log('\n     manifest summary:')
    console.log(`       schemaVersion : ${manifest.schemaVersion}`)
    console.log(`       sourceRevision: ${JSON.stringify(manifest.sourceRevision)}`)
    console.log(`       agentDecl     : ${manifest.agentDeclaration}`)
    console.log(`       usage         : ${JSON.stringify(manifest.usage)}`)

  } catch (e) {
    fail('mapCezarRunToResultManifest', e)
  }
} else {
  console.log('     skipped (runner failed)')
}

// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`)
console.log(`EXEC-02 smoke: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
