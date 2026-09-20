import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The renders the agent actually produced in Figma during the walkthrough this example reproduces. They ship as files
 * rather than as generated placeholders so the example shows the real output, and so every screen's sha256 is the
 * hash of bytes that exist — the same thing the baseline demands of a live run.
 */
export type ExampleAsset = {
  file: string
  stageId: 'key_visual' | 'design_system_ui'
  name: string
  nodeId: string
  width: number
  height: number
}

export const EXAMPLE_ASSETS: readonly ExampleAsset[] = [
  { file: 'key-visual-home-hero.png', stageId: 'key_visual', name: '02 — Strona główna / Hero', nodeId: '4:7', width: 1440, height: 1024 },
  { file: 'ds-tokens.png', stageId: 'design_system_ui', name: 'DS UI — 04 Tokeny i style', nodeId: '20:31', width: 1440, height: 1024 },
  { file: 'ds-components.png', stageId: 'design_system_ui', name: 'DS UI — 05 Komponenty i stany', nodeId: '23:19', width: 1440, height: 1024 },
  { file: 'ds-home-high-fidelity.png', stageId: 'design_system_ui', name: 'DS UI — 06 Strona główna / High fidelity', nodeId: '24:19', width: 1440, height: 1024 },
]

/** The Figma file the walkthrough was built in; the example keeps the reference it really came from. */
export const EXAMPLE_FIGMA_FILE_KEY = 'xfae98HrQrrmbj7OcEiMsl'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export async function readExampleAsset(asset: ExampleAsset): Promise<{ bytes: Buffer; sha256: string }> {
  const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'example-assets')
  const bytes = await readFile(path.join(directory, asset.file))
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`[internal] example asset ${asset.file} is not a PNG`)
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}
