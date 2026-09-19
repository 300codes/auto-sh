# Delivery Workflows

Optional OSS provider for the approved UI completeness plan, phase 6. Enable
`delivery_workflows` only alongside `delivery_os` and `workflows`; the app module
list is intentionally unchanged. The built-in Delivery provider remains available
when this package is absent.

Organization settings select an exact published workflow version. New projects
receive a project workflow instance and a separate, immutable provider binding.
Changing the default affects future projects only. The binding records the native
definition ID/version/hash alongside the frozen FlowTemplate v1 hash: native
conditions, activities, assignments, triggers and approval configuration are not
encoded as undocumented fields in the frozen v1 contract. Both hashes are checked
before starting/reusing an instance. Completed instances are reused on retry.

Delivery definitions opt in through `metadata.immutablePolicy: "delivery"`.
Published versions cannot be rewritten or deleted; Studio's Create version action
publishes the edited document atomically through the public publication service.
Legacy definitions retain their existing editing policy.

Each process step declares its Delivery stage in `config.deliveryStage`. The four
mandatory approval stages must be `WAIT_FOR_SIGNAL` steps using
`delivery.stage.<stageId>.approved`, without pre-approval activities. Paths to
implementation, deployment and release must pass all four approval gates. Event
triggers cannot start an unbound project process. A persistent stage decision
subscriber rechecks the scoped Delivery read model and resumes approved stages.
The shared signal entry point refuses Delivery signals without the installed
guard and prevents request payloads from replacing the workflow context. Domain
commands remain authoritative for deployment consent and release.

The settings page is `/backend/settings/delivery-flow`; links open the existing
Studio with the exact definition ID. Settings use the standard mutation guard
and optimistic-lock header.

Generate this optional module's schema without activation or a database connection:

```sh
yarn tsx --tsconfig packages/delivery-workflows/tsconfig.json packages/delivery-workflows/scripts/generate-schema.ts
```

This generates migration SQL and the module snapshot only. Applying migrations,
activating the package in a QA app, and browser acceptance require their own
explicit environment preparation. No live Figma or WordPress connection is
required by this package's unit tests.
