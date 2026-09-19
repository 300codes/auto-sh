# OSS-02 (L4a): ACL, setup, events and extension point — Plan Brief

> Full plan: `context/changes/asd-oss-t009-oss-02-l4a-add-acl-setup-events-and/plan.md`

## What & Why

Register `delivery_os` with the platform: 8 RBAC features, default role grants, 4 frozen typed events and the
execution injection host. Commands (next) emit these events and routes gate on these features, so they land first.

## Starting Point

The module has metadata, entities, migration, validators and pure domain rules, but no ACL, setup, events or
extension points; contracts already export the spot constants and the widget context schema.

## Desired End State

The feature IDs appear in the role editor; admin gets `delivery_os.*`, employee gets view/manage/import only (approvals
stay with privileged humans); events are declared with payload schemas and broadcast flags; the UI can render the
`delivery_os.project.execution` spot; a test freezes all of it and guards the OSS→enterprise boundary.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Event payload scope | Add `tenantId`, `organizationId` to all payloads | SSE drops events without `tenantId`; live status needs it |
| Feature deps | Non-view features depend on `projects.view` | Every action reads the project |
| Spot literals | Literals in `extension-points.ts`, test pins to contracts | Generator cannot resolve imports |
| Boundary guard | fs scan for enterprise/delivery-cezar imports | Cheap evidence for Progress 2.3 |

## Scope

**In scope:** acl.ts, setup.ts, events.ts, extension-points.ts, index.ts re-export, registration test, spec update.

**Out of scope:** commands, routes, di.ts, i18n, UI, subscribers.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Registration + test | 4 files + test + generate | `yarn generate` touching tracked files |

**Prerequisites:** T006–T008 landed. **Estimated effort:** one short session.

## Open Risks & Assumptions

- Enterprise consumers of `evidence.recorded` read `attemptId` from payload; it is optional for non-manifest evidence.

## Success Criteria (Summary)

- Module tests, decoupling test and core typecheck green; `yarn generate` completes.
