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

## Demo readiness operator (internal)

The separate `node dist/demo-probe.js --request /private/request.json --config
/private/config.json --output /private/new-report.json` entrypoint prepares the three
pinned demo plugins and runs a single-language native content check. It is not exported
through the package API and does not change createSite v1. Use only trusted operator
configuration, never model output. The request uses the existing create schema. Config:

```json
{
  "sitesRoot": "/private/sites",
  "stateRoot": "/private/state",
  "timeoutMs": 180000,
  "plugins": [
    { "slug": "advanced-custom-fields-pro", "version": "PINNED_VERSION", "sha256": "PINNED_SHA256", "archivePath": "/private/archives/acf.zip" },
    { "slug": "polylang", "version": "PINNED_VERSION", "sha256": "PINNED_SHA256", "archivePath": "/private/archives/polylang.zip" },
    { "slug": "wordpress-seo", "version": "PINNED_VERSION", "sha256": "PINNED_SHA256", "archivePath": "/private/archives/yoast.zip" }
  ]
}
```

Replace the placeholders with inspected versions and SHA-256 digests. Exactly these
three plugins are allowed. Archives and their parent directory must be private, regular
files outside sitesRoot, at most 64 MiB each. All hashes are verified before installation.
A mismatched installed version stops the operation; this operator never force-updates
or reinstalls an active pinned version. Set noindex and verify it on replay.

Studio's sandbox cannot read arbitrary host paths. The operator exposes only verified
archive bytes through a temporary loopback listener with an unguessable per-operation
URL. It closes that listener on success or error. No archive enters the site's web root,
public preview, report or Git. Treat local runtime/debug logs as private.

The probe starts its owned site, prepares plugins, creates one uniquely marked draft,
checks content and native metadata across a second plugin preparation, removes that
owned draft, captures a snapshot and checks local HTTP, then stops the site in finally.
Failed/unconfirmed mutations retain the existing reconciliation lock; the report must
show failed cleanup if that prevents stopping. Inspect actual ownership and effects
before operator reconciliation; never blindly delete a lock and retry.

This verifies native CLI persistence, not ACF field registration, editor-role browser UX,
SEO configuration, theme redeploy, approved Figma/Tailwind mapping or OM integration.
Translations were deferred in the original demo scope; the newer UI completeness plan
requires two languages and their acceptance remains pending. Polylang Free remains the
historical plugin selection, subject to the required compatibility verification. The public Studio
Preview upload and its acceptance remain separate work. See the [bounded F0 plan](../../context/changes/wordpress-demo-foundation/plan.md).

Deployment order (user requirement): perform all installation, configuration, theme/assets
build and verification locally. Upload only the completed, verified and approved site
snapshot to Studio Preview. Preview is a deployment target: no remote plugin/dependency
installation, configuration or build. After upload, verify that exact revision read-only;
prepare corrections locally and redeploy. This operator does not upload anything.

## Local Tailwind builder and design fixture mapper

Internal `theme-build.ts` is a separate operator entrypoint. Supply a private request
with `{scope, handle: {siteId}, config: {sitesRoot, stateRoot, toolchainRoot, designTokens?}}`.
`toolchainRoot` contains `node_modules/tailwindcss` and `node_modules/@tailwindcss/oxide`,
both pinned to the existing workspace version 4.3.3 and compatible with the host OS.
Build-time package/network installation is not performed.

```sh
node dist/theme-build.js --request /private/build-request.json --output /private/new-build-report.json
```

It checks owned Studio registration, freezes bounded UTF-8 PHP/HTML/JS source bytes,
compiles in a bounded local child, then atomically writes only `assets/dist/tailwind.css`.
It does not execute theme code, load arbitrary Tailwind modules/stylesheets, add Preflight,
change WordPress content/Global Styles, or publish. Reports record source/output hashes.
Enqueue is provided by the coordinated preparation operator below; browser acceptance
for the resulting revision remains a separate check.

The optional `designTokens` input invokes the strict internal `mapDesignTokens` mapper.
See the [fixture schema/example](src/__tests__/fixtures/design-tokens.json).
It produces a theme.json settings fragment and Tailwind variables referring to native
WordPress preset variables. It does not write theme.json or verify Figma approval.
Only bounded colors, font families/sizes and spacing are supported; layout/radii/variant
mapping, font assets and full design/editor fidelity remain pending. Operator-supplied
approval references are declarations, explicitly `approvalVerification: not_evaluated`.

For package tests in a partial checkout, point `WP_TAILWIND_TOOLCHAIN_ROOT` at a private
compatible pinned toolchain before `npm test`. With normal workspace dependencies the
repo root is the default. No fake compiler or skipped real-compiler tests are substituted.
See [builder verification](../../context/changes/wordpress-local-theme-build/evidence/verification.json)
and [mapper verification](../../context/changes/wordpress-design-token-mapping/validation.json).

### Coordinated local theme preparation (internal)

`prepareOwnedTheme` in `src/prepare-theme.ts` combines controlled design-preset apply,
managed frontend/block-editor enqueue and the real local Tailwind build under one
site operation lock. It requires current SHA-256 preconditions for `theme.json`,
`functions.php`, and `inc/assets.php` (null only when absent). The design mapper keeps
fixture provenance and does not verify a real approval. Public `createSite` v1 and
package root exports remain unchanged.

After building the package, the internal operator accepts private JSON files:

```sh
node packages/delivery-wordpress/dist/prepare-theme.js --request /private/prepare.json --output /private/new-report.json
```

Request fields: `scope`, `handle`, `expectedThemeJsonHash`, `expectedFunctionsHash`,
`expectedAssetsHash`, `designTokens`, `config` (`sitesRoot`, `stateRoot`,
`toolchainRoot`, optional bounded `timeoutMs`). No database reset occurs. Existing
unmanaged presets/settings/styles are preserved. Conflicts and uncertain partial
writes retain the lock and private journals for explicit reconciliation; snapshot
and publication must wait. Never force-unlock a running or uncertain operation.

Native enqueue code is implemented; browser proof for a particular local revision
is recorded separately. Neither a successful compiler nor PHP callback fixture
proves editor acceptance or visual agreement with the design.

### Native editor fixture and local update (internal)

`editor-fixtures.ts` prepares a dedicated content actor and owned WordPress objects:
page, two generated PNG media attachments, navigation, header/footer, Global Styles and a page-bound ACF
field with Yoast metadata. The actor has content and `edit_theme_options` capabilities,
without plugin administration, user administration or `manage_options`. This proposed
role still requires product acceptance. ACF Pro and Yoast must already be active and
the owned site must have noindex enabled. Existing theme Global Styles prevent setup;
the fixture never replaces an unrelated user's customization.

Supply private JSON with file mode `0600`, containing `scope`, `handle`, a new UUID `fixtureId`, and
`config: {sitesRoot, stateRoot, timeoutMs?}`. Run the compiled operator:

```sh
node packages/delivery-wordpress/dist/editor-fixtures.js --operation prepare --request /private/editor.json --output /private/prepared.json
node packages/delivery-wordpress/dist/editor-fixtures.js --operation read --request /private/editor.json --output /private/readback.json
node packages/delivery-wordpress/dist/editor-fixtures.js --operation cleanup --request /private/editor.json --output /private/cleanup.json
```

Output paths must be new. Credentials remain only in the private fixture journal;
never attach that journal or browser storage state to repository evidence. Browser
tests should edit the prepared resources. Cleanup checks ownership and refuses to
cascade-delete untracked authored posts or nested ACF fields. An interrupted prepare
retains its journal and lock for explicit reconciliation, rather than creating a second
actor on retry. A native readback reports browser acceptance as `not_run`.
New fixtures use definition version2: `media` is the initial image and `replacement`
is a distinct owned image for native Media Library replacement tests. Existing version1
journals remain readable and cleanable; replay does not silently add a second image.

`updateOwnedTheme` in `theme-update.ts` accepts `scope`, `handle`, UUID `updateId`,
`changes: [{path, expectedHash, content}]`, optional `designTokens`, and
`config: {sitesRoot, stateRoot, toolchainRoot, timeoutMs?}`. The bounded paths cover
template/part HTML and source CSS/JS only. Null preconditions mean the file must be
absent. Existing applied design requires the matching token export. One site lock
covers before-images, actual file changes, a new local build and hash verification.
Exact replay checks both source files and compiled CSS. This operation never restores
an older database; prove content retention with separate before/after native and browser
checks. Neither operator is exported through the package's public root contract.

### Deployment preparation (internal)

`captureOwnedDeploymentPackage` freezes a stopped owned site's runtime content and
consistent SQLite backup into private state. Its manifest is distinct from v1's
theme/database snapshot. Private configuration is omitted; core/runtime substitution,
content review and actual host integration remain explicit prerequisites.

`inspectOwnedPreview` reads Studio inventory and checks exact site binding, host,
expiry and the inspected CLI version. `transitionPreviewPublication` is a pure
state reducer for a future trusted host; it neither validates human authority nor
performs uploads. An interrupted upload cannot begin again blindly; observation
still requires verification of the exact approved revision. No new public deploy
contract is exposed. The caller must supply authenticated decisions and real remote
evidence once the host integration is available.

`verifyOwnedDeploymentPackage` in `deployment-verify.ts` rechecks a saved private
capture using `scope`, `handle`, `packageId`, `expectedPackageHash` and
`config: {sitesRoot, stateRoot}`. It verifies the manifest, complete inventory and
actual bytes without starting WordPress. Unknown or changed files, links and path
collisions fail. Success attests only the saved package at read time, not publication
approval or remote identity; transport must preserve and verify its frozen inputs.

`preview-journal.ts` provides internal prepare/read/reconcile operations over the same
package input. Prepare additionally requires `targetHost` (null for an unbound target);
reconcile requires `expectedJournalHash`. Private atomic writes bind scope, Studio site,
package, target and revision. Reconciliation reads inventory and cannot emit `verified`
or perform an upload. Persisted `uploading` reads as effectively uncertain after restart;
retained operation locks require explicit operator reconciliation. A future trusted host
must implement authorized intent recording, transport and remote revision verification.
