# TC-DELIVERY-FLOW-01/02/09 — Plan Brief

> Full plan: `context/changes/asd-oss-t051-flow-f1-l15a-add-api-integration-spe/plan.md`

Three Playwright API specs prove the F1 flow on the real database (intake wizard; stage approvals + v1 gate; upstream
change with an active attempt), sharing one non-spec helper. All use the wordpress-theme profile and snapshot revisions.
Key decision: FLOW-02 seeds a legacy v1 project (verified + ready task) and pins it afterwards, because R14 and R20
check the task lifecycle and the report before the flow gate. Teardown is SQL by project id, as in T050.
Risk: the v1 seed on wordpress-theme is unproven live; fallback is react-vite with a platform override in the scope content.
