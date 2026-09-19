# OSS-05 L9a pure delivery report rules — Plan Brief

> Full plan: `context/changes/asd-oss-t031-oss-05-l9a-add-pure-delivery-report/plan.md`

## What & Why
The report is the deterministic answer to "is each AC really proven on the final revision?". It turns stored rows
(baseline, tasks, evidence, decisions) into `DeliveryReport v1` with per-AC status, scans, deployment, gates and
decision applicability. The route, UI and deploy/release commands build on it next.

## Starting Point
`acProof.ts` proves ACs per revision, `traceability.ts` builds the requirement→AC→task skeleton, `projectStatus.ts`
has the progress denominator. There is no report schema, no scan/deployment/gate logic and no `manual_pending`.

## Desired End State
`buildDeliveryReport` is pure and covered by wrong-vs-right tests; `delivery.report/v1` is a registered schema with a
fixture; unknown versions are rejected.

## Key Decisions Made
| Decision | Choice | Why |
|---|---|---|
| Manual AC vs publish | `manual_pending` does not block publish, blocks release | The preview is what the human reviews; safety gate intact |
| Scan states | present / failed (failed dominates) / missing (incl. `not_run`, kept in `reportedStatus`) | Fixed enum; `not_run` still visible |
| Scan sources | scan rows and manifest/test checks with a required scan `checkId` | Runner and manual paths both count, same validation |
| Default revision | newest `result_manifest` of the baseline; none → null, gates blocked | Integration commit is the last accepted result |
| Decision applicability | deploy: hash + revision; release: revision + deployment row on it; latest deploy decision wins | Revision change voids old decisions |
| Usage | per-manifest passthrough, `'unknown'` literal kept | Never 0 |
| `skipped` | normalised to `not_run` before proving | Acceptance bullet |
| Schema | registered in `deliveryDocumentSchemas` | Additive; 422 on unknown version |

## Scope
**In:** `lib/deliveryReport.ts`, schema in `contracts.ts`, fixture + loader, tests. **Out:** route R22, R20/R21
commands, UI, i18n, migrations, changes to other streams' files.

## Phases at a Glance
| Phase | Delivers | Risk |
|---|---|---|
| 1. Contract, fixture, rules | schema, builder, fixture | over-wide DTO — keep to the task list |
| 2. Tests | wrong-vs-right pairs | test data drift from fixtures |

**Prerequisites:** OSS-04 done (evidence rows, acProof). **Estimated effort:** one session.

## Open Risks & Assumptions
- Publish gate ignoring `manual_pending` is a plan decision; R20 must use the same gate.
- Decisions of kind deploy/release do not exist yet in commands; the applicability rule is tested with hand-built rows.

## Success Criteria (Summary)
- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` green.
- Every acceptance bullet of T031 has a failing and a passing test.
