import { buildDeliveryError, type DeliveryCheckResult, type DeliveryErrorDetail } from './contracts'
import type { TargetProfile } from './targetProfiles'

export const ALLOWED_PATH_DIRECTORY_SUFFIX = '/**'
export const MAX_ALLOWED_PATH_LENGTH = 512

export type AllowedPathIssueCode =
  | 'empty_path'
  | 'too_long'
  | 'control_character'
  | 'unsupported_character'
  | 'surrounding_whitespace'
  | 'backslash'
  | 'home_path'
  | 'drive_letter'
  | 'absolute_path'
  | 'parent_segment'
  | 'invalid_segment'
  | 'unsupported_glob'
  | 'outside_profile_roots'
  | 'duplicate_path'

export type AllowedPathIssue = { index: number; path: string; code: AllowedPathIssueCode }

const ISSUE_MESSAGES: Record<AllowedPathIssueCode, string> = {
  empty_path: 'Path must be a non-empty string',
  too_long: `Path must be at most ${MAX_ALLOWED_PATH_LENGTH} characters`,
  control_character: 'Path must not contain control characters',
  unsupported_character: 'Path must not contain invisible formatting characters or start with a pathspec colon',
  surrounding_whitespace: 'Path must not start or end with whitespace',
  backslash: 'Use forward slashes; backslashes are not allowed',
  home_path: 'Paths starting with ~ are not repository-relative',
  drive_letter: 'Drive letters are not repository-relative',
  absolute_path: 'Path must be repository-relative, not absolute',
  parent_segment: 'Parent segments (..) are not allowed',
  invalid_segment: 'Empty or "." segments are not allowed',
  unsupported_glob: 'Only an exact file path or a directory followed by /** is allowed (no *, ?, braces or leading !)',
  outside_profile_roots: 'Path is outside the target profile roots',
  duplicate_path: 'Duplicate path',
}

type ParsedAllowedPath = { kind: 'file'; path: string } | { kind: 'directory'; directory: string }

function shapeIssue(value: unknown): AllowedPathIssueCode | null {
  if (typeof value !== 'string' || value.length === 0) return 'empty_path'
  if (value.length > MAX_ALLOWED_PATH_LENGTH) return 'too_long'
  if (/[\x00-\x1f\x7f]/.test(value)) return 'control_character'
  if (/\p{Cf}/u.test(value) || value.startsWith(':')) return 'unsupported_character'
  if (value !== value.trim()) return 'surrounding_whitespace'
  if (value.includes('\\')) return 'backslash'
  if (value.startsWith('~')) return 'home_path'
  if (/^[A-Za-z]:/.test(value)) return 'drive_letter'
  if (value.startsWith('/')) return 'absolute_path'
  const segments = value.split('/')
  if (segments.some((segment) => segment === '..')) return 'parent_segment'
  if (segments.some((segment) => segment === '' || segment === '.')) return 'invalid_segment'
  return null
}

function hasGlob(value: string): boolean {
  return /[*?{}]/.test(value) || value.startsWith('!')
}

function parseAllowedPath(value: unknown): { ok: true; parsed: ParsedAllowedPath } | { ok: false; code: AllowedPathIssueCode } {
  const issue = shapeIssue(value)
  if (issue) return { ok: false, code: issue }
  const path = value as string
  if (path === '**') return { ok: false, code: 'outside_profile_roots' }
  if (path.endsWith(ALLOWED_PATH_DIRECTORY_SUFFIX)) {
    const directory = path.slice(0, -ALLOWED_PATH_DIRECTORY_SUFFIX.length)
    if (hasGlob(directory)) return { ok: false, code: 'unsupported_glob' }
    return { ok: true, parsed: { kind: 'directory', directory } }
  }
  if (hasGlob(path)) return { ok: false, code: 'unsupported_glob' }
  return { ok: true, parsed: { kind: 'file', path } }
}

function isUnder(path: string, directory: string): boolean {
  return path.startsWith(`${directory}/`)
}

function isWithinRoot(entry: ParsedAllowedPath, root: string): boolean {
  const parsedRoot = parseAllowedPath(root)
  if (!parsedRoot.ok) return false
  const rootPath = parsedRoot.parsed
  if (rootPath.kind === 'file') return entry.kind === 'file' && entry.path === rootPath.path
  if (entry.kind === 'file') return isUnder(entry.path, rootPath.directory)
  return entry.directory === rootPath.directory || isUnder(entry.directory, rootPath.directory)
}

export function collectAllowedPathIssues(paths: readonly unknown[], profile: TargetProfile): AllowedPathIssue[] {
  const issues: AllowedPathIssue[] = []
  const seen = new Set<string>()
  paths.forEach((value, index) => {
    const path = typeof value === 'string' ? value : ''
    const parsed = parseAllowedPath(value)
    if (!parsed.ok) {
      issues.push({ index, path, code: parsed.code })
    } else if (!profile.allowedPathRoots.some((root) => isWithinRoot(parsed.parsed, root))) {
      issues.push({ index, path, code: 'outside_profile_roots' })
    } else if (seen.has(path)) {
      issues.push({ index, path, code: 'duplicate_path' })
    }
    seen.add(path)
  })
  return issues
}

export function describeAllowedPathIssue(issue: AllowedPathIssue, pathPrefix = '', profile?: TargetProfile): DeliveryErrorDetail {
  const message =
    issue.code === 'outside_profile_roots' && profile
      ? `Path is outside the ${profile.id}@${profile.version} roots (${profile.allowedPathRoots.join(', ')})`
      : ISSUE_MESSAGES[issue.code]
  return { path: `${pathPrefix}${issue.index}`, code: issue.code, message }
}

export function validateAllowedPaths(paths: readonly unknown[], profile: TargetProfile, pathPrefix = ''): DeliveryCheckResult {
  const issues = collectAllowedPathIssues(paths, profile)
  if (issues.length === 0) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError(
      'path_not_allowed',
      'Path is not allowed for the target profile',
      issues.map((issue) => describeAllowedPathIssue(issue, pathPrefix, profile)),
    ),
  }
}

export function isPathAllowed(changedPath: string, allowedPaths: readonly string[]): boolean {
  if (shapeIssue(changedPath) || hasGlob(changedPath)) return false
  return allowedPaths.some((entry) => {
    const parsed = parseAllowedPath(entry)
    if (!parsed.ok) return false
    return parsed.parsed.kind === 'file' ? changedPath === parsed.parsed.path : isUnder(changedPath, parsed.parsed.directory)
  })
}
