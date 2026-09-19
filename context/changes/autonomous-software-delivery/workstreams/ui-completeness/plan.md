# Domknięcie UI i procesu Delivery — Implementation Plan

## Overview

Dostarczyć kompletną ścieżkę portfolio OM → wizard → Scope → UX → Key Visual → DS/UI → WordPress → QA → zgoda publikacji → publikacja i verify → release. Plan integruje pozostałe prace UI-01–06, OSS, EXEC, Figma, Workflows i WP, zachowując podział właścicieli oraz działające D1–D3.

Podstawa: [decyzje Q1–Q8](planning-decisions.md), [audyt](research.md), [uzupełnienie techniczne](planning-research.md) i `.ai/specs/2026-09-19-delivery-project-flow-addendum.md`. Ocena HIGH i osiem faz zostały potwierdzone przez użytkownika. Baza uzupełniającej weryfikacji: `25ee6260c263fcb69a4c30c3fc23d4edb94942b9`; pierwszy krok implementacji ponownie porównuje dostawy, zanim ktokolwiek zacznie odtwarzać brakujący kod.

To plan przyszłej implementacji. Nie potwierdza wykonania testów, gotowości usług ani odbioru. Dla tego zakresu Q2/Q3 zastępują historyczne ograniczenie do nowych testów oraz dawne 36 h / WP 6 h i WP-PoC. Q5 wymaga odbioru przekazań, nie zatrzymywania każdej poprawki. Zgody klienta na artefakty i publikację pozostają osobnymi operacjami produktu.

## Current State Analysis

| Obszar | Dostarczona baza | Pozostała praca |
|---|---|---|
| UI-01 | Capture/verify i historyczne artefakty Figmy | Aktualny probe sesji, zapisu/renderu i osobno komentarzy; odbiór |
| UI-02 | Lista/create/detail/archive, sekcje i InjectionSpot | Prawdziwy widget EXEC, guarded mutations, stan po refresh |
| UI-03 | Import requirements/plan, AC, pojedynczy upload, freeze i decyzje | Wieloekranowy DesignManifest, trwały partial import i review draftu |
| UI-04 | Task route, register, reserve/export/import/cancel/reconcile | Odczyt zaakceptowanego wyniku po reload i testy rzeczywistych interakcji |
| UI-05 | D1 evidence/files, D2 flow gates, D3 candidate | Pełne metadane evidence, nazwane blockery z linkami, browser coverage |
| Proces | Intake/stage/pin commands, kontrakty F1–F15 i projekcja | HTTP/query, baseline binding, gate przed efektem, wizard, Scope agent |
| Feedback | Kontrakty komentarzy i istniejący staff Kanban | Provider Figma, trwałe mapowania, retry/recovery, triage i approval loader |
| Workflow | Built-in template i workflow próby | Exact-version provider, proces projektu, Studio/settings, immutable publish |
| WP/QA | Lokalne narzędzia Studio, snapshot, materiały UI-06 | Realna implementacja/review/poprawka, standard WP, publikacja, verify i live |

### Key Discoveries

- `packages/enterprise/src/modules/delivery_agents/widgets/injection/project-execution-action/widget.client.tsx:24`: widget błędnie destrukturyzuje `useT`; stan próby ginie przy odświeżeniu hosta.
- `packages/core/src/modules/delivery_os/api/tasks/[id]/results/route.ts:28`: istnieje POST, brakuje GET. D1 safe payload nie zawiera pełnego summary findings/usage; nie rozbudowywać go do surowego manifestu.
- `packages/core/src/modules/delivery_os/commands/attempts.ts:147`: kolejność locków project → task; replay w linii 164 poprzedza optimistic lock. Nowy gate musi zachować tę kolejność.
- `packages/core/src/modules/delivery_os/commands/stages.ts:158`: loader wątków zwraca pustą listę, a zapis odroczeń jest no-op. Pełny feedback approval nie jest jeszcze wdrożony.
- `packages/core/src/modules/delivery_os/commands/baselines.ts:214`: freeze deduplikuje contentHash. Dwa zestawy stage refs mogą mieć ten sam baseline, więc binding nie może być nadpisywanym polem unikalnym tylko po baselineId.
- `packages/core/src/modules/delivery_os/lib/designReview.ts:156`: tożsamość ekranu w baseline pomija figmaVersion; sesja importu zachowuje wersje, finalny draft wybiera jedną.
- `packages/core/src/modules/delivery_os/commands/flowTemplateProvider.ts:15`: publiczny provider przyjmuje id/version bez scope; implementacja wymaga scoped DI.
- `packages/core/src/modules/workflows/lib/definition-edit-safety.ts`: obecna ochrona topologii nie chroni wszystkich conditions/tools/policies. `lib/find-definition.ts` ma fallback kodowy, który nie gwarantuje wskazanej wersji.
- `packages/delivery-wordpress/src/tools.ts:188`: create/status/start/stop/captureSnapshot nie wykonują całego wymaganego procesu publikacji ani QA treści.

## Desired End State

Nowy projekt otwiera przegląd etapu, oczekującej decyzji, blockerów i głównej akcji. Użytkownik zapisuje i wznawia brief, przegląda propozycję Scope, potwierdza dostępne narzędzia, a następnie niezależnie akceptuje aktualne Scope, UX, KV i DS/UI. Historia i dotychczasowe sekcje pozostają dostępne. Rzeczywiste komentarze Figmy trafiają do istniejącego staff Kanbana i nie stają się zgodami przez samo Done.

Wykonawca otrzymuje baseline związany z zatwierdzonymi etapami. UI pokazuje rzeczywiste próby, wyniki i dowody także po reload. Nowa wersja procesu opublikowana w Workflows Studio dotyczy nowych projektów, a stare zachowują przypiętą semantykę. WP jest edytowalny, zgodny z zatwierdzonym DS i zweryfikowany na uzgodnionym URL po osobnej zgodzie publikacji. Pełny odbiór wymaga FLOW-01…09 i WP-01…05, próby i nowego demo; fixture ani replay go nie zastępują.

## What We're NOT Doing

- Ponownej implementacji D1–D3, usuwania legacy FROM_DESIGN ani zmiany zamrożonych manifestów v1.
- Nowego silnika procesu, kopii Workflows Studio, drugiego Kanbana lub zależności OSS od enterprise.
- Automatycznej migracji istniejących projektów na v2, portalu klienta ani zapisu OM → Figma.
- Przebudowy DS platformy OM; generowany DS należy do witryny klienta.
- Zmian pipeline/PR/release automation, zakupu licencji, zastosowania lokalnych migracji ani publikacji bez właściwej zgody.

## Implementation Approach

Właściciele: Mateusz — domena/API i wspólne rejestry; Marcin — workflow/EXEC i agent Scope; Adam — UI/Figma; Michał — WP/QA. Referencją CRUD są `customers`; stosować właściwe `AGENTS.md` core/UI/backend, staff, workflows, integrations/data_sync, AI i QA przed zmianą ich kodu. Nowe provider packages to `packages/delivery-figma` z modułem `delivery_figma` oraz opcjonalny OSS `packages/delivery-workflows` z modułem `delivery_workflows`. To projektowane lokalizacje, nie istniejące dostawy.

Fazy są pakietami przekazania. Faza 1 zaczyna się pierwsza; blokery dostępu nie zatrzymują niezależnych poprawek fazy 2. Faza 3 dostarcza fundament dla 4 i integracji 5/6/7. Providerzy i WP mogą rozwijać się na przyjętych kontraktach równolegle. Pełna akceptacja komentarzy w fazie 4 czeka na fazę 5, a pełne tworzenie projektów z ustawionej wersji — na fazę 6. Faza 8 scala wyniki na końcowej rewizji.

`## Progress` poniżej prowadzi wykonanie tej zmiany, wymagane przez 10x-implement. Nie jest drugim rejestrem odbioru całego hackathonu: nadrzędny `../../plan.md#progress` i kanoniczny indeks QA zachowują verdict produktu. W fazie 8 QA przekazuje do nich dowody bez automatycznego przepisywania lokalnych checkmarków na PASS. Wszystkie lokalne manualne pozycje wymagają potwierdzenia człowieka.

### Zależności i przekazania

| Przekazanie | Warunek | Odbiorca |
|---|---|---|
| 1 → wszystkie | Dostawy porównane, kontrakty i własność zapisane; readiness ma wynik lub jawny blocker | Wszyscy |
| 2 → UI/EXEC | Rzeczywisty widget i wyniki przeżywają reload | Adam + Marcin |
| 3 → 4/5/6/7 | Scoped API, binding i execution gate przetestowane | UI/providerzy/EXEC |
| 4 + 5 → wykonanie | Aktualne osobne zgody, komplet designu, feedback triage, zatwierdzone tokeny | Marcin + Michał |
| 6 → próba | Studio publikuje v2, v1 zachowuje semantykę po restarcie | QA |
| 7 → 8 | Wynik WP, review/poprawka, edytowalność, publikacja i verify mają osobne dowody | QA + odbierający |

## Critical Implementation Details

### State sequencing

Gate ready/reserve działa pod istniejącą blokadą projektu; idempotentny replay nie staje się nową rezerwacją. Worker sprawdza aktualność ponownie przed efektem/retry/resume, ale nie blokuje własnej poprawnie claimed próby. Zmiana etapu przy aktywnej lub nierozstrzygniętej próbie pozostaje zablokowana do cancel/reconcile, dzięki czemu sprawdzenie nie jest wyłącznie frontendowym snapshotem.

Binding jest append-only i obejmuje baselineId, templateHash oraz id/version/hash czterech artefaktów. Identyczny baseline content może mieć kolejny poprawny binding; nie zmienia to jego historii ani nie fabrykuje technical approvals. Currency porównuje pełny zestaw refs, nie samo baselineId.

### Timing & lifecycle

Stan UI odtwarzać ze scoped register/query, a nie wyłącznie local state potomka. Odświeżenie zachowuje użyteczne dane i osobny stan refetch; timeout po zapisie uruchamia odczyt/korelację, nie ślepy ponowny append. Sesja importu utrwala sukces dopiero po weryfikacji bytes/hash i powiązania załącznika.

### User experience spec

Niekompletny DesignManifest pozostaje draftem z listą braków i retry. W finalnym draft/baseline jest jedna wersja na fileKey/nodeId/viewport, choć sesja zachowuje historię wersji. Nowe page roots są serwerowe; wizard, Scope, stage review, sync i settings są osobnymi client islands, z obsługą klawiatury, i18n i wspólnych stanów błędów.

## Phase 1: Uzgodnienie bieżących dostaw i readiness

### Overview

Wszyscy właściciele sprawdzają faktyczne dostawy i warunki live przed dublowaniem kodu. Brak dostępu blokuje tylko zależną próbę. Nie jest to faza implementacji całego brakującego backendu.

### Changes Required

#### 1. Inwentarz i kontrakty przekazania

**Files:** `planning-research.md`, nowy `handoff.md` w tym katalogu; istniejące `.ai/specs/2026-09-18-delivery-os-hackathon.md`, `.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md`, `.ai/specs/2026-09-19-wordpress-studio-tools.md`.

**Intent:** Porównać bieżący HEAD, lokalne branche/worktrees, dostępne remote refs i handoffy właścicieli. Dostawę znalezioną poza checkoutem przypisać do konkretnego SHA i wykazać różnicę przed integracją.

**Contract:** Zapisać tabelę delivered/missing/conflicting, dokładne pliki, kontrakty i testy. Brak dostępu do remote oznacza niepotwierdzony stan remote, nie dowód nieistnienia pracy. W spec OSS opisać dodatki results read, baseline binding, DesignImportSession i staff recovery; w enterprise agent Scope/WP host; w Workflows publiczny exact-version/publish seam i ochronę Delivery. Nie zmieniać istniejących F1–F15 ani v1. Ledger client boundaries wymienia nowe islands i importerów. Zatwierdzenie przekazania dotyczy konkretnej delty.

#### 2. Stanowisko, odbierający i realne probe

**Files:** `../ui-06/readiness.md`, `hackathon/delivery-demo/figma-readiness.md`, `handoff.md`.

**Intent:** Zapisać runtime/migration status, dostęp do Figma write/read/render oraz osobno komentarzy, rzeczywisty WP host, target publikacji i operatorów.

**Contract:** Każdy probe ma datę, wersję narzędzia, operatora, wynik i bezpieczny dowód; żadnych credential values. WP readiness zapisuje zgodne wersje WP/PHP/Tailwind/Yoast/ACF Pro/Polylang, źródła paczek i licencje oraz obsługę ACF–Polylang wybranych edycji. Osoba udzielająca zgód klienta i odbierający są wskazani przed live. Migracje tylko po osobnej zgodzie; brak readiness daje blocker z właścicielem i warunkiem odblokowania.

### Success Criteria

#### Automated Verification

- Inwentarz SHA i plików oraz kontrola referencji dokumentów potwierdzają mapę istniejących i brakujących dostaw bez odtwarzania D1–D3.
- Kontrakty delty i ledger wskazują request/response, scope, ACL, lock, idempotencję, błędy, testy i właściciela każdego nowego punktu integracji.

#### Manual Verification

- Właściciele potwierdzają przekazanie kontraktów i readiness z dowodami albo nazwanymi blockerami; ustalają operatorów, odbierającego i ponowną estymatę.

**Implementation Note:** Odbiór tego przekazania nie wymaga usunięcia wszystkich blockerów live. Niezależne poprawki mogą trwać równolegle; żadnej próby live nie oznaczać jako zaliczonej na podstawie inwentarza.

## Phase 2: Stabilizacja istniejącego UI

### Overview

Adam i Marcin naprawiają prawdziwą integrację EXEC; Mateusz dostarcza minimalny brakujący odczyt wyników, a QA browser regresje.

### Changes Required

#### 1. Widget i trwały wynik próby

**Files:** `packages/enterprise/src/modules/delivery_agents/widgets/injection/project-execution-action/widget.client.tsx`; pod `packages/core/src/modules/delivery_os/`: `backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx`, `backend/delivery/projects/[id]/tasks/[taskId]/DeliveryTaskDetailClient.tsx`, `components/task/TaskExecutionPanel.tsx`, `api/tasks/[id]/results/route.ts`, nowe `commands/resultQueries.ts`, `lib/resultReadContracts.ts`, istniejące `di.ts` i `api/schemas.ts`.

**Intent:** Poprawić useT, objąć execute/cancel guarded mutation i odtworzyć aktywną próbę oraz zaakceptowany wynik z backendu po refetch/reload.

**Contract:** Addytywny GET `/api/delivery_os/tasks/:id/results?attemptId=<uuid>` zwraca osobny wersjonowany summary: task/attempt/baseline/evidence refs, sourceRevision, source, createdAt, checks/findings/usage potrzebne istniejącemu ResultSummary. Dane przez scoped task/register/resultEvidenceId; brak wyniku to jawny pusty wynik query, obca lub niespójna korelacja jest odrzucona. Nie zwracać surowych logów/sekretów ani rozszerzać ResultManifest v1. Istniejący POST pozostaje bez zmian. Cancel i retry zachowują ACL, aktualny token właściwego rekordu i `retryLastMutation` w kontekście injection.

#### 2. Evidence i nawigacja blockerów

**Files:** `components/report/EvidenceDetailDialog.tsx`, `useReleaseDecision.ts`, `ReleaseDecisionDialog.tsx`, `reportView.ts`, `i18n/*.json` w `delivery_os`.

**Intent:** Pokazać już dostępne source/time/baseline/task/attempt i przetłumaczone blockery 422 z przejściem do właściwej sekcji.

**Contract:** Linki generować z rozpoznanych kodów i scoped refs do AC, skanów, etapu, deploymentu; nie renderować arbitralnych URL z błędu. Nieznany kod ma bezpieczny fallback. 409 wymaga ponownego przeglądu, 428 nie jest sukcesem, niepewny POST wymaga odczytu historii. D1–D3 pozostają jedynym źródłem evidence/kandydata/gates.

#### 3. Regresje rzeczywistego montowania

**Files:** istniejące `backend/delivery/projects/[id]/__tests__/executionHost.test.tsx`, `components/task/__tests__/resultSummary.test.tsx`, nowe testy widgetu i resultQueries; `__integration__/TC-DELIVERY-UI-002.spec.ts`, `TC-DELIVERY-UI-004.spec.ts`, `TC-DELIVERY-UI-008.spec.ts`.

**Intent:** Testować widget razem z hostem oraz browser reload. Poprawić nieaktualny testid UI-002 na rzeczywisty link raportu.

**Contract:** Nie zastępować wszystkich request tests browser testami; zachować oba poziomy. Test wykazuje execute → refetch → Cancel i import → refetch → reload → ten sam wynik, a nie sam render atrapy.

### Success Criteria

#### Automated Verification

- Testy widgetu i hosta oraz browser UI-002/004 potwierdzają execute, refetch, Cancel i trwały wynik po pełnym reload.
- Results GET i testy API odrzucają obcy scope, attempt oraz evidence; pusty wynik i nieznane usage nie stają się PASS ani zerowym kosztem.
- Testy evidence i browser UI-008 potwierdzają provenance, korelację, nazwane linki 422 oraz bezpieczne 409/428 i niepewny POST.
- Celowane Jest core/enterprise, package typechecks, generacja nowej metody API i check:client-boundaries:fail przechodzą według Testing Strategy.

#### Manual Verification

- Adam i Marcin odbierają prawdziwy widget oraz wynik po reload; operator przechodzi z blockera do źródła i rozpoznaje historię oraz aktualną próbę.

## Phase 3: Domknięcie domeny i API procesu

### Overview

Mateusz dostarcza query/routes istniejących komend i powiązanie etapów z wykonawczym baseline. Marcin włącza wspólną ochronę przed efektem zewnętrznym.

### Changes Required

#### 1. F1–F9 przez publiczne HTTP

**Files:** nowe `commands/flowQueries.ts`; `api/projects/[id]/intake/route.ts`, `intake/proposals/route.ts`, `flow/route.ts`, `flow/pin/route.ts`, `stages/[stageId]/artifacts/route.ts`, `stages/[stageId]/decisions/route.ts`; istniejące `commands/intake.ts`, `flow.ts`, `stages.ts`, `reportContext.ts`, `di.ts`, `api/routeSupport.ts` w `delivery_os`.

**Intent:** Udostępnić intake save/resume/proposal, pin/read flow oraz tworzenie, historię i decyzje etapów zgodnie z opublikowanym F1–F9.

**Contract:** Reuse schemas z `lib/contracts.ts`, command bus, encryption helpers, scope i mutation registry. F5 link_instance pozostaje wewnętrzne z trusted token; HTTP nie przyjmuje trustedExecution. StageId musi należeć do przypiętego template. F7 ACL zależy od source. Intake korzysta z własnego updatedAt (na początku project.createdAt), stage mutation z wersji projektu; replay proposal poprzedza lock. Query historii są ograniczone i paginowane. Flow projection pochodzi ze scoped loadera i `lib/flowStatus.ts`, nie z drugiego state machine w UI.

#### 2. Materializacja i immutable binding

**Files:** nowe `commands/flowBaseline.ts`, `lib/flowBaseline.ts`, `api/projects/[id]/flow/baseline/route.ts`; `data/entities.ts`, `data/validators.ts`, `commands/baselines.ts`, migracja i `.snapshot-open-mercato.json` w `delivery_os`.

**Intent:** Z zatwierdzonych Scope i DS/UI zbudować deterministyczny draft v1 z AC→tests i provenance UX/KV, następnie skorzystać z istniejącego freeze i technicznych requirements/design decisions.

**Contract:** Projektowany POST `projects/:id/flow/baseline` materializuje draft i zwraca jego wersję oraz źródłowe refs; nie akceptuje niczego za człowieka. Przy freeze zapisuje append-only `DeliveryFlowBaselineBinding` powiązany z pełnym zestawem refs i template hash. Unikalność obejmuje scope/project/baseline/template/zestaw refs, nie samo baselineId. Reuse tego samego contentHash może dodać kolejny binding bez zmiany starego. Niepełny import z fazy 4 nie może wejść do frozen baseline. Wszystkie edytowalne nowe rekordy mają updated_at/updatedAt; append-only records zachowują audit i scoping.

#### 3. Gate przed ready, reserve i wykonaniem

**Files:** nowe `commands/flowExecutionGate.ts`; `commands/tasks.ts`, `attempts.ts`, `attemptQueries.ts`; w enterprise `delivery_agents/lib/executionBridge.ts`, `workers/execute-task.ts`, `workers/resume-attempt.ts`.

**Intent:** Powstrzymać wykonanie starego lub niezatwierdzonego flow także przez stare endpointy i po opóźnieniu w kolejce.

**Contract:** Wspólny scoped gate wymaga bieżących zgód oraz bindingu przy flow project, a legacy zachowuje dotychczasowe wymagania. Top-level legacy error `baseline_not_approved` otrzymuje etapowe details zgodne ze spec. Replay rezerwacji zachowuje wynik bez nowego efektu. Recheck bezpośrednio przed executor/retry/resume sprawdza currency, snapshot, binding i inne aktywne próby; własna claimed próba nie jest blockerem. Otwarte komentarze blokują zgodę etapu zgodnie z F8, nie są nową niezależną bramką dispatch/publication; późny reply sam nie cofa zgody.

### Success Criteria

#### Automated Verification

- FLOW-01/02 API oraz testy flow routes pokrywają F1–F9, ACL według source, dwa scope, optimistic lock, proposal replay i brak publicznego F5.
- Testy flowBaseline potwierdzają deterministyczny draft, AC→tests, brak fabrykowanych zgód i dwa immutable bindingi przy identycznym contentHash.
- Testy ready/reserve/worker i FLOW-09 odrzucają stale lub brak bindingu przed efektem, zachowują replay i dopuszczają własną claimed próbę.
- Migracje i snapshot mają wyłącznie zamierzoną addytywną deltę; celowane testy core/enterprise, typechecks i generate przechodzą, a migracja jest sprawdzona w autoryzowanym środowisku testowym.

#### Manual Verification

- Mateusz przekazuje Adamowi i Marcinowi działające API oraz demonstrację odrzucenia starej zgody przez HTTP i worker; legacy projekt pozostaje wykonywalny bez nowego bindingu.

## Phase 4: Portfolio, wizard i review etapów

### Overview

Adam łączy użytkową ścieżkę z fazą 3, Marcin dostarcza propose-only Scope, Mateusz trwałą sesję importu. Pełny feedback gate jest odbierany po fazie 5.

### Changes Required

#### 1. Przegląd, wizard i Scope

**Files:** `delivery_os/components/projects/DeliveryProjectListClient.tsx`, `DeliveryProjectForm.tsx`, `backend/delivery/projects/create/page.tsx`, `backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx`; nowe `components/intake/BriefWizard.tsx`, `ScopingConversation.tsx`, `components/detail/ProjectOverview.tsx`; w enterprise `delivery_agents/ai-agents.ts`, `ai-tools.ts` i testy Scope.

**Intent:** Lista i domyślny przegląd pokazują etap, decyzję, blockery i nextAction z backendu. Wizard zapisuje krok i dane; rozmowa Scope kończy się propozycją do przeglądu.

**Contract:** Używać F1–F3/F6. Agent jest typowany, propose-only, używa istniejącego runtime AI, scoped danych i `intake.import_proposal`; nie zatwierdza Scope ani nie dispatchuje wykonania. OSS-only oferuje ręczne opracowanie/import propozycji. W demo profil WP jest preselektowany, a człowiek potwierdza narzędzia w Scope; v1 targetProfile nie jest potajemnie mutowany przy innej rekomendacji. Niedostępny provider nie jest pozornie wybieralny. Refresh nie uruchamia agenta ponownie.

#### 2. Osobne etapy i decyzje

**Files:** nowe `delivery_os/components/stages/StageReview.tsx`, `StageHistory.tsx`; istniejące `components/detail/DesignSection.tsx`, `ScreenComments.tsx`, `BaselinePanel.tsx`, `FreezeBaselineAction.tsx`, `i18n/*.json`.

**Intent:** Przeglądać aktualne i historyczne Scope/UX/KV/DS/UI, odrzucać z powodem i udzielać osobnej zgody na konkretną wersję.

**Contract:** Operator zapisuje rzeczywistą decyzję klienta z osobą i dowodem; brak portalu nie oznacza automatycznej zgody. UI pokazuje dependency refs/hash, stale status i wymagane poprawki. Draft screens są widoczne i komentowalne przed freeze; read-only historia nie oferuje mutacji. Technical baseline approvals pozostają jawne. Dla mutacji pobrać token właściwego agregatu, użyć CrudForm lub guarded mutation i surfaceRecordConflict; Cmd/Ctrl+Enter submit, Escape cancel.

#### 3. Trwały wieloekranowy DesignManifest

**Files:** `components/detail/ScreenImportDialog.tsx`, `screenUpload.ts`; nowe `commands/designImports.ts`, `designImportQueries.ts`, `lib/designImportContracts.ts`, `api/projects/[id]/design-imports/route.ts`, `design-imports/[importId]/route.ts`; `data/entities.ts`, `data/validators.ts`, encryption metadata, migracja/snapshot i `di.ts` w `delivery_os`.

**Intent:** Podłączyć istniejący mapManifestScreens, powiązać wszystkie pliki i umożliwić partial → reload → retry bez utraty udanych uploadów.

**Contract:** Projektowane GET/POST collection i GET/PUT detail sesji mają osobny schemaVersion. `DeliveryDesignImportSession` przechowuje scope/project, manifestHash, expected screen keys, wybraną wersję, zweryfikowane attachment refs/hash, wyniki/błędy i updatedAt. Klucz sesji/importu obejmuje manifestHash; screen key obejmuje fileKey/nodeId/viewport/version. Zapis jest idempotentny i używa tokenu sesji. Serwer weryfikuje załącznik i bytes/hash; klient nie ustawia dowolnego complete. Braki blokują complete i freeze zależnego draftu. Historia zachowuje wersje, draft wybiera jedną na fileKey/nodeId/viewport, zgodnie z v1. Nowy manifest to nowa sesja; anulowanie nie usuwa po cichu udanych plików. Dotychczasowy pojedynczy upload pozostaje wspierany.

### Success Criteria

#### Automated Verification

- FLOW-01 browser potwierdza zapis i wznowienie wizarda, propozycję agenta, ręczną ścieżkę OSS-only, wybór narzędzi i przegląd z nextAction.
- FLOW-02/09 oraz browser stage review potwierdzają osobne decyzje, client proof, odrzucenie, stale upstream i review draftu przed freeze.
- Testy designImports i browser UI-003 potwierdzają partial, reload, retry, 409 sesji, brak complete/freeze przy brakach i bezkolizyjne file/node/viewport/version.
- Nowe API/islands mają self-contained integracje, hydration i keyboard smoke; celowane Jest, typechecks, generate, i18n oraz client-boundaries przechodzą.

#### Manual Verification

- Adam, Mateusz i Marcin odbierają wizard, Scope, osobne review i częściowy import; Adam przekazuje Michałowi zatwierdzony format tokenów oraz mapę edycji WP.

## Phase 5: Figma do staff Kanbana

### Overview

Adam dostarcza provider i sync UI, Mateusz domenę oraz trwałe recovery. Kanban pozostaje własnością staff, a decyzje własnością Delivery.

### Changes Required

#### 1. Dedykowany provider

**Files:** nowe `packages/delivery-figma/package.json`, `src/modules/delivery_figma/{index.ts,di.ts,integration.ts,acl.ts}`, `lib/commentTransport.ts`, `lib/commentSync.ts`, `api/sync/route.ts`; w `delivery_os` nowy `components/stages/FigmaSync.tsx`.

**Intent:** Pobierać rzeczywiste komentarze/odpowiedzi z uprawnionego pliku, normalizować do commentImportBatchV1 i wywoływać publiczne komendy domenowe.

**Contract:** Credential refs, szyfrowanie, tenant/org, ACL połączenia i allowlisted powiązanie pliku przez framework integrations. Transport jest serwerowy, z paginacją, timeout/backoff i wznowieniem; UI pokazuje cursor, postęp i błąd. Sesja Figma write nie dowodzi dostępu do komentarzy. Brak pewnej wersji pozostaje jawny; import nie przypina uwagi do najnowszego snapshotu na podstawie domysłu. Bez globalnego SDK i bez sekretów w kontekście workflow/agenta.

#### 2. F10–F13 i recovery po efekcie Staff

**Files:** nowe `delivery_os/commands/staffLinks.ts`, `commentImports.ts`, `commentQueries.ts`, `commentTriage.ts`; F10–F13 pod `api/projects/[id]/`; `data/entities.ts`, validators, encryption metadata, migracja/snapshot; istniejące `staff/commands/timesheets-tasks.ts`, `timesheets-task-comments.ts` i nowy staff-owned rejestr idempotencji.

**Intent:** Utrwalać link projektu, mapowanie wątku→karta i reply→komentarz, historię zmian, cursor oraz retry bez duplikacji także po crash.

**Contract:** Delivery zapisuje durable import intent przed efektem. Staff public create commands otrzymują addytywny opcjonalny idempotency key; Staff zapisuje klucz→utworzony rekord atomowo w swojej transakcji i odtwarza rezultat przy replay. Klucz obejmuje tenant/org, projekt Delivery, fileKey, threadId i dla odpowiedzi commentId; konflikt payloadu nie tworzy drugiego rekordu. Delivery odzyskuje mapping po tym samym kluczu, dopiero potem przesuwa cursor. Dotychczasowi callerzy bez klucza zachowują działanie. Bez importu staff entities w Delivery i bez bezpośrednich ORM relationships. Brak staff daje jawny dependency error; synchronizacja nie udaje sukcesu.

#### 3. Triage, odroczenia i native UI

**Files:** `delivery_os/commands/stages.ts`; nowe widgety `delivery_figma/widgets/injection/` i `widgets/injection-table.ts`; odpowiednie locale.

**Intent:** Zastąpić stuby prawdziwymi scoped odczytami wątków i zapisami hash-bound deferrals oraz pokazać link, etap i snapshot na karcie staff.

**Contract:** Reuse `staff.time_task.board:card-badges`, `staff.time_task.board:card-footer`, `detail:staff:staff_time_task:header`. Późna odpowiedź/reopen wraca do triage; source delete zachowuje audyt. Done/resolve nie aprobuje etapu ani DeliveryTask. Otwarte blokujące uwagi wymagają rozstrzygnięcia lub jawnego odroczenia dla zatwierdzanej wersji. Triage używa własnego updatedAt. Nie zmieniać v1 przez dopisywanie AC refs do design screen ani traktować pustego collectArtifactAcReferences jako nowego wymagania.

### Success Criteria

#### Automated Verification

- FLOW-03 i testy provider/Staff pokrywają thread/reply create, edit, delete, duplicate, parallel oraz crash między utworzeniem rekordu Staff a mappingiem Delivery bez duplikatów.
- FLOW-04 potwierdza hash-bound deferral, realny approval loader, Done bez approval, późny reply, obce IDs i 409 triage.
- Testy sync obejmują brak dostępu/provider/staff, paginację, retry/backoff i bezpieczne logi; celowane testy core/provider, typechecks, generate i browser hydration przechodzą.

#### Manual Verification

- Adam i Mateusz pokazują rzeczywisty komentarz i odpowiedź Figmy jako jedną kartę i komentarz Staff, retry bez duplikacji, źródłowy link i zgodę z prawdziwym triage.

## Phase 6: Wersjonowany proces w Workflows Studio

### Overview

Marcin dostarcza publiczne API wersji i instancję projektu, Adam ustawienia. Istniejący Studio jest miejscem edycji grafu, nie załącznikiem graficznym.

### Changes Required

#### 1. Publiczny exact-version/publish service

**Files:** `packages/core/src/modules/workflows/di.ts`, nowe `lib/published-definition-service.ts`; istniejące `api/definitions/[id]/publish/route.ts`, `api/definitions/[id]/route.ts`, `lib/definition-edit-safety.ts`, `lib/owned-definition.ts`, `lib/find-definition.ts` i ich testy.

**Intent:** Udostępnić opcjonalnemu providerowi scoped odczyt dokładnej opublikowanej wersji oraz bezpieczną publikację przez tę samą ścieżkę co Studio.

**Contract:** Nowy publiczny service zachowuje auth, publisher grant reauthorization, per-version principal, mutation guards, walidację i event publikacji. Exact-version lookup nie zastępuje żądanej wersji latest ani fallbackiem kodowym ignorującym version. Dla definicji oznaczonych immutable policy Delivery każdy semantyczny zapis (graf, conditions, tools/config, triggers, approvals) po publikacji wymaga nowego draft/version, nawet bez aktywnej instancji. Ochrona obejmuje route, owned upsert i programmatic publish; ustawienie policy nie jest dowolnie usuwalne przez update. Legacy Workflows zachowuje obecną politykę. Concurrent publish jest serializowany i nie zmienia opublikowanego wiersza.

#### 2. Opcjonalny provider, settings i workflow projektu

**Files:** nowe `packages/delivery-workflows/package.json`, `src/modules/delivery_workflows/{index.ts,di.ts,acl.ts,setup.ts}`, `lib/flowTemplateProvider.ts`, `lib/projectWorkflow.ts`, `data/entities.ts`, migracja/snapshot, `api/settings/route.ts`, `backend/settings/delivery-flow/page.tsx`, `components/FlowSettings.tsx`; istniejące `delivery_os/commands/flow.ts`.

**Intent:** Wybrać domyślną wersję, otworzyć ją w Studio i przypiąć nowy projekt do snapshot/hash oraz trwałej instancji projektu.

**Contract:** Provider implementuje istniejące getTemplate(id, version) w scoped DI, bez mutable tenant singleton. Settings GET/PUT używa ACL i własnego updatedAt. Nowe projekty przypinają opublikowaną wersję domyślną; brak pluginu zachowuje built-in OSS fallback. Start przez publiczny workflowExecutor z dokładną wersją; link_instance pozostaje trusted/internal i idempotentne. Projekt i próba mają osobne workflow instance refs. Wszystkie przejścia czekające na decyzję są trwałe; reload/restart nie uruchamia wykonawcy drugi raz. Cofnięcie default dotyczy tylko nowych projektów.

#### 3. Rzeczywista edycja i walidacja semantyki

**Files:** istniejące Workflows Studio komponenty edycji definicji i nowy delivery_workflows template mapper/validator; test `TC-DELIVERY-FLOW-05-template-versioning.spec.ts`.

**Intent:** Umożliwić zmianę kolejności dozwolonych etapów, dodatkowego review, narzędzi, osób i conditions oraz publikację v2.

**Contract:** Mapper serializuje pełną semantykę do immutable template/hash; walidator nie dopuszcza obejścia obowiązkowych server gates, scope ani zgody publikacji. Odsyłać do natywnej route Studio; nie importować całego edytora do globalnego bootstrap ani tworzyć drugiej kopii grafu.

### Success Criteria

#### Automated Verification

- Testy public service i istniejącej publish route zachowują autoryzację/grants, dokładną wersję, concurrent publish i brak zmian legacy Workflows.
- FLOW-05 browser dowodzi edycji grafu oraz condition/tool/approval policy, publikacji v2 i zachowania semantyki v1 także po restarcie i zakończeniu instancji.
- Testy provider/settings/project workflow obejmują dwa scope, 409, brak pluginu/enterprise, idempotentny start/link oraz osobny workflow próby; typechecks, generate i client-boundaries przechodzą.

#### Manual Verification

- Marcin i Adam odbierają ustawienia oraz edytowalny Studio: stary projekt pozostaje na v1, nowy używa v2, a backend nadal blokuje wykonanie bez wymaganych zgód.

## Phase 7: WordPress i przekazanie designu

### Overview

Michał i Marcin domykają realne WP wykonanie i publikację. Adam przekazuje zatwierdzone tokeny oraz mapę edycji; Mateusz zapisuje wynik przez F14 i istniejące gates.

### Changes Required

#### 1. Design handoff, motyw i edycja

**Files:** `packages/delivery-wordpress/src/{scaffold.ts,tools.ts,contracts.ts}`; nowe `designTokens.ts`, `themeBuild.ts`, `plugins.ts`, `redeployPreservation.ts`; artefakty pod `hackathon/delivery-demo/evidence/` indeksowane przez QA.

**Intent:** Generować natywny motyw WP z zaakceptowanego DS, pełną edytowalnością i bezpiecznym redeploy.

**Contract:** Handoff zawiera file/node/version/hash, semantyczne tokeny oraz ekran/sekcja → blok/pole → miejsce edycji → tłumaczenie → test. Jedno deterministyczne mapowanie zasila theme.json i Tailwind; brakujące wartości są oznaczone i zatwierdzone. Natywne core blocks/patterns/parts, mały bootstrap functions.php i moduły inc; business data w wtyczce projektu. Tailwind kompiluje pełne klasy w PHP/HTML/JS, bez runtime CDN; CSS modułowy/BEM, natywne enqueue, zgodność edytora/Preflight. Yoast SEO, ACF Pro i Polylang są aktywne/skonfigurowane idempotentnie, zgodnie z readiness. Redaktor edytuje treść, media/alt, CTA, sekcje, header/footer/menu, ACF, SEO i dwa języki bez kodu/builda. Regeneracja nie nadpisuje treści, Global Styles ani zapisanych szablonów; pokazuje diff i wymaga decyzji konfliktu.

#### 2. Realny host wykonania, kontrole i poprawka

**Files:** nowe `delivery-wordpress/src/execution.ts`; istniejące `runner.ts`, `ownership.ts`, `snapshot.ts`, `tools.ts`; w enterprise `delivery_agents/lib/executionBridge.ts`, `cezarExecutor.ts`, `resultAcceptance.ts`, `workers/execute-task.ts`, `resume-attempt.ts`.

**Intent:** Przejść OM → dozwolony host/runner → zmiana WP → snapshot i kontrole → ResultManifest → review → poprawka.

**Contract:** Zachować task/attempt/baseline/sourceRevision i binding, scope stanowiska, allowed paths, idempotencję create/run/reconcile oraz gate przed efektem. ToolCheck dostępności nie staje się ResultCheck produktu. WP snapshot nie otrzymuje fikcyjnego git SHA; automatic/manual_handoff i unknown usage pozostają jawne. Review i rzeczywista poprawka wymagają nowych dowodów końcowej rewizji.

#### 3. F14, publish i URL verify

**Files:** nowe `delivery_os/commands/publications.ts`, `api/projects/[id]/publications/route.ts`; istniejące `commands/publicationGate.ts`, report/candidate APIs; nowe `delivery-wordpress/src/publication.ts`, `publicationVerification.ts`.

**Intent:** Po zgodzie konkretnego kandydata opublikować na uprawniony target, zweryfikować rezultat i osobno odebrać release.

**Contract:** F14 GET/POST wykorzystuje publikowany publicationResultV1, wspólny publicationGate i istniejące deployment evidence; nie jest samym uploadem. Adapter publish ma target allowlist, zatwierdzoną rewizję/snapshot, trwałą korelację i reconcile przy timeout. Verify sprawdza docelowy URL i tożsamość wdrożonego wyniku, zapisując dowody; upload succeeded bez verify nie daje release PASS. Nieaktualny candidate lub consent wstrzymuje nowy efekt. Retry po niepewnym uploadzie odczytuje stan celu, nie publikuje w ciemno. Celu i credential refs dostarcza readiness; implementacja nie zakłada produkcyjnego dostępu.

### Success Criteria

#### Automated Verification

- Node testy themeBuild/designTokens/plugins/redeployPreservation oraz istniejące scaffold/tools/snapshot przechodzą: deterministyczne tokeny, build, idempotentne wtyczki i ochrona treści.
- FLOW-06 pokrywa kontrolowany pełny host-run-result-review-correction oraz retry/reconcile z właściwym task/attempt/baseline/snapshot.
- FLOW-07 API i browser deploy/release pokrywają F14, pinned flow, obcy target/scope/ACL, stale candidate, niepewny POST i verify wymagane przed release.
- Testy i typecheck delivery-wordpress, celowane core/enterprise, generate oraz testy edycji i redeploy w autoryzowanym środowisku WP przechodzą z zapisanymi wynikami.

#### Manual Verification

- Michał i Adam odbierają WP-01…05 jako redaktor na desktop/mobile: pełna edycja, dwa języki, zgodność DS i zachowanie zmian po redeploy; Marcin pokazuje rzeczywisty run, review i poprawkę.
- Uprawniony operator udziela zgody publikacji właściwej rewizji, Michał publikuje i weryfikuje docelowy URL, a człowiek osobno zapisuje release verdict.

## Phase 8: Końcowa weryfikacja i demo

### Overview

Michał scala wyniki właścicieli na końcowej rewizji platformy. Próba i nowa prezentacja mają różne projekty i własne zgody/dowody.

### Changes Required

#### 1. Regresje i finalny gate

**Files:** `delivery_os/__integration__/TC-DELIVERY-FLOW-08-v1-regression.spec.ts`, `TC-DELIVERY-FLOW-09-upstream-change.spec.ts`; istniejące UI-003/004/007/008 i testy EXEC; `../ui-06/handoff.md`.

**Intent:** Uruchomić pełną macierz obu wejść, bezpieczeństwa, wersji i odzyskiwania oraz uporządkowany gate repo.

**Contract:** FROM_DESIGN dochodzi do zatwierdzonego baseline; FROM_BRIEF przechodzi pełny flow WP. Legacy React/OM i OSS-only pozostają wspierane. Testy obejmują dwa tenant/org, rozdzielone/wildcard ACL, stale upstream, unknown/stop_unconfirmed, duplicate callback, restart, manual_handoff, brak skanu, brak verify. Nowe funkcje mają testy z własnych faz; faza 8 nie zastępuje ich pisania. Po poprawce powtórzyć dotknięte kontrole i końcowy gate na finalnej rewizji, nie przenosić PASS ze starszego SHA.

#### 2. Próba, prezentacja i kanoniczne evidence

**Files:** `../ui-06/rehearsal.md`, `demo-scenario.md`, `handoff.md`; nowe `hackathon/delivery-demo/runbook.md`, `acceptance.md`, `evidence-index.md`.

**Intent:** Wykonać mierzoną próbę, następnie nowy pełny design live na projekcie fikcyjnego klienta i zapisać verdict z dowodami.

**Contract:** Sekwencja: nowy brief/save/resume → Scope z agentem i człowiekiem → nowy UX w Figmie → realny thread/reply w Kanbanie → poprawka/zgoda UX → nowy KV/zgoda klienta → nowy DS/UI/zgoda klienta → WP run/review/poprawka → QA edytowalności → zgoda publikacji → URL verify → release. Osobno Studio v2 i FROM_DESIGN. Wydzielone portfolio nie oznacza kasowania istniejących projektów. Przed próbą human readiness gate. Demo nie dziedziczy zgód z próby. Indeks rozdziela SHA platformy, rewizję witryny, template/artefakt/baseline/hash, source, operatora, datę, komendy/exit codes i live/replay/fixture. Not_run/blocked/skip nie są PASS. Odbierający podaje verdict i niespełnione kryteria; QA aktualizuje nadrzędny rejestr wyłącznie na podstawie dowodów.

### Success Criteria

#### Automated Verification

- Pełny gate z agentic.config.json, client-boundaries i TC-DELIVERY przechodzą na końcowej rewizji z zapisanym runnerem, komendami i exit codes.
- FLOW-08/09 i regresje obu wejść, OSS-only, React/OM, scope/ACL, duplicate/restart oraz stale wyników mają wykonane wyniki bez ukrytych skipów.
- Indeks dowodów ma istniejące referencje i sprawdzalne hashe, koreluje właściwy projekt/baseline/rewizję oraz rozdziela próbę, demo, fixture i replay.

#### Manual Verification

- Właściciele i odbierający potwierdzają gotowość przed próbą; pełna próba obu wejść ma pomiary czasu, wyniki i rozstrzygnięte blockery live.
- Nowy UX, KV i DS/UI powstają live od zera, komentarz prowadzi do poprawki, osobne zgody prowadzą do działającego WP i publikacji; replay nie zastępuje prezentacji.
- Odbierający potwierdza FLOW-01…09 i WP-01…05 z końcowym verdict, a QA przekazuje dowody do kanonicznego odbioru bez zaliczania brakujących wymagań.

## Testing Strategy

### Runner i powtarzalność

Wybrać runner raz na sekwencję według `.ai/docs/agent-instructions.md`: `DOCKER_COMPOSE_FILE`, następnie pierwszy działający compose app w opisanej tam kolejności; inaczej local. W Docker `node scripts/docker-exec.mjs X` zastępuje `yarn X`. Sprawdzić i wykorzystać istniejące środowisko `.ai/qa/ephemeral-env.json`; nie zakładać zastosowanych migracji. Zapis wyniku zawiera runner, SHA, komendę, exit code i ograniczenia. Planowanie wykonuje wyłącznie kontrole dokumentów, nie gate aplikacji.

### Kontrole fazowe

```bash
yarn jest --config packages/core/jest.config.cjs --runInBand --testPathPatterns=delivery_os
yarn jest --config packages/enterprise/jest.config.cjs --runInBand --testPathPatterns=delivery_agents
yarn workspace @open-mercato/core typecheck
yarn workspace @open-mercato/enterprise typecheck
yarn workspace @open-mercato/delivery-wordpress test
yarn workspace @open-mercato/delivery-wordpress typecheck
yarn check:client-boundaries:fail
yarn i18n:check-sync
yarn i18n:check-usage
yarn test:integration TC-DELIVERY --list
yarn test:integration TC-DELIVERY
```

W iteracji zawężać Jest przez `--runTestsByPath` do zmienionych testów oraz Playwright przez nazwę odpowiedniego TC. Faza 5 dodaje testy staff, faza 6 workflows do core Jest; nowe pakiety dostarczają własne `test`, `typecheck`, `build` i uruchamiają je przez `yarn workspace @open-mercato/delivery-figma ...` oraz `@open-mercato/delivery-workflows ...`. WP używa node:test na Node 24. Playwright używa `BASE_URL` i repo-native runnera ustawiającego cache mode. Brak pasujących testów z `--list` jest błędem pokrycia, nie zaliczeniem.

Po auto-discovery zmianach uruchomić `yarn generate`; nowe wygenerowane registry/OpenAPI nie są edytowane ręcznie. Kontrola i18n hardcoded/values jest dodatkowo advisory według repo; nie zastępuje obowiązkowych sync/usage. Lint zmienionych plików wykonywać według właściwego pakietu. Package typechecks są powtarzalne; nie używać historycznego pliku tsconfig z /tmp jako dowodu.

### Macierz integracji dostarczanej z funkcją

Testy FLOW są projektowane pod `packages/core/src/modules/delivery_os/__integration__/`; wymagane moduły provider/enterprise deklarować w metadata. Wspólne fixture tworzą własne rekordy przez API i sprzątają wyłącznie własne IDs w finally/teardown.

| Test | Faza dostawy | Kluczowe pokrycie |
|---|---|---|
| TC-DELIVERY-FLOW-01-intake.spec.ts | 3/4 | F1–F3, save/resume, proposal replay, wizard/Scope, frozen platform |
| TC-DELIVERY-FLOW-02-stage-approvals.spec.ts | 3/4, rozszerzenie 5 | F4/F6–F9, osobne zgody, proof, hash, reject, brak bypass przez legacy |
| TC-DELIVERY-FLOW-03-comment-import.spec.ts | 5 | F10–F12, thread/reply, concurrency, cursor i crash recovery |
| TC-DELIVERY-FLOW-04-kanban-approval.spec.ts | 5 | F13/F8, deferral, Done≠approval, foreign IDs, 409 |
| TC-DELIVERY-FLOW-05-template-versioning.spec.ts | 6 | Settings/Studio, pełna semantyka v1/v2 i restart |
| TC-DELIVERY-FLOW-06-wordpress-execution.spec.ts | 7 | OM→host→wynik, review/poprawka, korelacja i retry |
| TC-DELIVERY-FLOW-07-publication.spec.ts | 7 | F14/F15, browser decisions, pinned candidate, publish/verify |
| TC-DELIVERY-FLOW-08-v1-regression.spec.ts | 3, rozszerzenia 4/6/7 | Legacy, OSS-only, dwa scope i ACL, React/OM |
| TC-DELIVERY-FLOW-09-upstream-change.spec.ts | 3, rozszerzenia 4/7 | Stale zgody/wyniki, gate przed efektem, cancel/reconcile |
| UI-002/003/004/007/008 | 2/4/7 | Prawdziwy widget, partial import, reload, metadata, screenshot i decyzje |

Testy komponentów obejmują loading/notFound/error/ready, guarded retry, keyboard, podwójny submit i reset scope. Negatywne API obejmują brak prawa, obcy tenant/org/record/attachment, 409/422/428, błędny hash/wersję i niepewne efekty. CI używa kontrolowanych adapterów; live Figma/WP jest oddzielnym jawnym wykonaniem na uprawnionym stanowisku. WP-04/05 wymaga także edycji jako redaktor i redeploy, nie samego snapshot testu.

### Pełny gate końcowy

```bash
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
yarn check:client-boundaries:fail
yarn test:integration TC-DELIVERY
```

Pierwsze osiem poleceń odpowiada `.ai/agentic.config.json` przy planowaniu. Na wejściu sekwencji ponownie odczytać konfigurację, zachować jej kolejność i zapisać ewentualną zmianę, bez samodzielnego modyfikowania pipeline. Przejście gate nie potwierdza live ani zgód klienta.

## Performance Considerations

Lista ma pageSize 50, maksimum 100. History/results/evidence/komentarze pobierać z ograniczeniami, obrazy i pełne szczegóły na żądanie; nie powiększać baseline o nieograniczony feed komentarzy. Sync przetwarza ograniczone batch i utrwala cursor dopiero po durable wyniku. Jedna pętla polling per widok, backoff i pauza w ukrytej karcie; bez globalnych SDK Figmy/grafu i cache współdzielonego między scope.

Podczas próby zmierzyć czas etapów, oczekiwania na zgody i sync, hydration oraz build/bundle. Plan nie obiecuje niezmierzonego SLA. Readiness określa aktualne limity usług; błędy limitu pozostają widoczne i wznawialne.

## Migration & Backward Compatibility

Zachować `BACKWARD_COMPATIBILITY.md`: FROZEN v1 schemas/imports/events/ACL/spot IDs pozostają; nowe DTO, endpointy, optional Staff idempotency oraz Workflow policy/service są addytywne i opisane w istniejących specach przed kodowaniem. Brak policy nie zmienia zwykłych Workflows, brak idempotency key nie zmienia Staff create. Dane PII intake/komentarzy/client proof mają encryption maps i odczyty helperami.

Nowe tabele: binding, DesignImportSession, staff link/import/thread/reply/cursor/deferral oraz ustawienia/provider mapping i scoped Staff idempotency według własności modułu. Dodać wyłącznie brakujące encje po sprawdzeniu dostaw. Migracje generować i przeglądać z snapshotem; nie aplikować lokalnie bez zgody i nie edytować niepowiązanych migracji. UUID i tenant/organization filters obowiązują wszędzie, bez relacji ORM między modułami. Optymistyczne wersjonowanie dotyczy każdego nowego edytowalnego rekordu i jego update/delete.

Rollout: schema → komendy/gates → API → optional provider → UI. Nowe flow udostępnić do pełnego użycia dopiero z działającymi wymaganymi gates; legacy nie wymaga bindingu. Rollback wycofuje UI/provider lub default dla nowych projektów, zachowując istniejący snapshot, evidence, decyzje i dane. Nie wyłączać backend gate istniejących pinned projektów ani cofać ich przez masową zmianę rekordu. Zewnętrzny niepewny efekt wymaga reconcile, nie usunięcia historii.

## Nakład, ryzyka i warunki operacyjne

Nowa estymata planistyczna: **134–218 osobogodzin aktywnej pracy**, orientacyjnie 6–10 dni roboczych przy czterech właścicielach i sprawnych przekazaniach, bez gwarancji terminu. To szacunek pozostałego zakresu, nie zgoda na budżet; kalibracja w fazie 1 uwzględnia znalezione dostawy, testy i czas gate.

| Faza | Osobogodziny | Główna niewiadoma kosztowa |
|---|---:|---|
| 1 | 6–10 | Readiness i dostawy na innych branchach |
| 2 | 8–14 | Montowanie realnego widgetu i browser regresje |
| 3 | 22–34 | Binding, komendy i race przed efektem |
| 4 | 24–38 | Wizard/Scope i trwały import |
| 5 | 18–30 | API Figmy i recovery między modułami |
| 6 | 20–34 | Immutable semantyka i istniejące Studio |
| 7 | 24–40 | WP host, edycja, wtyczki i target |
| 8 | 12–18 | Gate, poprawki odbiorowe i nowe live demo |

Oczekiwanie na konta/licencje/operatorów i renderowanie live może wydłużyć kalendarz. Brak konkretnego dostępu/targetu jest wynikiem readiness z określoną reakcją, nie nierozstrzygniętym wyborem architektury. Readiness utrwala dokładne wersje WP/wtyczek i sprawdza je w dokumentacji dostawców; nie zakładamy ich zgodności na podstawie tego planu.

| Ryzyko | Reakcja i pozostały koszt |
|---|---|
| Równoległa dostawa zmienia znany brak | Porównać SHA i testy, reuse zmian; różnicę kontraktu rozstrzygnąć przed integracją |
| Figma komentarze niedostępne mimo write | Oddzielny probe; rozwój fixture trwa, live FLOW-03 pozostaje blocked |
| Crash po Staff create | Atomowy scoped idempotency po stronie Staff i durable intent/reconcile Delivery |
| Stary baseline ma identyczny hash treści | Nowy immutable binding pełnych refs, bez nadpisania starego |
| v2 zmienia conditions starego projektu | Delivery-only policy chroni cały published row i wszystkie ścieżki zapisu |
| WP edycje klienta kolidują z designem | Diff i jawna decyzja, test zachowania treści/Global Styles po redeploy |
| Timeout publikacji | Odczyt celu i korelacja; brak verify blokuje release |
| Pełny zakres przekracza estymatę | Nowa estymata i decyzja użytkownika; brak cichego usuwania FLOW/WP |

## References

- [Plan Brief](plan-brief.md), [decyzje](planning-decisions.md), [research](research.md), [uzupełnienie](planning-research.md).
- [Dodatek procesu](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md), [OSS](../../../../../.ai/specs/2026-09-18-delivery-os-hackathon.md), [enterprise](../../../../../.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md).
- [Podział właścicieli](../../flow-handoff/README.md), [UI/Figma](../../flow-handoff/03-adam-ui-figma.md), [UI-06](../ui-06/plan.md), [handoff D1–D3](../ui-06/handoff.md).
- [Nadrzędny plan i odbiór](../../plan.md), `.ai/agentic.config.json`, `.ai/docs/agent-instructions.md`, `.ai/qa/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`.

## Progress

> Stan wykonania tej zmiany. Wszystkie pozycje zaczynają jako pending; closing commit SHA dopisuje implementer. Tytułów nie zmieniać. Odbiór całego produktu pozostaje w nadrzędnym rejestrze QA.

### Phase 1: Uzgodnienie bieżących dostaw i readiness

#### Automated

- [ ] 1.1 Inwentarz SHA i plików oraz kontrola referencji dokumentów potwierdzają mapę istniejących i brakujących dostaw bez odtwarzania D1–D3.
- [ ] 1.2 Kontrakty delty i ledger wskazują request/response, scope, ACL, lock, idempotencję, błędy, testy i właściciela każdego nowego punktu integracji.

#### Manual

- [ ] 1.3 Właściciele potwierdzają przekazanie kontraktów i readiness z dowodami albo nazwanymi blockerami; ustalają operatorów, odbierającego i ponowną estymatę.

### Phase 2: Stabilizacja istniejącego UI

#### Automated

- [ ] 2.1 Testy widgetu i hosta oraz browser UI-002/004 potwierdzają execute, refetch, Cancel i trwały wynik po pełnym reload.
- [ ] 2.2 Results GET i testy API odrzucają obcy scope, attempt oraz evidence; pusty wynik i nieznane usage nie stają się PASS ani zerowym kosztem.
- [ ] 2.3 Testy evidence i browser UI-008 potwierdzają provenance, korelację, nazwane linki 422 oraz bezpieczne 409/428 i niepewny POST.
- [ ] 2.4 Celowane Jest core/enterprise, package typechecks, generacja nowej metody API i check:client-boundaries:fail przechodzą według Testing Strategy.

#### Manual

- [ ] 2.5 Adam i Marcin odbierają prawdziwy widget oraz wynik po reload; operator przechodzi z blockera do źródła i rozpoznaje historię oraz aktualną próbę.

### Phase 3: Domknięcie domeny i API procesu

#### Automated

- [ ] 3.1 FLOW-01/02 API oraz testy flow routes pokrywają F1–F9, ACL według source, dwa scope, optimistic lock, proposal replay i brak publicznego F5.
- [ ] 3.2 Testy flowBaseline potwierdzają deterministyczny draft, AC→tests, brak fabrykowanych zgód i dwa immutable bindingi przy identycznym contentHash.
- [ ] 3.3 Testy ready/reserve/worker i FLOW-09 odrzucają stale lub brak bindingu przed efektem, zachowują replay i dopuszczają własną claimed próbę.
- [ ] 3.4 Migracje i snapshot mają wyłącznie zamierzoną addytywną deltę; celowane testy core/enterprise, typechecks i generate przechodzą, a migracja jest sprawdzona w autoryzowanym środowisku testowym.

#### Manual

- [ ] 3.5 Mateusz przekazuje Adamowi i Marcinowi działające API oraz demonstrację odrzucenia starej zgody przez HTTP i worker; legacy projekt pozostaje wykonywalny bez nowego bindingu.

### Phase 4: Portfolio, wizard i review etapów

#### Automated

- [ ] 4.1 FLOW-01 browser potwierdza zapis i wznowienie wizarda, propozycję agenta, ręczną ścieżkę OSS-only, wybór narzędzi i przegląd z nextAction.
- [ ] 4.2 FLOW-02/09 oraz browser stage review potwierdzają osobne decyzje, client proof, odrzucenie, stale upstream i review draftu przed freeze.
- [ ] 4.3 Testy designImports i browser UI-003 potwierdzają partial, reload, retry, 409 sesji, brak complete/freeze przy brakach i bezkolizyjne file/node/viewport/version.
- [ ] 4.4 Nowe API/islands mają self-contained integracje, hydration i keyboard smoke; celowane Jest, typechecks, generate, i18n oraz client-boundaries przechodzą.

#### Manual

- [ ] 4.5 Adam, Mateusz i Marcin odbierają wizard, Scope, osobne review i częściowy import; Adam przekazuje Michałowi zatwierdzony format tokenów oraz mapę edycji WP.

### Phase 5: Figma do staff Kanbana

#### Automated

- [ ] 5.1 FLOW-03 i testy provider/Staff pokrywają thread/reply create, edit, delete, duplicate, parallel oraz crash między utworzeniem rekordu Staff a mappingiem Delivery bez duplikatów.
- [ ] 5.2 FLOW-04 potwierdza hash-bound deferral, realny approval loader, Done bez approval, późny reply, obce IDs i 409 triage.
- [ ] 5.3 Testy sync obejmują brak dostępu/provider/staff, paginację, retry/backoff i bezpieczne logi; celowane testy core/provider, typechecks, generate i browser hydration przechodzą.

#### Manual

- [ ] 5.4 Adam i Mateusz pokazują rzeczywisty komentarz i odpowiedź Figmy jako jedną kartę i komentarz Staff, retry bez duplikacji, źródłowy link i zgodę z prawdziwym triage.

### Phase 6: Wersjonowany proces w Workflows Studio

#### Automated

- [ ] 6.1 Testy public service i istniejącej publish route zachowują autoryzację/grants, dokładną wersję, concurrent publish i brak zmian legacy Workflows.
- [ ] 6.2 FLOW-05 browser dowodzi edycji grafu oraz condition/tool/approval policy, publikacji v2 i zachowania semantyki v1 także po restarcie i zakończeniu instancji.
- [ ] 6.3 Testy provider/settings/project workflow obejmują dwa scope, 409, brak pluginu/enterprise, idempotentny start/link oraz osobny workflow próby; typechecks, generate i client-boundaries przechodzą.

#### Manual

- [ ] 6.4 Marcin i Adam odbierają ustawienia oraz edytowalny Studio: stary projekt pozostaje na v1, nowy używa v2, a backend nadal blokuje wykonanie bez wymaganych zgód.

### Phase 7: WordPress i przekazanie designu

#### Automated

- [ ] 7.1 Node testy themeBuild/designTokens/plugins/redeployPreservation oraz istniejące scaffold/tools/snapshot przechodzą: deterministyczne tokeny, build, idempotentne wtyczki i ochrona treści.
- [ ] 7.2 FLOW-06 pokrywa kontrolowany pełny host-run-result-review-correction oraz retry/reconcile z właściwym task/attempt/baseline/snapshot.
- [ ] 7.3 FLOW-07 API i browser deploy/release pokrywają F14, pinned flow, obcy target/scope/ACL, stale candidate, niepewny POST i verify wymagane przed release.
- [ ] 7.4 Testy i typecheck delivery-wordpress, celowane core/enterprise, generate oraz testy edycji i redeploy w autoryzowanym środowisku WP przechodzą z zapisanymi wynikami.

#### Manual

- [ ] 7.5 Michał i Adam odbierają WP-01…05 jako redaktor na desktop/mobile: pełna edycja, dwa języki, zgodność DS i zachowanie zmian po redeploy; Marcin pokazuje rzeczywisty run, review i poprawkę.
- [ ] 7.6 Uprawniony operator udziela zgody publikacji właściwej rewizji, Michał publikuje i weryfikuje docelowy URL, a człowiek osobno zapisuje release verdict.

### Phase 8: Końcowa weryfikacja i demo

#### Automated

- [ ] 8.1 Pełny gate z agentic.config.json, client-boundaries i TC-DELIVERY przechodzą na końcowej rewizji z zapisanym runnerem, komendami i exit codes.
- [ ] 8.2 FLOW-08/09 i regresje obu wejść, OSS-only, React/OM, scope/ACL, duplicate/restart oraz stale wyników mają wykonane wyniki bez ukrytych skipów.
- [ ] 8.3 Indeks dowodów ma istniejące referencje i sprawdzalne hashe, koreluje właściwy projekt/baseline/rewizję oraz rozdziela próbę, demo, fixture i replay.

#### Manual

- [ ] 8.4 Właściciele i odbierający potwierdzają gotowość przed próbą; pełna próba obu wejść ma pomiary czasu, wyniki i rozstrzygnięte blockery live.
- [ ] 8.5 Nowy UX, KV i DS/UI powstają live od zera, komentarz prowadzi do poprawki, osobne zgody prowadzą do działającego WP i publikacji; replay nie zastępuje prezentacji.
- [ ] 8.6 Odbierający potwierdza FLOW-01…09 i WP-01…05 z końcowym verdict, a QA przekazuje dowody do kanonicznego odbioru bez zaliczania brakujących wymagań.
