const { test, expect } = require('@playwright/test')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

test('WP frozen AC-001: paragraph contains the attempt marker', () => {
  const marker = process.env.OM_WP_FROZEN_MARKER
  expect(marker).toMatch(/^wp-roundtrip-[a-f0-9-]+-[12]$/)
  const template = readFileSync('theme/templates/front-page.html', 'utf8')
  expect(template).toContain(`<!-- wp:paragraph --><p>${marker}</p><!-- /wp:paragraph -->`)
})

test('WP frozen AC-002: all captured PHP files have valid syntax', () => {
  function collect(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const filename = join(directory, entry.name)
      return entry.isDirectory() ? collect(filename) : filename.endsWith('.php') ? [filename] : []
    })
  }
  const files = collect('theme').sort()
  expect(files).toContain('theme/functions.php')
  for (const filename of files) execFileSync('php', ['-l', filename], { encoding: 'utf8', timeout: 10000 })
})
