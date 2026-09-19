# WordPress Studio tools

Status: implemented locally; human acceptance and OM integration remain pending. Private package `@open-mercato/delivery-wordpress` provides local Studio tools for a trusted host. It creates new sites and owns their lifecycle independently of the former WordPress orchestrator. No old API, sessions, database, queue or projects are used.

The tools factory returns `createSite`, `status`, `start`, `stop` and `captureSnapshot`. Creating a site also scaffolds its theme, initializes a real Git baseline and verifies activation. Public preview, inference, arbitrary shell/WP commands, existing-site adoption and OM backend routes are outside this package.

## Local caller

Requires Node 24, Studio CLI and Git on PATH, and permission to create directories under two private, disjoint roots. The host supplies scope; never take authenticated scope from model output. Create a request file using synthetic demonstration IDs such as:

```json
{
  "scope": {
    "tenantId": "11111111-1111-4111-8111-111111111111",
    "organizationId": "22222222-2222-4222-8222-222222222222",
    "projectId": "33333333-3333-4333-8333-333333333333"
  },
  "attemptId": "44444444-4444-4444-8444-444444444444",
  "idempotencyKey": "studio-demo-create-1",
  "name": "Studio demonstration",
  "themeSlug": "studio-demonstration"
}
```

These IDs are fixtures, not existing OM entities or evidence of an accepted baseline. Unknown request fields are rejected. Name, theme slug and idempotency key are bounded; paths belong exclusively in trusted configuration.

From the package directory, after building:

```sh
node dist/cli.js create --sites-root /absolute/private/sites --state-root /absolute/private/state --request /absolute/private/request.json --output /absolute/private/report.json
```

Replace the example paths with approved absolute directories. The CLI uses the public tools API, captures a snapshot and performs a local HTTP smoke check. The site is retained as the demonstration result. This is a real external mutation; unit tests use disposable fixtures instead.

An identical completed create request returns the recorded result without a second create. Site identity is derived from tenant/organization/project, not attemptId. Changing the request for the same site conflicts. A timeout/crash during creation leaves reconciliation_required; inspect state rather than deleting the journal or retrying with a new identity. The package does not automatically adopt sites or steal stale locks.

## Evidence and boundaries

The versioned SiteResult separates checks from execution identifiers. Snapshot evidence contains actual SHA256 file hashes and a hash of SQLite backup bytes, with a combined canonical manifest hash. Private database backups remain under stateRoot; do not commit them. Snapshot has its own toolExecutionId and references creationAttemptId. It temporarily stops the site and restores its prior state. An unconfirmed stop returns snapshot_stop_unconfirmed and retains the operation lock for operator reconciliation. Prevent concurrent external writes while capturing it.

The local report is not delivery_os ResultManifest, approved AC evidence or an OM→WP integration result. Connecting domain attempts/baselines and enterprise lifecycle is later work. A local HTTP pass does not verify visual quality, mobile behavior or public deployment. No public preview is created. HTTP readiness retries only temporary failures within a shared 30-second deadline, never follows redirects (only an exactly identical URL may be retried after Studio startup) and limits the body to 2 MiB. Failed reports preserve known completed checks; if create fails internally, its unknown substeps are omitted rather than labelled not_run.

## Validation

```sh
npm test
npm run typecheck
npm run build
```

The current checkout lacks a complete root dependency install. Local validation uses an ignored dependency symlink to available Zod 4.4.3, TypeScript 5.9.3 and Node types 25.9.2; these are the validation toolchain versions, not a claim that the workspace declared versions were fully installed. Record command outcomes in the handoff. Do not infer a green full root gate from package checks.

No discovery changes or OM database changes require generation or migration.

See the [spec](../../.ai/specs/2026-09-19-wordpress-studio-tools.md), [execution plan](../../context/changes/wordpress-studio-tools/plan.md) and [readiness/handoff](../../hackathon/delivery-demo/wordpress-reuse.md).
