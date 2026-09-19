# L20b publications.record — Plan Brief
> Full plan: `context/changes/asd-oss-b-t060-flow-f4-l20b-add-delivery-os-publica/plan.md`

- What: the F14 command that turns a `PublicationResult v1` into one v1 `deployment` evidence row + one `delivery_publications` row atomically.
- Gates: named deploy decision (project/baseline/revision/verdict), all deploy decisions (`checkDeployConsent`), pinned flow gate (`stage_not_approved`), foreign refs.
- Replay: payload hash before the lock → `duplicate: true`; unique violation → re-read → duplicate.
- Evidence: additive in-transaction helper exported from `commands/evidence.ts`; public `evidence.record` unchanged.
- Tests: `commands/__tests__/publications.test.ts` on the baselineTestKit with a fake rollback-on-throw transaction.
- Risk: none on registries beyond one appended import line and one id in the scopeChange list.
