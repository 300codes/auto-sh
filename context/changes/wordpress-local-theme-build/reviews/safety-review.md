# Independent local theme builder safety review

Date: 2026-09-19. Scope: `theme-build.ts`, its tests, current plan and existing ownership/path/runner helpers. Reviewer authored the separately reviewed token mapper, not this builder; this report assesses builder safety and integration boundaries only.

## Verdict

PASS for the bounded local compilation primitive. No open blocker after removal of temporary diagnostic output. This does not certify theme enqueue, rendered frontend/editor behavior, approved design, full WP-01 acceptance, or Preview publication.

Reviewed source SHA-256 `f9c133a0aaca95a173108ebc10f7ca942ae5317e3e6b215cdfa45c5da9ae0bf2`; test SHA-256 `c53eaf35a077dd3b9194f06008573505dd0a4bc486499a6bfc114e1d92ec5f06`.

## Verified boundaries

- Strict scoped input and the existing owned Studio registration are checked before work and under the operation lock. Theme slug derives from the validated ownership record. Failure under lock retains reconciliation state rather than allowing blind retry.
- Source collection rejects symlinks/nonregular entries, bounds depth/count/file bytes/aggregate bytes and validates UTF-8. Only frozen PHP/HTML/JS content is scanned. PHP and JavaScript source are never evaluated. `.git`, `node_modules` and generated CSS output are excluded.
- The fixed worker executes the current Node executable and own module without a shell, with a timeout, output cap and 256 MiB JS heap cap. Inherited Node loader options/path are cleared. Compiler dependencies are trusted local code pinned to the declared versions; entry hashes are evidence, not a complete dependency attestation or sandbox for hostile toolchains.
- CSS input comprises the trusted default Tailwind theme and validated mapper output. External stylesheet/module loader callbacks reject requests. No theme-supplied import/config/plugin is loaded, and build-time dependency installation or network fetch is absent.
- Output is limited to `assets/dist/tailwind.css`, with containment checks and atomic temporary-file replacement. Existing source/custom CSS, theme.json and DB remain unchanged. Previous CSS survives compiler failure. The caller must continue excluding external filesystem writers, as with the existing ownership tools.
- Reports preserve fixture provenance when a fake runner, fixture-owned site or fixture design is used. Real local compiler execution does not imply live site integration. Enqueue/editor/Preview explicitly remain unexecuted. Errors expose allowlisted codes, not compiler output, source text or machine paths.
- The standalone caller gives the primitive a real local operator entry point. It does not upload, install or build remotely. Actual frontend/editor enqueue remains a separately documented gate before a verified snapshot can be published.

## Closed finding and verification

A preliminary development version printed raw worker error/stdout/stderr. The author removed that diagnostic before freeze; final source emits only the safe failure code. No raw diagnostic output remains in the reviewed worker failure path.

Final re-review also confirms the decoder preserves a UTF-8 BOM (`ignoreBOM: true`) while rejecting malformed bytes, with a regression comparing reported source hash against the raw file bytes. This prevents source evidence from silently hashing BOM-stripped text. The verdict remains PASS.

The reviewer inspected tests for real compiler output/repeat hashes, all three scanned source extensions, mapper integration, preservation of theme/custom CSS/content surrogate, foreign scope/registration, symlink input/output, oversized or malformed input and failure preserving previous CSS. The owner reports 11 focused tests passed outside the restricted subprocess sandbox. This reviewer did not start a concurrent compiler; package/root execution evidence remains separately owned. `git diff --check` passed for both reviewed paths.
