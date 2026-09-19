import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { captureOwnedSnapshot, readCapturedOwnedSnapshot } from '../capture-owned-snapshot.ts'
import { savedDeploymentFixture } from './fixtures/saved-deployment.ts'
import type { CommandRunner } from '../runner.ts'

async function fixture(initialRunning = false) {
  const own = await savedDeploymentFixture()
  let running = initialRunning
  const calls: string[] = []
  let failStart = false
  let ignoreStop = false
  let ignoreStart = false
  let registration = 'fixture-studio'
  const runner: CommandRunner = async (_executable, args) => {
    calls.push(args.slice(0, 2).join(' '))
    if (args[1] === 'stop') { if (!ignoreStop) running = false; return { exitCode: 0, stdout: '' } }
    if (args[1] === 'start') { if (failStart) throw new Error('private stderr must not escape'); if (!ignoreStart) running = true; return { exitCode: 0, stdout: '' } }
    return { exitCode: 0, stdout: JSON.stringify([{ id: registration, path: own.sitePath, running }]) }
  }
  return { ...own, runner, calls, input: { scope: own.input.scope, handle: own.input.handle, config: own.input.config },
    running: () => running, failStart: () => { failStart = true }, ignoreStop: () => { ignoreStop = true }, ignoreStart: () => { ignoreStart = true }, wrongRegistration: () => { registration = 'foreign' } }
}

for (const initialRunning of [false, true]) test(`capture preserves running=${initialRunning} and reads original receipt-bound bytes`, async () => {
  const own = await fixture(initialRunning)
  try {
    const captured = await captureOwnedSnapshot(own.input, { runner: own.runner })
    assert.equal(own.running(), initialRunning)
    assert.equal(captured.snapshot.provenance, 'fixture')
    const owner = JSON.parse(await fs.readFile(path.join(own.statePath, 'record.json'), 'utf8'))
    assert.equal(captured.snapshot.creationAttemptId, owner.request.attemptId)
    const read = await readCapturedOwnedSnapshot({ scope: own.input.scope, handle: own.input.handle, receiptId: captured.receiptId, expectedReceiptHash: captured.receiptHash, config: { stateRoot: own.input.config.stateRoot } })
    assert.deepEqual(read.artifacts.snapshot, captured.snapshot)
    assert.equal(read.artifacts.theme['index.php'].bytes.toString(), '<?php echo "fixture";')
    assert.ok(read.artifacts.database.bytes.length > 0)
    assert.equal((await fs.stat(path.join(own.statePath, 'snapshot-receipts', `${captured.receiptId}.json`))).mode & 0o077, 0)
    await assert.rejects(fs.lstat(path.join(own.statePath, 'operation.lock')), { code: 'ENOENT' })
    assert.equal(own.calls.filter((call) => call === 'site start').length, initialRunning ? 1 : 0)
    assert.equal(own.calls.filter((call) => call === 'site stop').length, initialRunning ? 1 : 0)
  } finally { await own.dispose() }
})

test('foreign owner/registration fail before stop or capture', async () => {
  const own = await fixture(true)
  try {
    await assert.rejects(captureOwnedSnapshot({ ...own.input, scope: { ...own.input.scope, projectId: '11111111-1111-4111-8111-111111111111' } }, { runner: own.runner }))
    own.wrongRegistration()
    await assert.rejects(captureOwnedSnapshot(own.input, { runner: own.runner }), { code: 'site_registration_mismatch' })
    assert.ok(!own.calls.includes('site stop'))
    await assert.rejects(fs.lstat(path.join(own.statePath, 'operation.lock')), { code: 'ENOENT' })
  } finally { await own.dispose() }
})

test('capture failure restores running site, retains reconciliation lock and creates no receipt', async () => {
  const own = await fixture(true)
  try {
    await fs.unlink(path.join(own.sitePath, 'wp-content/themes/fixture/index.php'))
    await assert.rejects(captureOwnedSnapshot(own.input, { runner: own.runner }), { code: 'capture_snapshot_failed' })
    assert.equal(own.running(), true)
    assert.ok((await fs.stat(path.join(own.statePath, 'operation.lock'))).isDirectory())
    await assert.rejects(fs.lstat(path.join(own.statePath, 'snapshot-receipts')), { code: 'ENOENT' })
  } finally { await own.dispose() }
})

for (const failure of ['stop', 'start', 'restore-state'] as const) test(`uncertain ${failure} never creates successful capture receipt`, async () => {
  const own = await fixture(true)
  try {
    if (failure === 'stop') own.ignoreStop()
    if (failure === 'start') own.failStart()
    if (failure === 'restore-state') own.ignoreStart()
    await assert.rejects(captureOwnedSnapshot(own.input, { runner: own.runner }), (error: unknown) => error instanceof Error && error.message.startsWith('[internal] capture_snapshot_') && !error.message.includes('private stderr'))
    assert.ok((await fs.stat(path.join(own.statePath, 'operation.lock'))).isDirectory())
    await assert.rejects(fs.lstat(path.join(own.statePath, 'snapshot-receipts')), { code: 'ENOENT' })
  } finally { await own.dispose() }
})

test('receipt identity and bytes cannot be replaced by caller snapshot metadata', async () => {
  const own = await fixture()
  try {
    const captured = await captureOwnedSnapshot(own.input, { runner: own.runner })
    const input = { scope: own.input.scope, handle: own.input.handle, receiptId: captured.receiptId, expectedReceiptHash: captured.receiptHash, config: { stateRoot: own.input.config.stateRoot } }
    await assert.rejects(readCapturedOwnedSnapshot({ ...input, expectedReceiptHash: 'b'.repeat(64) }), { code: 'capture_snapshot_receipt_mismatch' })
    await assert.rejects(readCapturedOwnedSnapshot({ ...input, scope: { ...input.scope, tenantId: '11111111-1111-4111-8111-111111111111' } }), { code: 'capture_snapshot_receipt_mismatch' })
    const filename = path.join(own.statePath, 'snapshot-receipts', `${captured.receiptId}.json`)
    const receipt = JSON.parse(await fs.readFile(filename, 'utf8'))
    receipt.snapshot.toolExecutionId = '11111111-1111-4111-8111-111111111111'
    await fs.writeFile(filename, JSON.stringify(receipt))
    await assert.rejects(readCapturedOwnedSnapshot(input), { code: 'capture_snapshot_receipt_mismatch' })
  } finally { await own.dispose() }
})

test('refuses retained lock and corrupted frozen bytes without rewriting receipt', async () => {
  const own = await fixture()
  try {
    const captured = await captureOwnedSnapshot(own.input, { runner: own.runner })
    const input = { scope: own.input.scope, handle: own.input.handle, receiptId: captured.receiptId, expectedReceiptHash: captured.receiptHash, config: { stateRoot: own.input.config.stateRoot } }
    const receiptFile = path.join(own.statePath, 'snapshot-receipts', `${captured.receiptId}.json`)
    const before = await fs.readFile(receiptFile)
    await fs.writeFile(path.join(own.statePath, 'snapshots', captured.snapshotId, 'database.sqlite'), 'corrupt')
    await assert.rejects(readCapturedOwnedSnapshot(input), { code: 'snapshot_reader_hash_mismatch' })
    assert.deepEqual(await fs.readFile(receiptFile), before)
    await fs.mkdir(path.join(own.statePath, 'operation.lock'))
    await assert.rejects(captureOwnedSnapshot(own.input, { runner: own.runner }), { code: 'site_busy_or_reconciliation_required' })
  } finally { await own.dispose() }
})

test('rejects receipt symlinks, hardlinks and public permissions', async () => {
  const own = await fixture()
  try {
    const captured = await captureOwnedSnapshot(own.input, { runner: own.runner })
    const input = { scope: own.input.scope, handle: own.input.handle, receiptId: captured.receiptId, expectedReceiptHash: captured.receiptHash, config: { stateRoot: own.input.config.stateRoot } }
    const filename = path.join(own.statePath, 'snapshot-receipts', `${captured.receiptId}.json`)
    const bytes = await fs.readFile(filename)
    const hardlink = path.join(own.directory, 'receipt-copy.json')
    await fs.link(filename, hardlink)
    await assert.rejects(readCapturedOwnedSnapshot(input), { code: 'capture_snapshot_receipt_unsafe' })
    await fs.unlink(hardlink)
    await fs.chmod(filename, 0o644)
    await assert.rejects(readCapturedOwnedSnapshot(input), { code: 'capture_snapshot_receipt_unsafe' })
    await fs.unlink(filename)
    await fs.writeFile(hardlink, bytes, { mode: 0o600 })
    await fs.symlink(hardlink, filename)
    await assert.rejects(readCapturedOwnedSnapshot(input), { code: 'capture_snapshot_read_failed' })
  } finally { await own.dispose() }
})

test('receipt write failure retains reconciliation lock after restoring the original running state', async () => {
  const own = await fixture(true)
  try {
    await fs.writeFile(path.join(own.statePath, 'snapshot-receipts'), 'blocked', { mode: 0o600 })
    await assert.rejects(captureOwnedSnapshot(own.input, { runner: own.runner }), { code: 'capture_snapshot_failed' })
    assert.equal(own.running(), true)
    assert.ok((await fs.stat(path.join(own.statePath, 'operation.lock'))).isDirectory())
  } finally { await own.dispose() }
})
