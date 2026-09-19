# WP-02 — deterministic local token mapping

## Scope and references

Implement the independent fixture mapping required by `.ai/specs/2026-09-19-wordpress-studio-tools.md` and the design/WordPress requirements of `.ai/specs/2026-09-19-delivery-project-flow-addendum.md`. All build and verification happen locally before a future verified snapshot deployment to Preview. No actual Figma access, approval, Preview upload, remote build, existing-theme mutation, Global Styles write, or OM API is part of this change.

Only `packages/delivery-wordpress/src/design-tokens.ts`, its adjacent test, and this change folder are owned here. WP-01's separate `theme-build.ts` caller consumes the mapper in memory; that agent owns build integration. Existing public package exports, createSite v1, scaffold and demo-probe are unchanged. No dependency, database or module-discovery changes are needed.

## Phase 1: Strict mapper and local fixture proof

### Changes

- Implement internal `mapDesignTokens(unknown)` with a strict schemaVersion 1 export: provenance `fixture|operator_supplied`, source designRef/revision and declared approvalRef (required for operator-supplied), and bounded colors/fonts/fontSizes/spacing lists.
- Require safe unique token IDs across categories, safe labels, bounded hex colors, explicit font family lists and nonnegative bounded px/rem/em values. Reject unknown fields, CSS expressions/imports/URLs, path-like IDs, duplicates and unsupported versions.
- Sort IDs with ordinal ordering, emit consistent `design-<id>` slugs in WP settings and Tailwind v4 variables, and calculate hashes over canonical versioned input/output. Preserve semantics across reordered input and avoid time/random/runtime-dependent values.
- Emit `@theme inline` references to corresponding WordPress preset variables with validated fallbacks. Native Global Styles can override the presets. Return a settings fragment only; never silently merge/replace the client theme or database.
- Return `approvalVerification: not_evaluated`. A reference supplied by an operator is not an authenticated Figma approval. Synthetic exports remain fixture evidence.
- Use the mapper from the independently owned local theme builder. No CLI or additional writer is needed. If artifacts are later persisted, `design-system.css` is snapshot-safe; avoid secret-filtered `design-tokens.css` filenames.

### Verification

- Exact expected palette, font family, font size, spacing and CSS mapping on a committed fixture.
- Stable serialized artifacts and hashes for repeated or reordered equivalent inputs; hashes change with token/revision/approval-reference changes; no input mutation.
- Refuse malformed values, injection, paths, unknown fields, duplicate IDs, unsupported versions and absent required provenance/reference data.
- Focused native Node tests, package typecheck/build, and independent review. WP-01 owns real Tailwind compilation of mapper output and reports it separately.

## Risks and acceptance boundary

The mapper is deliberately a small supported subset, not a general Figma/DTCG parser. Unsupported tokens fail closed rather than silently disappear. Supplied source references are opaque local evidence identifiers and never fetched. Font assets/licensing/loading, layout widths, radii, component variants, actual approved export, applying a reviewed settings fragment, editor visual comparison and preserved edits across redeploy remain future gates. Font fallback array order is semantic and must not be sorted. A fixture PASS is not live WP-02 or full Figma design fidelity acceptance.

## Progress

### Phase 1: Strict mapper and local fixture proof

- [x] 1.1 Strict versioned mapper and pure deterministic outputs.
- [x] 1.2 Fixture and negative regression tests; focused tests/typecheck/build.
- [x] 1.3 Independent review and WP-01 interface handoff. Independent review approved after generic-font normalization regression; see reviews/integration-plan-review.md. WP-01 consumes mapDesignTokens directly; its runtime build proof is separately owned.

### External acceptance, outside this bounded phase

- [ ] Real approved Figma export and design-decision verification.
- [ ] Reviewed application to a local theme, native editor/Global Styles proof and local build evidence.
- [ ] Approved snapshot deployment and read-only Preview verification; no remote install/build.
