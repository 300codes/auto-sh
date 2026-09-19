# Plan review — T060 (self-review, autonomous)

| # | Finding | Severity | Applied |
|---|---------|----------|---------|
| 1 | Feature check ordering: plan put it after the replay probe; a replay would answer ids to a caller without the feature | HIGH | Yes — check moved before the probe (D1 amended) |
| 2 | Kit `persist` mock routes by shape → evidence/publication rows would land in `decisions`; plan D4 covers it | LOW | Yes — harness override |
| 3 | R21 release test needs green test/scan/review rows + `deliveryOsReportQueries`; plan lists it implicitly | LOW | Yes — `greenEvidence()` in the test |
| 4 | `deploymentEvidencePayload` replay: an identical deployment evidence already recorded manually is reused (evidence null, no event); acceptable and documented | INFO | Noted |

Verdict: plan sound, proceed.
