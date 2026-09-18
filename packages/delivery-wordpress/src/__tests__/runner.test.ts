import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCommandRunner, parseStudioJson } from '../runner.ts'

test('runner preserves literal arguments, bounds processes and redacts failures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'studio-runner-'))
  const originalPath = process.env.PATH
  try {
    await writeFile(path.join(directory, 'studio'), `#!${process.execPath}\nconst operation = process.argv[2];
if (operation === 'fail') { process.stderr.write('PRIVATE_TOKEN'); process.exit(2); }
else if (operation === 'large') { process.stdout.write('PRIVATE_TOKEN'.repeat(10000)); }
else if (operation === 'wait') { setTimeout(() => {}, 30000); }
else { process.stdout.write(JSON.stringify(process.argv.slice(2))); }
`, { mode: 0o700 })
    process.env.PATH = `${directory}${path.delimiter}${originalPath ?? ''}`
    const runner = createCommandRunner({ timeoutMs: 2_000, maxBufferBytes: 4096 })
    const literal = '$(touch forbidden); `whoami` $HOME'
    assert.deepEqual(JSON.parse((await runner('studio', [literal])).stdout), [literal])
    for (const operation of ['fail', 'large', 'wait']) {
      await assert.rejects(runner('studio', [operation], { timeoutMs: operation === 'wait' ? 100 : 2_000 }), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /^\[internal\] COMMAND_/)
        assert.ok(!JSON.stringify(error).includes('PRIVATE_TOKEN'))
        assert.ok(!('cause' in error))
        assert.ok(!('stdout' in error))
        assert.ok(!('stderr' in error))
        return true
      })
    }
    await assert.rejects(runner('studio', ['bad\0argument']), /INVALID_COMMAND/)
    assert.throws(() => runner('studio', [], { timeoutMs: 2_001 }), /INVALID_RUNNER_LIMIT/)
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    await rm(directory, { recursive: true, force: true })
  }
})

test('runner rejects unbounded configuration', () => {
  for (const timeoutMs of [0, -1, Infinity, 600_001, 1.5]) assert.throws(() => createCommandRunner({ timeoutMs }), /INVALID_RUNNER_LIMIT/)
  assert.throws(() => createCommandRunner({ maxBufferBytes: 4_194_305 }), /INVALID_RUNNER_LIMIT/)
})

test('Studio JSON accepts complete structured output after a banner only', () => {
  assert.deepEqual(parseStudioJson('Update available\n[warning]\n {"running":true}\n'), { running: true })
  assert.deepEqual(parseStudioJson('Banner\n[\n{"id":"site"}\n]\n'), [{ id: 'site' }])
  for (const output of ['null', 'true', '{"ok":true}\ntrailer', '{"broken":', 'banner', 'x'.repeat(4_194_305)]) {
    assert.throws(() => parseStudioJson(output), /INVALID_STUDIO_JSON/)
  }
})
