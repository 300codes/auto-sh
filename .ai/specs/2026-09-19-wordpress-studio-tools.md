# WordPress Studio tools

> **Korekta kierunku — 2026-09-19:** [dodatek produktowy](2026-09-19-delivery-project-flow-addendum.md) ma pierwszeństwo w zakresie domyślnego flow, osobnych akceptacji UX/KV/DS/UI, komentarzy Figma → Kanban, ustawień procesu i WordPress E2E jako głównego demo. [Nowe pakiety dla zespołu](../../context/changes/autonomous-software-delivery/flow-handoff/README.md). Poniższy dokument zachowuje wcześniejsze ustalenia techniczne; dawne React-first/WP-PoC i estymaty nie stanowią odbioru ani wyceny rozszerzonego zakresu. To zmiana wymagań, nie potwierdzenie implementacji.

Status: **partial local implementation; Studio host and live delivery deferred by user** · Created: 2026-09-19 · Owner: delivery-wordpress

## Aktualny zakres — brak WP Studio

Decyzja użytkownika z 2026-09-19: dostęp do Figmy jest dostępny po jego stronie,
WP Studio nie jest dostępne; brakującą część WordPress pozostawiamy jako
specyfikację do późniejszego wdrożenia. Zachowujemy istniejący kod narzędzi
i jego testy. Historyczne wyniki live poniżej nie potwierdzają obecnego środowiska.

Odroczenie obejmuje produkcyjny host wykonania Studio, transport publikacji
Preview, weryfikację zdalnej rewizji i odbiór WP-01…05. Wymagania dwóch języków,
edycji bez kodu oraz zachowania treści po redeploy pozostają docelowym kontraktem.
FLOW-06/07 z rzeczywistym WP i część WP pełnego demo mają status
**deferred_by_user / not_run**, nigdy PASS. Pozostały UI, domena, integracja Figmy
i ich niezależna weryfikacja pozostają w bieżącym zakresie. Wdrożenie OM nadal
jest odroczone zgodnie z wcześniejszą decyzją.

### Przekazanie do wznowienia

1. Przygotować stanowisko Studio: operator, wersje Studio/WP/PHP/Node,
   dozwolone katalogi i bezpieczne referencje dostępów. Potwierdzić wersje oraz
   licencje Yoast SEO, ACF Pro i Polylang. Nie wpisywać sekretów do repo.
2. Dostarczyć zatwierdzony handoff Figmy: file/node/version/hash, tokeny oraz
   mapę ekran/sekcja → blok/pole → edytor → tłumaczenie → test. Braki wymagają
   jawnego rozstrzygnięcia przed budowaniem witryny.
3. Zaimplementować zaufany adapter hosta z core `TaskPackageV1` do
   `ResultManifestV1`, zachowujący backend-derived scope, task/attempt/baseline,
   immutable flow binding, allowed paths i gate przed efektem. Integracja
   enterprise pozostaje opisana w specyfikacji Delivery Agents. Brak adaptera
   ma blokować wykonanie; legacy stdout ani hash baseline nie zastępują
   rzeczywistego snapshotu WP. Create/run/reconcile muszą zachować idempotencję.
4. Po lokalnym buildzie i kontrolach wykonać run → import wyniku → review →
   rzeczywistą poprawkę z nowym snapshotem i dowodami. Testy narzędzi nie są
   testami produktu; unknown usage i manual_handoff pozostają jawne.
5. Dopiero po zgodzie aktualnego kandydata wdrożyć transport na dozwolony target
   Studio Preview. URL powstaje podczas pracy Studio, nie jest wymagany z góry.
   Trwały intent wiąże scope, candidate/version, packageHash i target. Timeout
   wymaga odczytu/reconcile zamiast ponownego uploadu. Verify sprawdza URL oraz
   tożsamość wysłanej rewizji; sam HTTP 200 lub upload succeeded nie daje release.
   Wynik trafia przez F14; końcowy release wymaga osobnej decyzji człowieka.
6. Uruchomić FLOW-06/07 oraz WP-01…05: desktop/mobile, edycja treści, mediów/alt,
   CTA, sekcji, menu/header/footer, pól ACF, SEO i dwóch języków; potem ponowny
   deployment bez utraty treści, Global Styles i zapisanych szablonów. Zapisać
   SHA, rzeczywiste IDs/hash/URL, wyniki oraz odbierającego w indeksie dowodów.

Niezależna walidacja pakietu z Node 24: w `packages/delivery-wordpress` uruchomić
`npm test`, `npm run typecheck`, `npm run build`. Instrukcje istniejących lokalnych
operatorów są w [README pakietu](../../packages/delivery-wordpress/README.md).
Nie ma jeszcze gotowej komendy wdrażającej cały powyższy proces.

## TLDR

Provide a private, standalone OM package that creates a new local WordPress Studio site, scaffolds and activates its theme, and captures real execution evidence. The package calls Studio CLI directly. The former WordPress orchestrator is neither a runtime dependency nor a source of execution reports.

## Overview

This implements the authorized independent portion of WP-M01 and the [Studio tools plan](../../context/changes/wordpress-studio-tools/plan.md). The user removed the original six-hour cap on 2026-09-19. Continue all independent local work under the [QA/WP sequencing plan](../../context/changes/qa-wp-delivery-sequencing/plan.md), stopping integration at concrete dependencies on the team's code or required approvals. Readiness and live results belong in [the handoff](../../hackathon/delivery-demo/wordpress-reuse.md).

## Problem Statement

Reusing an existing orchestration server would couple the new OM workflow to its private sessions, database, queue and projects. The user instead requires OM-owned Studio capabilities and a completely new site. The delivery domain and enterprise call sites are not yet available; independent tools must remain useful and testable before those dependencies exist.

## Proposed Solution

Create `@open-mercato/delivery-wordpress`, a private workspace package with a typed tools factory and local CLI. Support create, status, start, stop and captureSnapshot for sites created by this package. Theme scaffolding, Git initialization and activation form part of create, rather than separate externally retryable mutations.

Out of scope: existing-site adoption, arbitrary WP/shell commands, AI inference, public preview, cloning, Apply/Rollback, production publication, new OM routes/entities/migrations and a second orchestration queue. Public upload requires a separate scope and target decision.

## Architecture

`createWordPressStudioTools(config, dependencies?)` receives trusted, disjoint `sitesRoot` and `stateRoot` directories and optionally an injected command runner. `tools.ts` coordinates `contracts.ts`, `ownership.ts`, `paths.ts`, `runner.ts`, `scaffold.ts` and `snapshot.ts`. The compiled CLI invokes the same public factory; it creates a site, captures a snapshot and performs a loopback HTTP smoke check.

Studio/Git run through bounded `execFile` calls without a shell. Inputs never select an executable or supply a filesystem path. The host, not the model, must derive tenant/organization/project scope. The future OSS and enterprise adapters remain responsible for authorization, mutation approval, task baseline and lifecycle. Local ownership is not a replacement for backend authentication or a delivery attempt claim.

## Data Models

No OM database schema is added. Private local state holds a versioned ownership record with strict CreateSiteRequest, requestHash, status `creating|ready`, and optional SiteResult. Site identity is SHA256 over tenant/organization/project IDs. A reservation precedes Studio create; a ready identical request can replay the result. Different effective request data conflicts. An incomplete reservation fails with reconciliation_required rather than blindly creating again. All mutations and captureSnapshot share an atomic site lock; stale locks are not automatically stolen.

SiteResult version 1 contains provenance `live|fixture`, siteId, scope, attemptId, toolExecutionId, studioSiteId, localUrl, themeSlug, themeCommit, createdAt and checks. Checks have checkId, status `passed|failed|not_run`, checkedAt and optional safe code. Fixtures must be labelled as synthetic in their wrapper/provenance and cannot certify a live outcome.

Snapshots contain SHA256 hashes of frozen allowed theme files and of SQLite backup bytes. contentHash covers the canonical versioned manifest of sorted theme file hashes plus databaseHash. It is not a logical SQL fingerprint. The backup includes committed WAL data. Raw database copies stay in private state, outside the repository; public evidence exposes hashes, not rows or absolute account paths.

## API Contracts

There are no HTTP API routes or backend UI paths in this package.

- `createSite(unknown): Promise<SiteResult>` validates a strict request: `scope` contains tenantId, organizationId and projectId UUIDs; attemptId is a UUID; idempotencyKey is 1–128 characters from `[A-Za-z0-9._:-]`; name and themeSlug are bounded validated strings. Unknown fields are rejected.
- `status(scope, { siteId })` returns siteId, studioSiteId, running and localUrl after ownership and Studio registration checks.
- `start/stop(scope, { siteId })` are idempotent state transitions for owned sites and verify the resulting state.
- `captureSnapshot(scope, { siteId })` returns version, provenance, siteId, toolExecutionId, creationAttemptId, `sourceRevision: { kind: 'snapshot', contentHash, externalWorkspaceId }`, themeFiles, databaseHash and capturedAt. It stops a running site, confirms the stop, captures private artifacts and restores the previous running state.

The CLI contract is `node dist/cli.js create --sites-root ABS --state-root ABS --request /path/request.json --output /path/report.json`. Request and report files are local operator artifacts. The CLI report must distinguish failed/not_run checks from passed checks and omit unknown internal create substeps after partial failure. HTTP readiness has one absolute 30-second budget, a 2 MiB response cap and no redirect following; Studio startup redirects may only retry the identical normalized URL. It is not the future delivery_os ResultManifest and does not grant verified or release status.

## Integration Coverage and Acceptance

All new callable paths ship with automated coverage: strict input validation; runner timeout/output/error redaction; path traversal/symlink rejection; create idempotency/concurrency/ownership/collision; scaffold and activation; status/start/stop; SQLite WAL backup and hash changes; snapshot state restoration; compiled CLI entry point and bounded HTTP smoke. Tests create their own temporary fixtures and clean them up. Fake Studio is not live evidence.

The live acceptance scenario uses the compiled package to create one new site and theme, verify activation/local HTTP, capture real hashes, and replay the same request without creating a second site. Automated tests deny all HTTP calls during tool execution; neither the former API nor database is used. No existing server is stopped merely for this test. No public preview is required. Human viewing of the new site is a separate pending check. There are no OM routes/UI requiring integration tests in this change; later delivery call sites require their own scoped end-to-end coverage.

Validation uses the package's `npm test`, `npm run typecheck` and `npm run build` with the documented local toolchain. A partial workspace install does not justify declaring the complete root gate passed.

## Risks & Impact Review

| Failure | Severity / area | Mitigation | Residual risk |
|---|---|---|---|
| Create succeeds before timeout/crash | High / external effects | Durable reservation; incomplete state requires reconciliation | Operator may need to inspect the new site; automatic rollback is absent |
| Cross-scope or symlink target | High / filesystem | Trusted scope, hashed identity, ownership and path checks | Trusted local host can still mutate files outside this API |
| Snapshot races with writes | High / evidence | Site lock, confirmed stop, backup API and frozen bytes | External filesystem writers must be excluded by the operator |
| CLI output contains credentials | High / confidentiality | Bounded subprocess output and safe error codes; no raw output in evidence | Private state and runtime access remain sensitive |
| Studio/Git unavailable or incompatible | Medium / availability | Explicit runtime, registration checks, tested tool versions | No fallback to the old runtime; report a blocker |
| Required EXEC/OSS/design implementation is absent | Medium / delivery | Complete independent local branches and identify exact integration inputs | Full OM→WP acceptance remains pending until those inputs exist |

## Migration & Backward Compatibility

Additive private package and documentation only. No existing API, entity, ACL, event, queue or DI contract changes. No OM migrations or module discovery files; `yarn generate` and database migration are unnecessary. Node 24 and the repository's Zod are used. Publishing the package is out of scope.

## Wymagany standard docelowych witryn — rozszerzenie planu

Dalsza implementacja WordPressa musi spełniać [standard wykonania stron](2026-09-19-delivery-project-flow-addendum.md#standard-wykonania-stron--tailwind-i-natywny-wordpress): Tailwind jako podstawę stylowania, małe pliki własnego CSS i PHP/includes, natywne funkcje i edytor WP, `theme.json` oraz tokeny z zatwierdzonej Figmy. Każda witryna otrzymuje Yoast SEO, Advanced Custom Fields Pro i Polylang, ze zweryfikowanymi wersjami, konfiguracją i dostępem do licencji. Pełna edytowalność oraz tłumaczenia są warunkiem odbioru WP-01…05.

To wymagania **do wdrożenia**, nie rozszerzenie wcześniejszego wyniku PASS narzędzi Studio. F0 potwierdza dostępność wtyczek i zgodność edycji; F2 dostarcza mapę tokenów/edycji; F4 obejmuje scaffold/build, konfigurację, testy redaktora i zachowanie treści po redeploy. Zmiany publicznych interfejsów narzędzi wymagają wersjonowanej delty kontraktu, nie cichej zmiany createSite v1.

## Implementation Plan

1. Strict contracts, process execution and filesystem boundaries, with regression tests.
2. Ownership/create/lifecycle, theme scaffold and frozen snapshots, with fake-Studio coverage.
3. Compiled local caller, live trial, implementation review and documented handoff.

The detailed plan owns progress. This spec does not mark the parent PoC or any acceptance criterion complete.

## Open Questions

No blocking scope decisions remain for independent tools. Future delivery DTO mapping, authorized host wiring and enterprise lifecycle remain explicit integration dependencies, not hidden assumptions about existing code.

## Final Compliance Report

**Package verification passed; see handoff for live evidence and review.** Architecture is scoped to a private provider package with no new backend/API/schema surface. 29 native tests, typecheck/build and the final live create/replay/snapshot/HTTP scenario passed; evidence, toolchain deviations and remaining risks are recorded in the handoff. Implementation review findings were fixed. Full root validation and OM→WP end-to-end acceptance are not claimed.

## Changelog

- 2026-09-19: User deferred the remaining Studio host, Preview transport and live WordPress acceptance because Studio is unavailable. Preserved local implementation and target requirements; added an explicit resumption sequence without claiming live completion.

- 2026-09-19: Reused the additive provider implementation from `83a2d8c2d9` for UI completeness. Package-local token fixtures remove dependence on absent planning artifacts. Node 24.13.0 verification passed 259 tests, typecheck and build; no live WordPress or publication was run. The newer plan requires two languages, still pending.

- 2026-09-19: Recorded removal of the WP time cap and internal theme preparation/update, native editor fixture and deployment inventory implementation; browser acceptance and integration gates remain independently tracked.

- 2026-09-19: Added pending target-site requirements for Tailwind, modular CSS/PHP, Figma-driven theme.json, required plugins and editability checks WP-01…05; no implementation claimed.

- 2026-09-19: Added implementing specification for independent Studio tools, new-site ownership, snapshot evidence and the boundary to future delivery integration.

- 2026-09-19: Implemented and reviewed independent tools; live replay and HTTP passed. Human acceptance and domain integration remain pending.

## Aktualizacja zakresu demo — Polylang Free

Poniższe odroczenie jest historyczną decyzją dla wcześniejszego demo. Nowszy,
zatwierdzony [plan UI completeness](../../context/changes/autonomous-software-delivery/workstreams/ui-completeness/plan.md)
przywraca w fazie 7 obowiązek dwóch języków, zgodności ACF–Polylang oraz zachowania
tłumaczeń po redeploy. Dla obecnego zakresu te wymagania mają status **pending**;
wcześniejsze `deferred_by_user` nie zwalnia ich z implementacji ani odbioru.

Decyzja użytkownika z 2026-09-19: tłumaczenia odroczone poza demo. Polylang Free
pozostaje wybraną wtyczką; nie wymagamy drugiego języka ani integracji tłumaczeń ACF
na odbiór demo. Ten zakres ma status deferred_by_user, nie PASS ani blocker.
Edycja treści/ACF/SEO w jednym języku oraz zachowanie treści i Global Styles po
redeploy nadal należą do odbioru. To doprecyzowanie zastępuje wcześniejsze wymaganie
wielojęzycznego probe przed demo.

## 2026-09-19 — internal demo-readiness operator

Additive local operator implementation: [F0 plan](../../context/changes/wordpress-demo-foundation/plan.md)
and [implementation adaptations](../../context/changes/wordpress-demo-foundation/implementation-notes.md).
Existing public createSite v1 and exports stay unchanged. Trusted local config pins the
three user-selected plugins by version/hash; ownership and inventory are checked under
the existing operation lock. Frozen verified ZIP bytes are transported via temporary
loopback HTTP because the Studio sandbox cannot mount arbitrary private host paths.
No paid archive is staged in the served site. Native draft/content/meta/noindex replay,
cleanup, snapshot, HTTP and owned-site stop produce bounded standalone evidence.
Generic native metadata is not an ACF field/editor or SEO acceptance test. No translation,
Tailwind, Figma approval, redeploy, OM roundtrip or public preview completion is implied.

## Doprecyzowanie użytkownika: build lokalny przed Preview

Cała instalacja, konfiguracja, build i testy odbywają się lokalnie. Dopiero gotowa,
zweryfikowana i zatwierdzona rewizja/snapshot trafia do Studio Preview jako deployment.
Na Preview nie instalujemy wtyczek ani zależności i nie uruchamiamy builda; wykonujemy
odczytową weryfikację wysłanej rewizji. Poprawki przygotowujemy lokalnie i wysyłamy jako
kolejny deployment po lokalnych kontrolach. Obecny probe F0 działa wyłącznie lokalnie;
nie jest dowodem pełnego builda systemu ani wykonanej publikacji Preview.

## 2026-09-19 — local build and token fixture preparation

Internal [Tailwind builder](../../context/changes/wordpress-local-theme-build/plan.md)
compiles real pinned Tailwind 4.3.3 locally from bounded owned PHP/HTML/JS sources,
without executing theme code or fetching build dependencies. Only generated CSS is
written atomically; native content, theme.json and Global Styles are preserved.
Frontend/editor enqueue was pending at this preparation stage; see the subsequent
implementation below. Complete WP-01 still requires its full acceptance evidence.

Internal [token mapper](../../context/changes/wordpress-design-token-mapping/plan.md)
validates a small versioned fixture/operator export subset and deterministically emits
WordPress preset settings plus matching Tailwind variables. Actual authenticated design
approval, applying the settings fragment, layout/radii/variants and browser fidelity are
not proven by fixture tests. Complete WP-02 is not accepted. Public createSite v1 and
exports remain unchanged; neither operator performs remote installation/build/upload.

A future deployment must inventory the complete prepared site, including required
plugins/media/configuration as well as built theme and DB. Existing theme+DB v1 snapshot
hashes alone do not attest every uploaded file; full artifact binding is a separate
Preview adapter requirement before publishing the approved local result.

## 2026-09-19 — internal QA/WP sequencing implementation

The [sequencing plan](../../context/changes/qa-wp-delivery-sequencing/plan.md) now owns
the remaining work. Internal `prepare-theme.ts` applies controlled preset settings,
installs native frontend/editor enqueue and builds CSS under one site lock.
`theme-update.ts` changes only bounded, expected-hash theme files and rebuilds locally;
native content and the database are not restored. Private journals retain before-images
and uncertain failures retain the lock for explicit operator reconciliation.

`editor-fixtures.ts` provisions an owned non-administrator actor, native content,
two separate media assets, navigation, template parts, Global Styles and ACF fields.
The repository-native `TC-DELIVERY-WP-EDITOR-001` exercises browser editing, real
ACF/Yoast persistence, administrative access denial and retention across a real
theme update. Its passing status must come from the recorded live run, not the
presence of the spec or unit tests. Temporary native objects are cleaned up;
the explicitly authorized theme update remains in the local demo.

`deployment-manifest.ts` captures private wp-content inventory and a consistent
SQLite backup. Its manifest states `captured_inventory_only`: core/runtime and
configuration substitution, content approval and database-secret checks remain
explicit host requirements. `preview.ts` supplies scoped read-only inventory and
a transition reducer, not a working upload transport or authenticated approval.
Studio's registered-site upload interface must be reconciled with a frozen approved
package by the host integration. No public API, createSite v1 or snapshot v1 hash
semantics change. No Preview upload or final release acceptance is implied.

## 2026-09-19 — WP-M02 internal result mapping preparation

`delivery_os/lib/wordpressResultMapper.ts` maps an authoritative reserved TaskPackage,
backend-derived scope/execution binding, two provider snapshots and byte-backed
artifacts/checks to the existing ResultManifestV1. It validates both workspace IDs,
creation versus execution attempt identity, snapshot aggregate and artifact hashes,
changedPaths against profile/package scope and canonical reported-check constraints.
It preserves missing/failed/not_run checks without manufacturing acceptance proof.

The function has no filesystem access, provider runtime dependency, API endpoint or
new public WordPress export. The caller remains responsible for authentication and
private artifact ownership/access. Existing snapshot v1 hashes and OSS DTOs are unchanged.
The internal mapper rejects more than 200 unique artifact references, check artifacts
over 8 MiB each / 64 MiB total, and inputs over 1216 MiB before hashing. It does not truncate
evidence; a larger transport representation requires a separate contract decision.

Verification: 35 focused unit tests and narrow TypeScript passed; independent review
closed inventory-scope and resource-bound findings. A recorded provider capture pins
the hash algorithm. Live store binding, result/review import and full E2E remain pending;
no production endpoint or UI path was added in this preparation. Evidence and review:
[mapper](../../context/changes/qa-wp-delivery-sequencing/evidence/wp-result-mapper.json),
[review](../../context/changes/qa-wp-delivery-sequencing/reviews/impl-review-phase-4-preparation.md).


## 2026-09-19 — Original capture receipts and offline handoff

Internal `capture-owned-snapshot.ts` binds each new successful capture to a private
original receipt. One ownership lock covers confirmed stop, SQLite/theme capture,
confirmed restoration and durable receipt creation. Errors retain reconciliation locks.
`readCapturedOwnedSnapshot` requires the original receipt hash and derives metadata
from that receipt before checking actual snapshot bytes. Historical captures cannot
be assigned retrospective original receipts. Public exports and v1 contracts are unchanged.

Eleven focused tests and package TypeScript passed; the full pre-staging WP suite
passed244 tests. Studio commands are explicitly simulated in receipt unit tests.
Full OM build and live integration acceptance move to the second computer; see
[handoff](../../context/changes/qa-wp-delivery-sequencing/offline-handoff.md).
