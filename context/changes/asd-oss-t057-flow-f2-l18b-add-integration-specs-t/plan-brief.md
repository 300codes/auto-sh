# FLOW-F2 L18b — Plan Brief
> Full plan: `plan.md`
- **What:** two Playwright API specs on :3100 (TC-DELIVERY-FLOW-03 comment import → staff Kanban, TC-DELIVERY-FLOW-04 Kanban vs approval gate), FLOW-08 rerun, `handover/FLOW-F2.md`, spec changelog.
- **Starting point:** routes F10–F13 exist with jest route tests over fakes; the default command-bus Kanban adapter was only smoke-probed live once (1 card + 1 comment, OK).
- **Key decisions:** fixture user homed in the admin org with `delivery_os.*` + `staff.*`; staff project/statuses via the public staff API (project create seeds the board); FLOW-04 imports with `artifactId: null` so the thread fails closed for every UX version (that is what makes the v2 re-block observable); cleanup by SQL for delivery + staff rows incl. index/action-log rows; kit extended (`flowSpecKit.ts`), no staff file touched.
- **Phases:** 1 kit + both specs (parallel subagents write the specs) → 2 run specs + FLOW-08 → 3 hand-over + spec changelog.
- **Risks:** staff auto-assignment for a user without a staff member; concurrent import race answers; shared DB leftovers (before/after counts in /tmp/t057-before.txt).
