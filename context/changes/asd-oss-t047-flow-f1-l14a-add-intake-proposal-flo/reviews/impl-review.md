<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F1 L14a routes

- **Plan**: context/changes/asd-oss-t047-flow-f1-l14a-add-intake-proposal-flo/plan.md · **Scope**: Phase 1 of 1 · **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes) · **Findings**: 0 critical, 0 high, 1 medium, 6 low (one unanchored reviewer sub-agent)

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (jest 86/1660, api 18/184, typecheck, generate, live smoke) |

| ID | Sev | Finding | Decision |
|---|---|---|---|
| F1 | MEDIUM | "proposals ignored" test ran on an empty store, could not catch a wipe of stored refs | FIXED — new test imports a proposal, then PUTs forged/empty refs; stored ref survives |
| F2 | LOW | PUT intake without header on a foreign project answers 428 before 404 (command order, T044) | DISMISSED — same answer whether the project exists, no oracle; command out of this task's scope |
| F3 | LOW | Two 409 entries per route: OpenAPI generator keys by status, second wins | FIXED — one 409 entry with `z.union` of flow error body and lock-conflict body (proposals, pin) |
| F4 | LOW | Pin replay returns the current project `updatedAt`, not the original one | DISMISSED — `projectUpdatedAt` is the version the caller needs for the next write; template/pinnedAt stay identical |
| F5 | LOW | F6 loads full artifact rows (decrypted content) to read ids/hashes | DISMISSED — shared flowGate loaders, rows bounded by stage versions; optimise with `fields` if it shows up |
| F6 | LOW | `expectNoWrites` cannot see in-place row mutation | ACCEPTED — code path has no assignments; test-kit limitation |
| F7 | LOW | serializers imports commands/intake (registers commands) | ACCEPTED — same pattern as routeSupport → commands/shared |
