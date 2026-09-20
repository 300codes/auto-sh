const mockCreateAttachment = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }),
}))
jest.mock('@open-mercato/core/modules/attachments/lib/createFromBuffer', () => ({
  createAttachmentFromBuffer: (...args: unknown[]) => mockCreateAttachment(...args),
}))

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { stageRenderDir, storeStageRenders } from '../stageRenders'
import { figmaDesignResultSchema } from '../designAgent'

const projectId = '44444444-4444-4444-8444-444444444444'
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('render bytes')])

const design = figmaDesignResultSchema.parse({
  fileKey: 'xfae98HrQrrmbj7OcEiMsl',
  fileUrl: 'https://www.figma.com/design/xfae98HrQrrmbj7OcEiMsl',
  summary: 'Kierunek wizualny',
  notes: 'Nagłówek',
  nodes: [
    { nodeId: '4:2', name: 'Kierunek wizualny', width: 1440, height: 1320 },
    { nodeId: '4:7', name: 'Strona główna / Hero', width: 1440, height: 1024 },
  ],
})

async function renderDirWith(files: Record<string, Buffer>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'stage-renders-'))
  await mkdir(directory, { recursive: true })
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(directory, name), bytes)
  return directory
}

function runWith(directory: string) {
  return storeStageRenders({ em: {} as never, design, projectId, stageId: 'key_visual', scope, renderDir: directory })
}

beforeEach(() => {
  jest.resetAllMocks()
  mockCreateAttachment.mockImplementation(async () => ({ id: '55555555-5555-4555-8555-555555555555', fileName: 'render.png', mimeType: 'image/png', fileSize: png.byteLength, url: '/x' }))
})

describe('storing stage renders', () => {
  it('names the render after the node so the agent and the server agree on the file', () => {
    expect(stageRenderDir(projectId, 'key_visual')).toContain(join('delivery-figma-renders', projectId, 'key_visual'))
  })

  it('stores one render per frame and hashes the bytes it stored', async () => {
    const directory = await renderDirWith({ '4-2.png': png, '4-7.png': png })
    const screens = await runWith(directory)
    expect(screens).toHaveLength(2)
    expect(screens[0]).toMatchObject({
      fileKey: design.fileKey,
      nodeId: '4:2',
      viewport: { width: 1440, height: 1320 },
      sha256: createHash('sha256').update(png).digest('hex'),
      mimeType: 'image/png',
    })
    expect(mockCreateAttachment).toHaveBeenCalledTimes(2)
    expect(mockCreateAttachment.mock.calls[0][0]).toMatchObject({ entityId: 'delivery_os:project', recordId: projectId, mimeType: 'image/png' })
  })

  it('skips a frame whose render the agent never wrote instead of faking a screen', async () => {
    const directory = await renderDirWith({ '4-7.png': png })
    const screens = await runWith(directory)
    expect(screens.map((screen) => screen.nodeId)).toEqual(['4:7'])
  })

  it('refuses bytes that are not a PNG, whatever the file is called', async () => {
    const directory = await renderDirWith({ '4-2.png': Buffer.from('<html>not a render</html>'), '4-7.png': png })
    const screens = await runWith(directory)
    expect(screens.map((screen) => screen.nodeId)).toEqual(['4:7'])
    expect(mockCreateAttachment).toHaveBeenCalledTimes(1)
  })

  it('claims no screen at all when the agent wrote no render', async () => {
    const directory = await renderDirWith({})
    const screens = await runWith(directory)
    expect(screens).toEqual([])
    expect(mockCreateAttachment).not.toHaveBeenCalled()
  })

  it('is unused by the caller when the attachment store refuses the bytes', async () => {
    mockCreateAttachment.mockRejectedValueOnce(new Error('[internal] partition missing'))
    const directory = await renderDirWith({ '4-2.png': png, '4-7.png': png })
    await expect(runWith(directory)).rejects.toThrow()
  })
})
