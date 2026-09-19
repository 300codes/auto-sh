import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import test from 'node:test'
import { prepareOwnedPreviewJournal, readOwnedPreviewJournal, reconcileOwnedPreviewJournal } from '../preview-journal.ts'
import { savedDeploymentFixture } from './fixtures/saved-deployment.ts'
import type { CommandRunner } from '../runner.ts'

async function fixture() {
  const context = await savedDeploymentFixture()
  const commands: string[][] = []
  let entries: Array<{ localSiteId: string; url: string; date: number }> = []
  const runner: CommandRunner = async (executable, args) => {
    assert.equal(executable, 'studio')
    commands.push([...args])
    if (args[0] === '--version') return { stdout: '1.19.0', exitCode: 0 }
    if (args[0] === 'auth') return { stdout: 'PRIVATE_ACCOUNT', exitCode: 0 }
    if (args[0] === 'preview') return { stdout: JSON.stringify(entries), exitCode: 0 }
    assert.deepEqual(args, ['site', 'list', '--format', 'json'])
    return { stdout: JSON.stringify([{ id: 'fixture-studio', path: context.sitePath, running: false }]), exitCode: 0 }
  }
  const prepared = await prepareOwnedPreviewJournal({ ...context.input, targetHost: null })
  const filename = path.join(context.statePath, `preview-${context.input.packageId}.json`)
  const persistHostIntent = async (state: 'uploading' | 'verified' = 'uploading', host: string | null = null) => {
    const { journalHash, ...prior } = prepared.journal
    const content = { ...prior, revision: prior.revision + 1, previousHash: journalHash, publication: { ...prior.publication, state, host } }
    const updated = { ...content, journalHash: createHash('sha256').update(JSON.stringify(content)).digest('hex') }
    await fs.writeFile(filename, JSON.stringify(updated))
    return updated
  }
  return { ...context, prepared, filename, commands, runner, persistHostIntent,
    listing: (values: typeof entries) => { entries = values } }
}

test('durable preparation is private, identity-bound and replay never resets journal state', async () => {
  const context = await fixture()
  try {
    assert.equal((await fs.stat(context.filename)).mode & 0o077, 0)
    assert.deepEqual((await prepareOwnedPreviewJournal({ ...context.input, targetHost: null })).journal, context.prepared.journal)
    await context.persistHostIntent()
    const read = await readOwnedPreviewJournal(context.input)
    assert.equal(read.effectiveState, 'uncertain')
    assert.equal(read.publication, 'not_authorized')
    const replay = await prepareOwnedPreviewJournal({ ...context.input, targetHost: null })
    assert.equal(replay.journal.publication.state, 'uploading')
    assert.equal(replay.journal.revision, 2)
    assert.equal(context.commands.length, 0)
  } finally { await context.dispose() }
})

test('crash lock prevents reconciliation until operator recovery; absence cannot reset uncertain state', async () => {
  const context = await fixture()
  try {
    const intent = await context.persistHostIntent()
    const lock = path.join(context.statePath, 'operation.lock')
    await fs.mkdir(lock, { mode: 0o700 })
    const input = { ...context.input, expectedJournalHash: intent.journalHash }
    await assert.rejects(reconcileOwnedPreviewJournal(input, { runner: context.runner }), /site_busy/)
    assert.equal(context.commands.length, 0)
    await fs.rmdir(lock)
    const result = await reconcileOwnedPreviewJournal(input, { runner: context.runner })
    assert.equal(result.journal.publication.state, 'uncertain')
    assert.equal(result.journal.observation?.binding, 'absent')
    assert.equal(result.journal.previousHash, intent.journalHash)
    const replay = await reconcileOwnedPreviewJournal({ ...context.input, expectedJournalHash: result.journal.journalHash }, { runner: context.runner })
    assert.deepEqual(replay.journal, result.journal)
    assert.ok(context.commands.every((args) => !args.includes('create') && !args.includes('update')))
  } finally { await context.dispose() }
})

test('read-only observation never verifies or adopts an unrelated account Preview', async () => {
  const context = await fixture()
  try {
    const intent = await context.persistHostIntent()
    context.listing([{ localSiteId: 'other-site', url: 'https://foreign.wp.build', date: Date.now() }, { localSiteId: 'fixture-studio', url: 'https://own.wp.build', date: Date.now() }])
    const result = await reconcileOwnedPreviewJournal({ ...context.input, expectedJournalHash: intent.journalHash }, { runner: context.runner })
    assert.equal(result.journal.publication.host, 'own.wp.build')
    assert.equal(result.journal.publication.state, 'uploaded_unverified')
    assert.equal(result.remoteRevision, 'not_verified')
    assert.equal(result.upload, 'not_run')
    assert.ok(!JSON.stringify(result).includes('PRIVATE_ACCOUNT'))
    assert.ok(context.commands.every((args) => !args.includes('create') && !args.includes('update')))
  } finally { await context.dispose() }
})

test('prepared candidate records inventory without treating a pre-existing host as its upload', async () => {
  const context = await fixture()
  try {
    context.listing([{ localSiteId: 'fixture-studio', url: 'https://own.wp.build', date: Date.now() }])
    const result = await reconcileOwnedPreviewJournal({ ...context.input, expectedJournalHash: context.prepared.journal.journalHash }, { runner: context.runner })
    assert.equal(result.journal.publication.state, 'prepared')
    assert.equal(result.journal.publication.host, null)
    assert.equal(result.journal.observation?.host, 'own.wp.build')
  } finally { await context.dispose() }
})

test('expired inventory cannot establish an uploaded revision', async () => {
  const context = await fixture()
  try {
    const intent = await context.persistHostIntent()
    context.listing([{ localSiteId: 'fixture-studio', url: 'https://own.wp.build', date: Date.now() - 8 * 86400_000 }])
    const result = await reconcileOwnedPreviewJournal({ ...context.input, expectedJournalHash: intent.journalHash }, { runner: context.runner })
    assert.equal(result.journal.publication.state, 'uncertain')
    assert.equal(result.journal.observation?.expired, true)
  } finally { await context.dispose() }
})

for (const mode of ['stale', 'foreign-scope', 'wrong-package', 'tampered-journal', 'changed-package', 'verified'] as const) {
  test(`journal refuses ${mode} without publishing`, async () => {
    const context = await fixture()
    try {
      let input = { ...context.input, expectedJournalHash: context.prepared.journal.journalHash }
      if (mode === 'stale') input.expectedJournalHash = '0'.repeat(64)
      if (mode === 'foreign-scope') input.scope = { ...input.scope, tenantId: randomUUID() }
      if (mode === 'wrong-package') input.expectedPackageHash = '0'.repeat(64)
      if (mode === 'tampered-journal') await fs.writeFile(context.filename, JSON.stringify({ ...context.prepared.journal, revision: 99 }))
      if (mode === 'changed-package') await fs.writeFile(path.join(context.packageDirectory, 'site/wp-content/uploads/image.png'), 'changed')
      if (mode === 'verified') input.expectedJournalHash = (await context.persistHostIntent('verified', 'own.wp.build')).journalHash
      await assert.rejects(reconcileOwnedPreviewJournal(input, { runner: context.runner }))
      assert.equal(context.commands.length, 0)
    } finally { await context.dispose() }
  })
}

test('atomic journal write failure leaves a lock and no resettable partial journal', async () => {
  const context = await savedDeploymentFixture()
  const original = fs.link
  try {
    fs.link = async () => { throw new Error('PRIVATE_WRITE_FAILURE') }
    await assert.rejects(prepareOwnedPreviewJournal({ ...context.input, targetHost: null }), /preview_journal_failed/)
    assert.ok((await fs.stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
    assert.ok(!(await fs.readdir(context.statePath)).some((filename) => filename.endsWith('.tmp')))
    await assert.rejects(readOwnedPreviewJournal(context.input), /preview_journal_missing/)
  } finally { fs.link = original; await context.dispose() }
})
