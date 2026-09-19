<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: WordPress demo foundation

- **Plan**: ../plan.md
- **Scope**: bounded F0 phases 1–3
- **Date**: 2026-09-19
- **Verdict**: APPROVED for local operator readiness
- **Findings**: 0 unresolved critical, 0 unresolved warnings; three corrections verified

## Verdicts

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS — internal operator and documented runtime adaptations |
| Scope Discipline | PASS — v1/API unchanged; no remote build/upload |
| Safety & Quality | PASS — independent transport and caller/native reviews |
| Architecture | PASS — scoped local provider tools, no former orchestrator dependency |
| Pattern Consistency | PASS — strict input, owner lock, bounded commands, sanitized evidence |
| Success Criteria | PASS — 65 tests/typecheck/build and bounded live stages; downstream acceptance retained |

## Findings and iterative decisions

### F1 — Retained site must be explicitly started on operator replay

- **Severity**: WARNING
- **Impact**: LOW — caller-only correction.
- **Location**: packages/delivery-wordpress/src/demo-probe.ts
- **Detail**: createSite replay preserves a stopped runtime; the caller previously relied on incidental startup.
- **Decision**: FIXED — explicit owned site.start stage before probes; caller regression and stopped-site live replay passed.

### F2 — Studio sandbox cannot read private host ZIP paths

- **Severity**: WARNING
- **Impact**: MEDIUM — verified archive transport needed a local runtime adaptation.
- **Location**: packages/delivery-wordpress/src/demo-plugins.ts
- **Detail**: First live run failed before installation; existing operation lock correctly required reconciliation.
- **Decision**: FIXED — serve frozen verified bytes on temporary 127.0.0.1-only exact capability URL, bounded requests/deadline; close on success/failure. No paid archive in served site. Source tests and live install passed; original failure and reconciliation retained.

### F3 — WordPress safe-URL policy rejects loopback installation

- **Severity**: WARNING
- **Impact**: MEDIUM — requires precisely scoped compatibility hook, not global policy change.
- **Location**: packages/delivery-wordpress/src/demo-plugins.ts archiveHttpPolicyPhp
- **Detail**: Second live run rejected loopback; read-only runtime validation confirmed the default restriction.
- **Decision**: FIXED — only generated URL, host and assigned port allowed inside this WP-CLI process; redirects disabled for that request. Other policy values preserved. Independent final transport review, fixture tests and real install passed.

## Independent review and evidence

- [Plan adherence](plan-adherence.md): independent implementation inspection and final evidence addendum.
- [Caller/native safety](safety-patterns.md): reviewer did not author those modules.
- [Transport safety](transport-safety.md): reviewer did not author plugin transport; reviewed final exact-URL hooks and source hashes.
- [Evidence index](../evidence/README.md): final 65/65 package tests, typecheck/build, exact source hashes and all three live attempt reports with reconciliation.

Successful live run: WP7.1.1/PHP8.4.23; ACF Pro6.8.9, Polylang Free3.8.9, Yoast28.5 active; plugin replay unchanged, noindex/content/meta persistence, own draft cleanup, snapshot, HTTP200 and owned site stop PASS. Local validation toolchain differs from declared workspace dependencies; full monorepo gate is not claimed.

User steering is recorded in spec/runbook: install/configure/build/test locally first;
Preview later receives the ready approved snapshot as deployment, with read-only remote
verification and no remote installation or build. WP-01/02 build/design preparation is
tracked separately. ACF/editor/SEO, full redeploy, complete OM integration/system build
and Preview acceptance are still incomplete. Generic post meta is not ACF acceptance.
