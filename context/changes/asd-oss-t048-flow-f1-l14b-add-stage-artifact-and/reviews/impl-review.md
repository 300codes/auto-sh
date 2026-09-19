# Impl review — T048 (one unanchored read-only reviewer)

| Sev | Finding | Outcome |
|---|---|---|
| LOW | F9 decisions sorted by `createdAt` while the gate's "latest wins" uses `decidedAt, id` | fixed: `orderBy { decidedAt: desc, id: desc }`, test seeds `decidedAt` |
| LOW | F8 body read uncapped | fixed: `readCappedRouteBody` 256 KB, 413 documented |
| LOW | `routeSupport` imports `commands/stages` (registration side effects on every route) | kept: no cycle, precedent `serializers → commands/intake`; cost is bundle weight only |
| gap | no test that a body `trustedExecution` is ignored | fixed: new F7 test (actor stays the session user) |
| note | F9 shows decrypted client approver to `projects.view` holders | as specified in F9; UI shows who approved |

No CRITICAL / HIGH / MEDIUM. Verdict: ready.
