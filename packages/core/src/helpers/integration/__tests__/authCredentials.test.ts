import { readFileSync } from 'fs'

jest.mock('fs', () => ({ readFileSync: jest.fn() }))

const mockReadFileSync = jest.mocked(readFileSync)
const credentialKeys = ['SUPERADMIN', 'ADMIN', 'EMPLOYEE'].flatMap((role) => [
  `OM_INIT_${role}_EMAIL`, `OM_INIT_${role}_PASSWORD`,
])
const originalValues = new Map(credentialKeys.map((key) => [key, process.env[key]]))

function readCredentials(): typeof import('../auth').DEFAULT_CREDENTIALS {
  let credentials: typeof import('../auth').DEFAULT_CREDENTIALS = {}
  jest.isolateModules(() => {
    credentials = (jest.requireActual('../auth') as typeof import('../auth')).DEFAULT_CREDENTIALS
  })
  return credentials
}

beforeEach(() => {
  for (const key of credentialKeys) delete process.env[key]
  mockReadFileSync.mockReset()
  mockReadFileSync.mockImplementation(() => { throw new Error('[internal] fixture env absent') })
})

afterEach(() => {
  for (const [key, value] of originalValues) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('integration default credentials', () => {
  it('uses initialized role credentials from the process environment without reading files', () => {
    for (const role of ['superadmin', 'admin', 'employee']) {
      process.env[`OM_INIT_${role.toUpperCase()}_EMAIL`] = `${role}@fixture.invalid`
      process.env[`OM_INIT_${role.toUpperCase()}_PASSWORD`] = `fixture-${role}-password`
    }
    const credentials = readCredentials()
    for (const role of ['superadmin', 'admin', 'employee']) {
      expect(credentials[role]).toEqual({ email: `${role}@fixture.invalid`, password: `fixture-${role}-password` })
    }
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('falls back to initialized credentials in the mocked env file', () => {
    mockReadFileSync.mockReturnValue([
      'OM_INIT_ADMIN_EMAIL=file-admin@fixture.invalid',
      'OM_INIT_ADMIN_PASSWORD=fixture-admin-password',
      'OM_INIT_EMPLOYEE_EMAIL=file-employee@fixture.invalid',
      'OM_INIT_EMPLOYEE_PASSWORD=fixture-employee-password',
    ].join('\n'))
    expect(readCredentials()).toMatchObject({
      admin: { email: 'file-admin@fixture.invalid', password: 'fixture-admin-password' },
      employee: { email: 'file-employee@fixture.invalid', password: 'fixture-employee-password' },
    })
  })

  it('preserves default credentials when no initialization values exist', () => {
    expect(readCredentials()).toEqual({
      superadmin: { email: 'superadmin@acme.com', password: 'secret' },
      admin: { email: 'admin@acme.com', password: 'secret' },
      employee: { email: 'employee@acme.com', password: 'secret' },
    })
  })
})
