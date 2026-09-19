<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F4 L20c — route F14, fake deploy adapter, chain test

- **Plan**: context/changes/asd-oss-b-t061-flow-f4-l20c-add-route-f14-post-get/plan.md
- **Mode**: Deep (inline) · **Date**: 2026-09-19 · **Verdict**: SOUND (after F1 fix)
- **Grounding**: 5/5 paths ✓ (commands/publications.ts, routeSupport.ts, serializers.ts, fakes.ts, routeTestKit.ts), symbols ✓ (`parseFlowVersioned`, `readCappedRouteBody`, `executeDeliveryCommand`, `publicationListQuerySchema`, `ORDERED_ENTITIES`)

| ID | Sev | Finding | Decision |
|---|---|---|---|
| F1 | WARNING/LOW | List item answering `releaseDecisionId: null` misreports a non-null input (the field has no column) | FIXED — field omitted from the list item |
| F2 | OBSERVATION | Route parses `publicationResultV1Schema` and the command parses it again — acceptable, same as F7 (route gives the flow `unsupported_schema_version` code; the command protects in-process callers) | DISMISSED |
| F3 | OBSERVATION | Chain profile has a fallback (react-vite + deployment evidence) if the WP v1 result path rejects the shared draft — decision recorded, to be reported in the hand-over if used | ACCEPTED |

Dimensions: End-state PASS · Lean PASS · Architecture PASS (existing route/test patterns reused) · Blind spots PASS · Completeness PASS.
