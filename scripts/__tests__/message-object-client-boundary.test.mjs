import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript-js'
import webpackModule from 'next/dist/compiled/webpack/webpack.js'

const { webpack } = webpackModule
const require = createRequire(import.meta.url)
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const modulePaths = Object.fromEntries(['catalog', 'currencies', 'customers', 'inbox_ops', 'resources', 'sales', 'staff'].map((id) => [id, `packages/core/src/modules/${id}/message-objects.ts`]))
modulePaths.example = 'apps/mercato/src/modules/example/message-objects.ts'
modulePaths.template = 'packages/create-app/template/src/modules/example/message-objects.ts'
const moduleIds = Object.keys(modulePaths)

async function prepareDefinitions(directory) {
  const entries = {}
  for (const moduleId of moduleIds) {
    const source = await readFile(path.join(repositoryRoot, modulePaths[moduleId]), 'utf8')
    const parsed = ts.createSourceFile('message-objects.ts', source, ts.ScriptTarget.Latest, true)
    const declarations = []
    const statements = []
    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement)) {
        statements.push(statement.getText(parsed))
        continue
      }
      const clause = statement.importClause
      if (!clause || clause.isTypeOnly) continue
      if (clause.name) declarations.push(`const ${clause.name.text} = () => null`)
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const imported of clause.namedBindings.elements) {
          if (!imported.isTypeOnly) declarations.push(`const ${imported.name.text} = () => null`)
        }
      }
    }
    const compiled = ts.transpileModule([...declarations, ...statements].join('\n'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const moduleDirectory = path.join(directory, moduleId)
    await mkdir(path.join(moduleDirectory, 'lib'), { recursive: true })
    const entry = path.join(moduleDirectory, 'message-objects.js')
    await writeFile(entry, compiled)
    const loaderNames = [...new Set(source.match(/load\w+Preview/g) ?? [])]
    const serverModule = [
      "import { existsSync } from 'node:fs'",
      ...loaderNames.map((name) => `export async function ${name}(entityId, ctx) { return { title: '${name}', subtitle: entityId, metadata: { tenantId: ctx.tenantId, serverLoaded: String(existsSync('.')) } } }`),
    ].join('\n')
    await writeFile(path.join(moduleDirectory, 'lib/messageObjectPreviews.js'), serverModule)
    entries[moduleId] = entry
  }
  return entries
}

async function compileDefinitions(directory, entries, target) {
  const compiler = webpack({
    mode: 'production',
    target,
    entry: entries,
    output: { path: path.join(directory, target), filename: '[name].cjs', chunkFilename: '[name].cjs', library: { type: 'commonjs2' } },
    optimization: { minimize: false },
    plugins: [new webpack.DefinePlugin({ 'typeof window': JSON.stringify(target === 'web' ? 'object' : 'undefined') })],
  })
  const stats = await new Promise((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close((closeError) => {
        if (error || closeError) reject(error || closeError)
        else resolve(result)
      })
    })
  })
  assert.ok(stats)
  assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true, errorDetails: true }))
  return stats
}

test('message object browser bundles exclude server loaders while preserving preview fallbacks', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'message-object-browser-'))
  try {
    const entries = await prepareDefinitions(directory)
    const stats = await compileDefinitions(directory, entries, 'web')
    const resources = [...stats.compilation.modules].map((module) => module.resource).filter(Boolean)
    assert.equal(resources.some((resource) => resource.endsWith('messageObjectPreviews.js')), false)
    let checked = 0
    for (const moduleId of moduleIds) {
      const { messageObjectTypes } = require(path.join(directory, 'web', `${moduleId}.cjs`))
      for (const definition of messageObjectTypes) {
        const preview = await definition.loadPreview('entity-fixture', { tenantId: 'tenant-fixture' })
        assert.equal(preview.subtitle, 'entity-fixture')
        assert.ok(preview.title)
        assert.equal(preview.metadata?.serverLoaded, undefined)
        checked += 1
      }
    }
    assert.equal(checked, 19)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('message object server bundles retain preview loaders and forward entity and tenant context', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'message-object-server-'))
  try {
    const entries = await prepareDefinitions(directory)
    const stats = await compileDefinitions(directory, entries, 'node')
    const resources = [...stats.compilation.modules].map((module) => module.resource).filter(Boolean)
    assert.equal(resources.filter((resource) => resource.endsWith('messageObjectPreviews.js')).length, moduleIds.length)
    let checked = 0
    for (const moduleId of moduleIds) {
      const { messageObjectTypes } = require(path.join(directory, 'node', `${moduleId}.cjs`))
      for (const definition of messageObjectTypes) {
        const preview = await definition.loadPreview('entity-fixture', { tenantId: 'tenant-fixture' })
        assert.equal(preview.subtitle, 'entity-fixture')
        assert.match(preview.title, /^load\w+Preview$/)
        assert.equal(preview.metadata.tenantId, 'tenant-fixture')
        assert.equal(preview.metadata.serverLoaded, 'true')
        checked += 1
      }
    }
    assert.equal(checked, 19)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
