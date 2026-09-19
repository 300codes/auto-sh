# Brief — T046 gate call sites

Add `commands/flowGate.ts` (shared row loaders + `checkProjectFlowGateV1`), call it from task `ready`, attempt reserve (both modes) and approved deploy decisions; unpinned projects skip it entirely. Refusal = frozen `422 baseline_not_approved` with per-stage `details[]`. Two new suites (`flowGate`, `flowRegression`); all existing delivery_os suites stay green; spec changelog + running hand-over line.
