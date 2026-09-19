import fs from 'node:fs'
import path from 'node:path'

export const MODULE_ROOT = path.resolve(__dirname, '..')

export const FORBIDDEN_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire(?:\.resolve)?\s*\(\s*|\bimport\s+)['"`](?:@open-mercato\/enterprise(?:\/|['"`])|(?:\.\.\/)+(?:packages\/)?enterprise\/|[^'"`]*delivery-cezar)/

export function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listSourceFiles(entryPath)
    return /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [entryPath] : []
  })
}

export function findEnterpriseImports(excludedFiles: readonly string[] = []): string[] {
  return listSourceFiles(MODULE_ROOT)
    .filter((filePath) => !excludedFiles.includes(filePath))
    .filter((filePath) => FORBIDDEN_IMPORT_PATTERN.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(MODULE_ROOT, filePath))
}
