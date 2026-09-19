# Pierwszy lokalny vertical slice — konkretne call sites

Stan: 2026-09-19. Pierwszy audyt dotyczył `92bcb813d`; aktualny lokalny main to
**`68361d16342074eb5b3a1c57f86187f428509aca`**, z zachowanymi lokalnymi poprawkami.
EXEC-05 dodał i18n i testy; nie naprawił opisanego poniżej mapowania Cezar/OSS.
WP/helpery/mapper opisują lokalny working tree. EXEC-04 i OSS flow istnieją już na
origin/main; historyczne „brak bridge/worker” jest nieaktualne. To mapa integracji,
nie wynik E2E ani deklaracja zgodności wszystkich seamów.

## Gotowe wejścia i wyjścia

| Warstwa | Rzeczywisty import / plik | Wywołanie i wynik |
|---|---|---|
| WP public v1 | `import { createWordPressStudioTools } from '@open-mercato/delivery-wordpress'` | Factory `{sitesRoot,stateRoot,timeoutMs?}`; `createSite({scope:{tenantId,organizationId,projectId},attemptId,idempotencyKey,name,themeSlug})` → `{siteId,studioSiteId,scope,attemptId,toolExecutionId,localUrl,themeCommit,checks,provenance}` |
| WP snapshot v1 | `tools.captureSnapshot(scope,{siteId})`, `packages/delivery-wordpress/src/tools.ts:150` | → `{schemaVersion:1,provenance,siteId,creationAttemptId,toolExecutionId,sourceRevision:{kind:'snapshot',contentHash,externalWorkspaceId:siteId},themeFiles,databaseHash,capturedAt}`; sam wrapper nie zwraca ścieżek prywatnego store ani scope |
| WP local build | Wewnętrzny `packages/delivery-wordpress/src/prepare-theme.ts`, `prepareOwnedTheme` | `{scope,handle,expectedThemeJsonHash,expectedFunctionsHash,expectedAssetsHash,designTokens,config:{sitesRoot,stateRoot,toolchainRoot,timeoutMs?}}` → wyniki apply/enqueue/build z hashami; fixture design nie jest approval |
| WP local update | Wewnętrzny `packages/delivery-wordpress/src/theme-update.ts`, `updateOwnedTheme` | `{scope,handle,updateId,changes:[{path,expectedHash,content}],designTokens?,config}` → `{files,cssHash,build,...}`; nie jest OSS manifestem ani automatycznym AC PASS |
| OSS manual reserve | `POST /api/delivery_os/tasks/:id/attempts`; source `api/tasks/[id]/attempts/route.ts` | `Idempotency-Key` + aktualny optimistic-lock header, body `{mode:'manual_handoff',baseRevision}` → `{attemptId,taskId,baselineId,baselineHash,taskUpdatedAt,packageUrl}` |
| OSS package | `GET .../tasks/:id/package?attemptId=...`; DI `deliveryOsAttemptQueries.buildTaskPackage(scope,taskId,attemptId)` | Autorytatywny `TaskPackageV1`; odczyt istniejącej rezerwacji, nie tworzy próby |
| OSS result | `POST .../tasks/:id/results` | `{attemptId,manifest}` → accepted evidence/awaiting_review; backend command `delivery_os.results.accept` przy source manual/adapter |
| OSS review | `POST /api/delivery_os/projects/:id/evidence` | `{kind:'review',baselineId,taskId,attemptId,sourceRevision,payload:{verdict,summary,reviewedEvidenceId?,reviewer,...}}`; approved wymaga pełnych dowodów, inaczej nie przejdzie do verified |
| EXEC start — istnieje na main | `packages/enterprise/src/modules/delivery_agents/lib/executionBridge.ts`, `startExecution` | `{taskId,idempotencyKey,userId,scope:{tenantId,organizationId},container,em,targetProfileId?,baseRevision?}` → `{attemptId,workflowInstanceId,state:'reserved'}` |
| EXEC worker — istnieje na main | `workers/execute-task.ts`, queue `delivery-execute` | Job `{taskId,attemptId,tenantId,organizationId,actorUserId}`; claim → buildTaskPackage → DI `deliveryAgentsTaskExecutor.run(pkg,baseDir)` → mapper → `acceptResult` |
| EXEC executor — istnieje na main | `lib/cezarExecutor.ts`, `CezarTaskExecutor`; `@open-mercato/delivery-cezar/lib/runner` | `runCezarTask({task,baseDir,extraArgs?,timeoutMs?,cezarBin?})` → `{exitCode,stdout,stderr,runId,durationMs}`; obecny executor przekazuje tylko `taskPackage.taskId` jako task |
| EXEC acceptance — istnieje na main | `lib/resultAcceptance.ts`, `acceptResult` | `{taskId,attemptId,manifest,userId,scope,container}` → `{evidenceId,duplicate}`; wymaga poprawek niżej |

Wewnętrzne WP moduły **nie są** eksportowane przez package.json subpaths/index.ts.
Ścieżki wyżej to lokalne callsites operatora, nie nowe stabilne npm importy. Integrator
musi użyć uzgodnionego provider callsite; nie zakładać, że `@open-mercato/delivery-wordpress/theme-update` działa.

## Kontrakt mapowania i identyfikatory

Autorytatywny import OSS:
`@open-mercato/core/modules/delivery_os/lib/contracts` → `taskPackageV1Schema`,
`resultManifestV1Schema`, `resultCheckSchema`, `SourceRevision`.

- TaskPackage: schemaVersion `delivery.task-package/v1`, projectId/taskId/attemptId,
  baselineId/baselineHash, targetProfileId/targetProfileVersion:number,
  acceptanceCriteria, baseRevision, allowedPaths, validationProfile z requiredTests,
  limits, idempotencyKey. Pobierać z zarezerwowanej próby, nie składać z UI.
- ResultManifest: schemaVersion `delivery.result-manifest/v1`, te same IDs/hash/profile,
  externalRunId, baseRevision/resultRevision, changedPaths, artifacts `{path,sha256,...}`,
  checks, usage `{source,values}`. Każdy check: checkId/testId/acIds/commandProfileId,
  validationProfileVersion:number, testDefinitionHash, status/exitCode/durationMs,
  sourceRevision równe resultRevision, rawReportHash.
- Scope z backendowego kontekstu sesji/worker job; projectId z autorytatywnego pakietu.
  `creationAttemptId` WP to próba utworzenia witryny, nie bieżący attemptId zadania.
  `externalWorkspaceId` bazowego **i wynikowego** snapshotu musi być owned `siteId`,
  nigdy taskId/attemptId. Snapshot contentHash nie jest baselineHash ani deployment packageHash.
- Potrzebne rzeczywiste bajty definicji testów/raportów i frozen theme/DB artefakty,
  nie tylko deklaracje hash. Publiczny wynik snapshot wrappera nie adresuje store;
  host musi przypiąć prywatne artefakty i toolExecutionIds do bieżącej próby.

Obecny mapper `packages/core/src/modules/delivery_os/lib/__tests__/wordpressMappingFixture.ts:42`
(`mapWordpressFixture`) ma provenance literal fixture, fixture-run-* i fixture-only
reader. Dowodzi reguł korelacji/hash/allowedPaths/workspace, **nie jest adapterem live**.
Nie importować helpera `__tests__` do produkcyjnego hosta. Wewnętrzny mapper opisany poniżej jest już zaimplementowany; pozostaje żywy
callsite przypinający prywatne artefakty do próby. To konkretne zadanie integracyjne
WP/EXEC, a nie brak API OSS.

## Ustalenia audytu main i stan napraw

Pozycje 1, 2, 5 i 6 zostały naprawione lokalnie i mają 11 przechodzących regresji
opisanych poniżej. Pozycje 3 i 4 pozostają otwartymi połączeniami; nie należy liczyć
zamkniętych ustaleń jako nadal brakującego kodu.

1. **CommandBus envelope**: `executionBridge.ts` odczytuje wynik `commandBus.execute`
   jako reservation bez `.result`; `resultAcceptance.ts` robi analogicznie. Wzorzec
   OSS `api/routeSupport.ts:189` to `const { result } = await commandBus.execute(...)`.
   Bez tego attemptId/created/evidenceId mogą być undefined już w pierwszym przebiegu.
2. **Trusted capability**: `resultAcceptance.ts` tworzy zwykły obiekt trustedExecution.
   OSS `commands/evidence.ts:108` sprawdza issued WeakSet identity. Należy użyć istniejącego
   `issueTrustedExecution(actorUserId)` z `delivery_os/lib/trustedExecution`, w tym samym
   procesie, z rzeczywistym UUID aktora; nie serializować tokenu do joba ani zastępować
   aktora stringiem `delivery_agents_worker`.
3. **Cezar DTO nadal niezgodne z OSS**: `delivery-cezar/lib/contracts.ts` ma schemaVersion
   `'1'`, wersje string, `ac`, `sourceRevision`, artifact.hash i usage-array. Worker castuje
   prawdziwy pakiet OSS do tego typu. `resultManifest.ts:29–31` generuje snapshot z
   baselineHash i workspace=attemptId, checks/artifacts są puste. Nie wysyłać go wprost
   do OSS; potrzebna jawna adaptacja do powyższego autorytatywnego kontraktu.
4. **WP base revision**: HTTP execute `api/tasks/[id]/execute/route.ts` nie przyjmuje
   baseRevision, bridge fallback używa baseline hash/taskId. Sam `startExecution`
   posiada parametr baseRevision — lokalny zaufany callsite musi przekazać rzeczywisty
   snapshot; zmianę publicznego execute DTO uzgadnia właściciel. targetProfileId w tym
   HTTP schema jest UUID, podczas gdy profil WP ma stabilne ID `wordpress-theme`.
5. **Park gate**: `executionBridge.ts::pollForPark` po braku PAUSED/wyjątku tylko wraca
   lub loguje, a startExecution mimo tego enqueue'uje. To istniejąca implementacja
   wymagająca poprawki/QA, nie dowód park-before-enqueue.
6. **Result duplicate gate**: `resultAcceptance.ts` zwraca duplicate po samym istnieniu
   resultEvidenceId przed walidacją nowego manifestu. Pozostawić decyzję o identycznym
   replay/konflikcie domenowemu results.accept, żeby inny wynik nie udawał duplikatu.

Cancel ma już kod worker reconcile `resolution:'stopped'`; stary opis „brak cancel bridge”
nie obowiązuje. Nadal trzeba wykonać jego rzeczywiste testy, nie przenosić historycznego PASS.

## Najmniejszy pierwszy vertical slice

1. Po synchronizacji source/env utworzyć własny projekt WP, zatwierdzony wymagany baseline
   i jedno gotowe zadanie z jednym rzeczywistym mapowaniem AC→test. Uruchomić przez
   istniejące QA API fixtures; nie omijać nowych stage gates origin/main.
2. Utworzyć/zweryfikować owned WP, pobrać bazowy snapshot i jego artefakty. Najkrótsza
   działająca ścieżka już istniejącego API to **manual_handoff → package export**;
   automatyczna ścieżka wymaga naprawy seamów 1–5 przed E2E.
3. Wykonać jedną ograniczoną local theme update, rzeczywisty check i wynikowy snapshot.
   Wąski live mapper wiąże actual artifacts oraz final revision z otrzymanym TaskPackage.
4. Zwalidować resultManifestV1Schema, importować istniejącym results API i odczytać
   awaiting_review. Oddzielny review → verified wyłącznie przy pełnych wymaganych proof;
   brak screenshot/manual proof zostaje jawnym blockerem, nie pustym PASS.
5. Potem ten sam pakiet/manifest wpiąć do już istniejącego EXEC worker/acceptance i
   potwierdzić park→enqueue→result→signal. Testy restart/retry/dwóch runów po pierwszym
   rzeczywistym przejściu. Preview nie jest warunkiem pierwszego lokalnego vertical slice.

To rozdziela najkrótszy uczciwy **OM→lokalny WP→OM** od pełnego **EXEC→WP→OSS**.
Nie implementowano tu hosta zastępczego, API, testu runtime ani zgody publikacji.

## EXEC integration repair after main merge

The bridge now unwraps typed OSS command results, and result acceptance uses an issued trusted token bound to a valid actor UUID. Every manifest reaches canonical OSS validation, including duplicate/conflicting submissions. Dispatch requires successful initial workflow execution and a scoped persisted `PAUSED` instance at `wait_for_evidence`; missing/wrong state or lookup failure denies enqueue. `handleWaitForSignalStep` persists `PAUSED`; an executor return value alone is not park evidence.

Focused host unit regressions: **11/11 PASS**, source hashes and runner recorded in `evidence/exec-integration-regressions.json`. These are not live workflow/queue or end-to-end proof. Existing limitation: if initial park fails after reservation/linking, repeating the same idempotency key returns the reserved attempt without recovering workflow execution or dispatch. Recovery, WP source revision, HTTP profile contract and Cezar mapping remain separate integration work.

## WP-M02 — przygotowany mapper rzeczywistych wejść

`packages/core/src/modules/delivery_os/lib/wordpressResultMapper.ts` udostępnia
wewnętrzne `mapWordpressResult(input)`. Przyjmuje autorytatywny TaskPackage, backendowe
`trusted.scope/siteId/creationAttemptId/execution/baseToolExecutionId/resultToolExecutionId`,
base/result `{scope,snapshot,database:{path,bytes},theme:{[path]:{path,bytes}}}`,
execution binding, checks `{check,definition:{path,bytes},report:{path,bytes}}` i usage.
Zwraca istniejący ResultManifestV1; nie zmienia API ani publicznych eksportów WP.

Weryfikuje korelację i oba workspace, hashe rzeczywistych bajtów oraz agregatu snapshotu,
base revision z pakietu, zmienione ścieżki i canonical OSS checks. Niezmienione pliki
inwentarza poza dozwolonym zakresem modyfikacji pozostają legalne. Limity przed
hashowaniem: 200 unikalnych referencji artefaktów zgodnie z obecnym DTO, 8 MiB na
definicję/raport i 64 MiB łącznie dla checks; 1216 MiB całego wejścia. Przekroczenie
odrzuca wynik, nigdy nie obcina dowodów. Większe motywy mogą wymagać uzgodnionej
reprezentacji artefaktów z właścicielem OSS; obecny mapper nie zmienia tego kontraktu.

[35 testy i wąski TS](evidence/wp-result-mapper.json) oraz niezależny re-review
potwierdzają przygotowanie mappera na bajtach fixture. Test algorytmu wykorzystuje
oddzielnie zarejestrowany hash rzeczywistego capture. Caller nadal odpowiada za
autoryzację i przypięcie prywatnego store; pole `trusted` samo nie uwierzytelnia.
Bajty DB nie wychodzą w manifeście; referencje pozostają prywatne i wymagają kontroli
dostępu hosta. Nie wykonano live importu mapper→results ani pełnego 4.2.


## Wewnętrzny odczyt snapshotu i caller QA

`delivery-wordpress/src/snapshot-reader.ts::readOwnedSnapshotArtifacts` odczytuje
istniejący prywatny frozen snapshot wskazany dokładnym basename. Kontroluje właściciela,
scope/site/creationAttempt, manifest i bajty DB/theme, traversal/symlink/hardlink,
prywatne uprawnienia, limity i aktywny operation.lock. Nie uruchamia Studio ani
nie modyfikuje publicznych eksportów. toolExecutionId/capturedAt pozostają zaufanym
wynikiem wcześniejszego capture dostarczonym przez caller, nie dowodem z manifestu.

`core/helpers/integration/wordpressResultFixtures.ts::mapOwnedWordpressResult`
łączy oba odczyty z rzeczywistym mapperem OSS. Operator pochodzi z jawnej lokalnej
konfiguracji; helper weryfikuje jego package identity i ścieżki bez symlinków.
Jest to wewnętrzny caller QA, nie uwierzytelniony host wykonawcy ani nowa trasa API.
17 testów readera,8 compiled-callsite i TypeScript PASS; bez live HTTP/result import.
Dowód: `evidence/wp-owned-snapshot-bridge.json`.


## Offline continuation: receipt-backed manual roundtrip

`delivery_os/__integration__/wordpress_manual/TC-DELIVERY-WP-MANUAL-001.spec.ts`
is the opt-in API caller for original owned capture receipts → frozen command checks
→ mapper → results → review/correction → verified. Configuration, commands and
cleanup limitations are in its sibling README. It creates a new scoped site; historical
captures are not retroactively relabelled. This technical manual scenario does not
replace production EXEC or claim approved visual design/FLOW/release.

Internal `prepareOwnedPreviewStaging` consumes verified deployment packages and
prepares private checked copies. No Studio registration or transport caller exists
yet; that concrete host seam remains a code dependency, not a passed test.
