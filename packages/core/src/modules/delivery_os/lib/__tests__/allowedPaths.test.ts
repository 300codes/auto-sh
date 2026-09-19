import {
  ALLOWED_PATH_DIRECTORY_SUFFIX,
  collectAllowedPathIssues,
  isPathAllowed,
  validateAllowedPaths,
  type AllowedPathIssueCode,
} from '../allowedPaths'
import { checkAllowedPathsForProfile, getTargetProfile, type TargetProfile } from '../targetProfiles'

function requireProfile(id: string, version: number): TargetProfile {
  const profile = getTargetProfile(id, version)
  if (!profile) throw new Error(`[internal] unknown profile ${id}@${version}`)
  return profile
}

const react = requireProfile('react-vite', 1)
const openMercato = requireProfile('open-mercato-module', 1)
const wordpress = requireProfile('wordpress-theme', 1)

function issueCodes(paths: readonly unknown[], profile: TargetProfile = react): AllowedPathIssueCode[] {
  return collectAllowedPathIssues(paths, profile).map((issue) => issue.code)
}

describe('validateAllowedPaths — each rule has a failing input and a passing twin', () => {
  it.each<[AllowedPathIssueCode, unknown, string]>([
    ['empty_path', '', 'src/App.tsx'],
    ['empty_path', 42, 'src/App.tsx'],
    ['too_long', `src/${'a'.repeat(600)}.ts`, `src/${'a'.repeat(400)}.ts`],
    ['control_character', 'src/App\u0000.tsx', 'src/App.tsx'],
    ['surrounding_whitespace', ' src/App.tsx', 'src/App.tsx'],
    ['unsupported_character', 'src/App\u202E.tsx', 'src/App.tsx'],
    ['unsupported_character', 'src/App\u200B.tsx', 'src/App.tsx'],
    ['unsupported_character', ':(top)src/**', 'src/**'],
    ['backslash', 'src\\App.tsx', 'src/App.tsx'],
    ['home_path', '~/src/App.tsx', 'src/App.tsx'],
    ['drive_letter', 'C:/src/App.tsx', 'src/App.tsx'],
    ['absolute_path', '/src/App.tsx', 'src/App.tsx'],
    ['absolute_path', '/etc/passwd', 'src/App.tsx'],
    ['parent_segment', 'src/../package.json', 'src/package.json'],
    ['parent_segment', '../outside/**', 'src/outside/**'],
    ['invalid_segment', 'src//App.tsx', 'src/App.tsx'],
    ['invalid_segment', './src/App.tsx', 'src/App.tsx'],
    ['invalid_segment', 'src/', 'src/**'],
    ['unsupported_glob', 'src/*.tsx', 'src/**'],
    ['unsupported_glob', 'src/**/App.tsx', 'src/App.tsx'],
    ['unsupported_glob', 'src/*/**', 'src/components/**'],
    ['unsupported_glob', 'src/App?.tsx', 'src/App.tsx'],
    ['unsupported_glob', 'src/{a,..}/x.ts', 'src/a/x.ts'],
    ['unsupported_glob', '!src/**', 'src/**'],
    ['outside_profile_roots', '**', 'src/**'],
    ['outside_profile_roots', 'package.json', 'index.html'],
    ['outside_profile_roots', '.github/workflows/**', 'tests/e2e/**'],
    ['outside_profile_roots', 'srcx/App.tsx', 'src/x/App.tsx'],
    ['outside_profile_roots', 'index.html/**', 'index.html'],
    ['outside_profile_roots', 'index.html.bak', 'index.html'],
  ])('%s: rejects %p, accepts %p', (code, rejected, accepted) => {
    expect(issueCodes([rejected])).toEqual([code])
    expect(issueCodes([accepted])).toEqual([])
    const result = validateAllowedPaths([accepted, rejected], react)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('path_not_allowed')
    expect(result.body.details).toEqual([expect.objectContaining({ path: '1', code })])
    expect(validateAllowedPaths([accepted], react)).toEqual({ ok: true })
  })

  it('duplicate_path: rejects a repeated entry and accepts two distinct ones', () => {
    expect(issueCodes(['src/**', 'tests/**', 'src/**'])).toEqual(['duplicate_path'])
    expect(collectAllowedPathIssues(['src/**', 'tests/**', 'src/**'], react)[0].index).toBe(2)
    expect(issueCodes(['src/**', 'tests/**'])).toEqual([])
  })

  it('reports every offending entry with its index and the prefix', () => {
    const result = validateAllowedPaths(['src/**', '/abs', 'package.json', 'src/**'], react, 'tasks.1.allowedPaths.')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.body.details.map((detail) => [detail.path, detail.code])).toEqual([
      ['tasks.1.allowedPaths.1', 'absolute_path'],
      ['tasks.1.allowedPaths.2', 'outside_profile_roots'],
      ['tasks.1.allowedPaths.3', 'duplicate_path'],
    ])
    expect(result.body.details[1].message).toContain('react-vite@1')
  })

  it('accepts an empty list (a task that may change nothing)', () => {
    expect(validateAllowedPaths([], react)).toEqual({ ok: true })
  })

  it('honours each profile root kind', () => {
    expect(issueCodes(['src/modules/delivery/**', 'src/modules/delivery/api/[id]/route.ts'], openMercato)).toEqual([])
    expect(issueCodes(['src/**'], openMercato)).toEqual(['outside_profile_roots'])
    expect(issueCodes(['src/modules/**'], openMercato)).toEqual([])
    expect(issueCodes(['style.css', 'templates/**', 'parts/header.html'], wordpress)).toEqual([])
    expect(issueCodes(['wp-config.php', 'style.css/**'], wordpress)).toEqual(['outside_profile_roots', 'outside_profile_roots'])
  })

  it('keeps checkAllowedPathsForProfile on the same rule (manual tasks)', () => {
    expect(checkAllowedPathsForProfile(react, ['src/**', 'index.html'])).toEqual({ ok: true })
    const result = checkAllowedPathsForProfile(react, ['src/**', 'src/*/x.ts'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.body.details).toEqual([expect.objectContaining({ path: '1', code: 'unsupported_glob' })])
  })
})

describe('isPathAllowed', () => {
  const allowed = ['src/**', 'index.html', `tests/e2e${ALLOWED_PATH_DIRECTORY_SUFFIX}`]

  it.each([
    ['src/App.tsx', true],
    ['src/components/deep/List.tsx', true],
    ['index.html', true],
    ['tests/e2e/smoke.spec.ts', true],
    ['tests/unit/a.test.ts', false],
    ['srcx/App.tsx', false],
    ['src', false],
    ['index.html.bak', false],
    ['package.json', false],
    ['src/../package.json', false],
    ['/src/App.tsx', false],
    ['src\\App.tsx', false],
    ['src/*.tsx', false],
    ['', false],
  ])('%s → %s', (changedPath, expected) => {
    expect(isPathAllowed(changedPath, allowed)).toBe(expected)
  })

  it('ignores malformed allowed entries instead of widening the scope', () => {
    expect(isPathAllowed('src/App.tsx', ['**', 'src/*', '../src/**'])).toBe(false)
    expect(isPathAllowed('src/App.tsx', ['**', 'src/*', 'src/App.tsx'])).toBe(true)
  })

  it('allows nothing for an empty list', () => {
    expect(isPathAllowed('src/App.tsx', [])).toBe(false)
  })
})
