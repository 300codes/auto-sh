import { deliveryErrorFromZod } from '../../lib/contracts'
import { loadPublicationResultFixture } from '../../lib/fixtures/flow/index'
import { publicationListQuerySchema, recordPublicationCommandInputSchema } from '../validators'

const OTHER_PROJECT_ID = '99999999-9999-4999-8999-999999999999'

describe('flow F4 publication validators', () => {
  it('accepts a publication bound to the path project', () => {
    const publication = loadPublicationResultFixture()
    const parsed = recordPublicationCommandInputSchema.safeParse({ projectId: publication.projectId, publication })
    expect(parsed.success).toBe(true)
  })

  it('accepts a publication whose projectId differs from the path project only in letter case', () => {
    const publication = loadPublicationResultFixture()
    const upper = recordPublicationCommandInputSchema.safeParse({ projectId: publication.projectId, publication: { ...publication, projectId: publication.projectId.toUpperCase() } })
    const lower = recordPublicationCommandInputSchema.safeParse({ projectId: publication.projectId.toUpperCase(), publication })
    expect(upper.success).toBe(true)
    expect(lower.success).toBe(true)
  })

  it('still rejects an uppercase id of another project with foreign_reference', () => {
    const publication = loadPublicationResultFixture()
    const parsed = recordPublicationCommandInputSchema.safeParse({ projectId: OTHER_PROJECT_ID, publication: { ...publication, projectId: publication.projectId.toUpperCase() } })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(deliveryErrorFromZod(parsed.error).body.code).toBe('foreign_reference')
  })

  it('rejects a publication for another project with foreign_reference', () => {
    const publication = loadPublicationResultFixture()
    const parsed = recordPublicationCommandInputSchema.safeParse({ projectId: OTHER_PROJECT_ID, publication })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(deliveryErrorFromZod(parsed.error).body.code).toBe('foreign_reference')
  })

  it('rejects a verified publication without evidence with deployment_unverified', () => {
    const publication = loadPublicationResultFixture()
    const forged = { ...publication, verification: { ...publication.verification, evidenceId: null } }
    const parsed = recordPublicationCommandInputSchema.safeParse({ projectId: publication.projectId, publication: forged })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(deliveryErrorFromZod(parsed.error).body.code).toBe('deployment_unverified')
  })

  it('rejects an unknown schema version', () => {
    const publication = { ...loadPublicationResultFixture(), schemaVersion: 'delivery.publication-result/v2' }
    const parsed = recordPublicationCommandInputSchema.safeParse({ projectId: publication.projectId, publication })
    expect(parsed.success).toBe(false)
  })

  it('defaults and caps the list query page size at 100', () => {
    expect(publicationListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50 })
    expect(publicationListQuerySchema.parse({ page: '2', pageSize: '100' })).toEqual({ page: 2, pageSize: 100 })
    expect(publicationListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false)
    expect(publicationListQuerySchema.safeParse({ page: '0' }).success).toBe(false)
  })
})
