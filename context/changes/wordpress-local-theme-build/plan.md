# Local WordPress theme build — bounded WP-01

## Objective and boundaries

Compile real Tailwind 4 locally from frozen PHP/HTML/JS theme sources, consuming the
validated WP-02 design mapper when supplied, and write only generated CSS into
`assets/dist/tailwind.css`. Preserve source/custom CSS, theme.json, Global Styles and DB.
No runtime CDN, theme JavaScript/config execution, network install at build time, remote
build, site publication, OM endpoints, dependency/export changes or createSite changes.
Full WP-01 remains pending actual theme enqueue/frontend/editor integration.

## Phase 1: Scoped local builder

Changes: `packages/delivery-wordpress/src/theme-build.ts` and standalone operator CLI
in the same file. Strict trusted scope/handle/config. Existing tools.status verifies site
ownership/registration before child work and again under its operation lock. Derive the
theme slug from ownership record. Reject symlinks, escaping paths, nonregular files,
oversized/count-excessive trees; exclude .git/node_modules and generated output.

Freeze bounded PHP/HTML/JS source bytes, compile only explicit default Tailwind theme
and validated mapper CSS (no arbitrary @plugin/@config/@import). Use real compiler and
oxide scanner from the existing trusted local toolchain. Run the fixed worker via
execFile(process.execPath, own module), no shell, with timeout and output cap. Hash exact
inputs/output and compiler/scanner artifacts/versions. Atomic replace only generated CSS;
leave previous output intact on failure. Retain uncertain operation lock, matching owner.

Success: deterministic real CSS includes utilities from all three source extensions;
foreign scope/registration and unsafe tree/output paths cause zero writes/child work;
errors expose safe codes only; reports distinguish fixture and live compilation.

## Phase 2: Meaningful tests, validation and review

Changes: `src/__tests__/theme-build.test.ts`, evidence/review under this change.
Tests use temporary owned fixture with fake Studio registration but real Tailwind child.
Cover repeat hash, PHP/HTML/JS candidates, generated token CSS, unchanged theme/DB inputs,
foreign scope, symlink input/output, compiler failure preserving previous output.
Run focused Node tests then package typecheck/build through current local toolchain.
Independent reviewer checks implementation and final source evidence.

Success: focused/package checks recorded, no unresolved implementation blockers.
No live Studio mutation or enqueue acceptance inferred from fixture compiler PASS.

## Toolchain and integration

Existing yarn.lock pins Tailwind/oxide 4.3.3. Read-only installed toolchain:
`/tmp/auto-sh-delivery-qa-4gb-n_yyd328` is the checkout root (config appends node_modules).
Its cached native oxide is musl-only, so local glibc validation uses a separate private
`/tmp/auto-sh-wp-tailwind-4.3.3` installation of the same locked compiler/scanner versions.
Builder's optional designTokens object calls `mapDesignTokens` directly; mapper approval
provenance does not verify a real design approval. Do not use `design-tokens.css` artifact
name: snapshot redaction excludes token-named files. Generated CSS path is snapshot-safe.
CLI is the real callsite; parent can invoke it locally before snapshot/Preview after
separate theme enqueue integration. Preview receives completed files only.

## Progress

### Phase 1
- [x] 1.1 Scoped bounded compiler and CLI implemented.
- [x] 1.2 Real mapper callsite preserves approval/fixture boundaries.
### Phase 2
- [x] 2.1 Focused real compiler tests and package checks pass.
- [x] 2.2 Independent review and evidence recorded.
- [ ] 2.3 Actual theme enqueue/live acceptance — outside this bounded primitive, pending parent integration.

## Verification evidence

[Final package gate](evidence/verification.json): 93/93 native package tests, typecheck/build
and compiled-worker smoke passed. Two independent reviews are under reviews/. Actual
theme enqueue, browser/editor checks and live WP-01 acceptance remain pending.
Conservative charge requested: 10 minutes; parent owns combined concurrent WP budget.
