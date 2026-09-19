# T070 AUDIT-FIX plan (fast path — the audit is the plan)

Final lane-B code SHA: `3bf1a7435` (T069). Measured at it: delivery_os jest 96 suites / 1821 tests / 1 snapshot; Playwright `--list TC-DELIVERY-FLOW-07` → 5 tests (not run); auth `acl-feature-catalog.i18n` red on `delivery_agents.execute|monitor`.

Decisions:
- Finding 9: `dev-mateusz` moved on (T056) since the audit, so line 399 is no longer byte-identical. The acceptance requires identity with `dev-mateusz`, and T068 decided "keep lane A's version" — line 399 is re-synced to lane A's current text (identical change on both sides merges cleanly); the lane-B paragraph states it supersedes the F14/F15 "pending" clause.
- Finding 10: lane A never edited the F14 row (same hash as merge-base), so the in-place edit is safe; also recorded in the changelog.
- Findings 1–7 are applied as a rewrite of the stale top sections of the hand-over (not another addendum), since the addenda are what made it contradictory.

## References
- Audit findings in the T070 task; `handover/FLOW-F3-F4-lane-b.md`; spec F14 row, status paragraph, Integration coverage (delta).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Docs corrections

#### Automated

- [x] 1.1 F1 final-SHA claim replaced
- [x] 1.2 F2 test evidence re-measured and labelled run/not-run
- [x] 1.3 F3 commit table completed
- [x] 1.4 F4 nine i18n audit keys + four detail codes in the patch request
- [x] 1.5 F5 enterprise acl-catalog patch request
- [x] 1.6 F6 blocker list: runnable R22 curl, Status section, void merge note removed
- [x] 1.7 F7 merge notes name stageDecisions/flowQueries/flowGate and the changelog tail
- [x] 1.8 F8 FLOW-07 coverage row marked not executed
- [x] 1.9 F9 lane-B paragraph supersedes the pending clause; line 399 identical to dev-mateusz
- [x] 1.10 F10 unsupported_evidence_kind in the F14 row + changelog entry
- [x] 1.11 F11 FLOW-progress T068 and T070 entries
