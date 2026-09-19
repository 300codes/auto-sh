const { readdirSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = join(directory, entry.name)
    return entry.isDirectory() ? collect(filename) : filename.endsWith('.php') ? [filename] : []
  })
}
const files = collect('theme').sort()
if (!files.includes('theme/functions.php')) throw new Error('Frozen theme has no functions.php')
let failed = false
for (const filename of files) {
  const result = spawnSync('php', ['-l', filename], { encoding: 'utf8', timeout: 10000 })
  console.log(JSON.stringify({ file: filename, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }))
  if (result.status !== 0 || result.error) failed = true
}
if (failed) process.exitCode = 1
