# T068 — AUDIT-FIX lane B: F14 id-case tolerance, F6 fail-closed parity, stale OpenAPI/spec lines, merge notes

Fast-path audit fix (lane B, FLOW-F3/F4, FLOW-07 seam). No migration, ACL, event or DI change.

- A: F14 compares ids case-insensitively (evidence baseline, command projectId); OpenAPI 422 lists every code.
- B: F6 `flowStatus` fails closed when the pinned template ref is unreadable, the same way F15 does.
- C: FLOW-07 Playwright spec: strict cleanup of foreign fixtures, a view-only 403 test, and pagination/pageSize negative tests.
- D: spec lines + hand-over merge notes (append-only).
