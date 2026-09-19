---
date: 2026-09-19T05:20:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: e70ed745757af6ac40c4978892aef8accc79579f
branch: dev-mateusz
repository: open-mercato
topic: "How R14–R16 and the read-only deliveryOsAttemptQueries service fit onto the existing delivery_os routes, commands and builder"
tags: [research, codebase, delivery_os, api, di]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: routes R14–R16 and `deliveryOsAttemptQueries`

Research was done in the main context (hard RAM rule on this machine; same choice as T012–T015).

## Research Question

How do the existing delivery_os routes, the `attempts.reserve` / `results.accept` commands, `buildTaskPackageV1`
and spec rows R14–R16 fit together, and how do core modules register Awilix services in `di.ts`?

## Summary

Everything needed already exists; this task is wiring. Routes reuse `api/routeSupport.ts`
(`resolveDeliveryRouteContext`, `readRouteId`, `readRouteBody`, `executeDeliveryCommand` with the mutation guard,
`deliveryErrorResponse`, `requireTaskIncludingArchived`, `resolveRouteEm`). The package read path is not yet shared:
`commands/evidence.ts:92-127` (`buildResultPackage`) loads baseline + profile and calls `buildTaskPackageV1` with
`attemptGate: 'none'`. The GET route and the DI service need the same loader with the default `'open'` gate, so a new
`lib/attemptQueries.ts` holds one function used by both.

## Detailed Findings

### Route support and test kit
- `api/routeSupport.ts:43-64` builds the command context like the CRUD factory (no home-org fallback, 422 on rejected selection).
- `api/routeSupport.ts:142-169` `executeDeliveryCommand` runs `runRouteMutationGuards`, merges `pathInput` last (path wins over body), runs after-success.
  Body keys pass straight to the command, so R14 must build the body itself from the parsed schema — otherwise a client
  could smuggle `trustedExecution`. (The command also rejects it when `ctx.request` exists: `commands/attempts.ts:61-70`.)
- `api/__tests__/routeTestKit.ts`: in-memory store incl. `tasks` and `evidence`; `routeState.writes` counts `persist` and
  `markOrmEntityChange`; `em.flush`/`transactional` are plain functions, not spies — the zero-write test needs spies.
  `apiRequest` accepts extra `headers` (for `Idempotency-Key`).

### Commands
- `commands/attempts.ts:110-227`: replay is checked before the lock; lock header required only for a new key (`:145-154`);
  result carries `created` → 201/200. Missing key → `idempotency_key_required` (catalogue status **400**, `lib/contracts.ts:24`).
- `commands/evidence.ts:138-249`: `source: 'manual'` allowed with a request; checks no feature; result `{evidenceId, duplicate, taskStatus, taskUpdatedAt}`.
  Spec row UA-12 and T014 notes: 201 for new, 200 for replay.
- `data/validators.ts:229-262`: `reserveAttemptBodySchema` (mode literal `manual_handoff`), `idempotencyKeyHeaderSchema`,
  `packageQuerySchema`, `resultsImportSchema` (manifest > 2 000 000 chars → `payload_too_large` 413 via `addDeliveryIssue`).

### Builder
- `lib/taskPackage.ts:93-165` is pure; default gate `'open'` returns `attempt_not_found` 404, `attempt_cancelled`/`attempt_closed`/`reconciliation_required` 409.

### Spec
- `.ai/specs/2026-09-18-delivery-os-hackathon.md:231-237` DI service; `:279-281` R14–R16 features (R15 = `attempts.manage`); `:304-306` behaviour rows.
- Attempts live in `delivery_tasks.execution_attempts` (JSONB), so `listPendingDeliveries` reads scoped tasks and filters registers in memory.

### DI pattern
- `progress/di.ts`: `export function register(container: AppContainer)` with `{ resolve: (c) => factory(c.resolve('em')) }`. Discovered by `yarn generate` (di.generated.ts, gitignored).

## Open Questions
- Task text asks for 422 on a missing key / `mode: automatic`; the frozen, test-pinned catalogue says 400. Resolved in the plan: keep 400 (same rule as T015).
- Task text says R16 answers 200; spec and T014 say 201 new / 200 replay. Resolved in the plan: follow the spec.
