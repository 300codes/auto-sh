# UI-04 — Zadania, wykonanie i ręczne przekazanie — plan wdrożenia

> Strumień: [`../03-design-ui.md`](../03-design-ui.md) (UI-04) · Plan główny: [`../../plan.md`](../../plan.md) (Faza 4)
> Harmonogram: [`../README.md`](../README.md) · Poprzednik: [`../ui-03/handoff.md`](../ui-03/handoff.md)
> Korekta kierunku: [dodatek produktowy](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) — rozliczenie w sekcji „Pozycja wobec korekty kierunku"

## Overview

Operator dostaje w Open Mercato pełną ścieżkę ręcznego wykonania zadania: rezerwuje próbę, eksportuje pakiet dla Cezara, importuje wynik z manifestu, anuluje niepewną próbę i ją uzgadnia. Wszystko na nowym server route detalu zadania, na **już istniejącym** API OSS-04.

Plan buduje wyłącznie **platformę** — UI wykonania w `delivery_os`. Nadzór nad taskiem formularza React, który Cezar generuje w osobnym worktree, jest czynnością operacyjną wykonywaną w oknie H16–H20, a nie fazą tego planu. README mówi wprost, że „dwa taski generowane przez Cezara to demonstracja produktu. Cztery strumienie z tego katalogu budują samą platformę delivery. Ich zależności nie są tym samym grafem" — UI-04 jako jedyne zadanie Fazy 4 tego nie rozdzielało; ten plan rozdziela.

## Current State Analysis

### Zapis strumienia o wejściach jest nieaktualny

Strumień mówi: „**Wejście:** H16 zatwierdzony baseline, domenowe komendy OSS-04 i bridge EXEC-04 dla live" oraz „H16–H17 kończyć integrację UI na fixture; od H17 po przekazaniu komend OSS-04 podłączyć realne wykonanie". README przypisuje przekazanie komend do H17 (`| H17 | OSS-04 → EXEC-04/UI-04 | Realne claim/import/evidence/pending |`).

**To już się stało.** Na gałęzi `feature/design-ui` żyją commity `47ca5acbf0`, `09b5de9882`, `3d93b6af19`, `3a23d593bd`, `c24ac8ba8d`, `f735d5a154`, `1248282335` — czyli komplet OSS-04. Podział okna na „fixture do H17, live od H17" nie ma zastosowania: UI od pierwszej minuty pisze wobec żywych kontraktów. To ta sama sytuacja, którą UI-03 zastał wobec OSS-03.

### Co domena już daje

Endpointy (`/api/delivery_os/…`, błędy w kształcie `{ error, code, details[] }`, mapowanie kod→status w `lib/contracts.ts:24`):

| Endpoint | Plik | ACL | Istotne |
|---|---|---|---|
| `POST /tasks/[id]/attempts` | `api/tasks/[id]/attempts/route.ts:47` | `delivery_os.attempts.manage` | wymagany nagłówek `Idempotency-Key`; body `{ mode: 'manual_handoff', baseRevision }`; zwraca `{attemptId, taskId, baselineId, baselineHash, taskUpdatedAt, packageUrl}` |
| `GET /tasks/[id]/package?attemptId=` | `api/tasks/[id]/package/route.ts:21` | `delivery_os.attempts.manage` | `TaskPackageV1`, read-only, `attemptId` wymagany |
| `POST /tasks/[id]/results` | `api/tasks/[id]/results/route.ts:31` | `delivery_os.results.import` | `{attemptId, manifest}`, cap 8 MB, `source: 'manual'` nadaje route |
| `POST /tasks/[id]/attempts/[attemptId]/cancel` | `.../cancel/route.ts:31` | `delivery_os.attempts.manage` | `{reason?}` ≤2000 zn.; zwraca `state: 'cancel_requested'`, `stopConfirmation: 'stop_unconfirmed'` |
| `POST /tasks/[id]/attempts/[attemptId]/reconcile` | `.../reconcile/route.ts:35` | `delivery_os.attempts.reconcile` | `{resolution, externalEvidence{note, observedAt, externalRunId?}, manifest?}`, cap 8 MB |
| `GET /tasks/[id]` | `api/tasks/[id]/route.ts:22` | `delivery_os.projects.view` | `TaskDto`, także zarchiwizowane |
| `GET /projects/[id]/tasks` | `api/projects/[id]/tasks/route.ts:44` | `delivery_os.projects.view` | `{items, total}`, sort `createdAt asc, id asc`, bez filtrowania i paginacji |

`TaskDto` (`api/serializers.ts:92`) niesie `executionAttempts: ExecutionAttempt[]` oraz `attemptRegisterReadable: boolean` — to **jedyne czytelne źródło rejestru prób**.

`ExecutionAttempt` (`lib/contracts.ts:620`): `attemptId`, `mode`, `state`, `baselineId/Hash`, `baseRevision`, `baseCommit`, `reservedAt`, `claimedAt`, `dispatchedAt`, `workerRef`, `externalRunId`, `workflowRef`, `cancellationRequestedAt`, `stopConfirmation`, `reconciliation`, `resultEvidenceId`, `completionDelivery`, `lastDeliveryError`, `closedAt`, `outcome`.

Enumy, które UI musi nazwać (dokładne wartości): `AttemptState` = `reserved` | `claimed` | `result_received` | `cancel_requested` | `reconciliation_required` | `closed` (`contracts.ts:597`); `ACTIVE_ATTEMPT_STATES = ['reserved','claimed','cancel_requested']` (`:607`); `ReconciliationResolution` = `not_started` | `stopped` | `completed` | `unknown` (`:609`); `stopConfirmation` = `stop_unconfirmed` | `stopped` | `null` (`:639`); `outcome` = `result_accepted` | `cancelled` | `not_started` | `stopped` | `null` (`:646`); `DeliveryEvidenceSource` = `adapter` | `manual` (`data/entities.ts:14`); `CheckStatus` = `passed` | `failed` | `not_run` (`:370`); `TaskStatus` = `draft` | `ready` | `executing` | `awaiting_review` | `changes_requested` | `verified` | `blocked` | `cancelled` (`:147`). `MAX_EXECUTION_ATTEMPTS = 16` (`:20`), jedna aktywna próba (`:657`).

ACL **już zawiera** `delivery_os.attempts.manage` i `delivery_os.attempts.reconcile` (`acl.ts`) — nowych feature'ów nie dodajemy.

Fixture (`lib/fixtures/index.ts:59`): `task-package.v1.json`, `result-manifest.v1.json`, `reserve-response.v1.json`, `error-body.v1.json` plus katalog `negative/` ze stage'ami `['schema','profile','correlation','dag','idempotency','proposal','acceptance']` — m.in. `result-manifest.foreign-task`, `.foreign-attempt`, `.unknown-test`, `.status-skipped`, `.path-escape`, `reserve.duplicate-key`, `reserve.automatic-mode`.

### Czego domena nie daje

1. **Brak `GET` dla listy evidence.** `api/projects/[id]/evidence/route.ts` ma wyłącznie `POST`. `EvidenceSection.tsx` już dziś jawnie o tym mówi (`i18n/en.json:177`).
2. **Brak odczytu manifestu po `evidenceId`** — `checks`, `findings`, `changedPaths` i `usage` są zapisywane, ale nie są wystawione do odczytu.
3. **Brak `GET /tasks/[id]/attempts`** — rejestr czyta się tylko przez `TaskDto`.
4. **Brak filtrowania i paginacji** listy zadań.

### Czego UI nie ma

`TasksSection.tsx` (160 LOC) to lista read-only: tytuł, `StatusBadge`, badge blocked/reconciliation z `project.attention`, `acIds`, `attemptNumber` i **liczba** prób (`AttemptRegister:40`). **Zero akcji.** Nie istnieje żaden route zadania. Nie ma dialogu importu wyniku ani żadnej prezentacji `AttemptState`, `stop_unconfirmed`, `unknown`, `usage`, `manual`/`adapter`.

`DeliveryProjectDetailClient.tsx` ma **335 LOC** — już łamie limit 300 z Frontend Architecture Contract — i gatuje tylko trzy feature'y (`:42`), bez `attempts.*`.

`i18n/*.json`: 5 locale × 266 kluczy, parytet utrzymany, klucze płaskie i sortowane. Istnieje `delivery_os.project.sections.tasks.*` i komplet `delivery_os.audit.attempts.*`. **Brak** kluczy rezerwacji, eksportu, importu wyniku, cancel, reconcile, stanów próby, usage i źródła.

### Środowisko

Baza `open-mercato` nie ma tabel `delivery_*`, `users` jest pusta, serwer dev nie działa, a `AGENTS.md` zabrania `db:migrate` i `initialize` bez osobnej zgody. Stan identyczny jak przy UI-03.

## Desired End State

Operator otwiera zadanie ze statusem `ready`. Widzi rejestr prób: pusty albo z historią ze znacznikami czasu. Klika rezerwację, dostaje `attemptId` i pakiet `TaskPackageV1` — kopiuje go do schowka albo pobiera plik. Uruchamia Cezara poza systemem. Wraca, wkleja `ResultManifest v1`, widzi podgląd z `checks` w trzech stanach, `changedPaths`, `findings`, źródłem `manual` i usage — albo jawnym `unknown`, gdy manifest tak deklaruje. Import przechodzi, status zadania się zmienia.

Na drugim zadaniu operator anuluje próbę. UI mówi, że **zażądano zatrzymania, a zatrzymanie nie jest potwierdzone**, i wskazuje uzgodnienie jako drogę domknięcia. Operator wybiera jedno z czterech rozstrzygnięć; `completed` wymaga manifestu, pozostałe notatki i czasu obserwacji. Dwa zadania mają jednocześnie aktywne próby o nakładających się przedziałach `reservedAt → closedAt` — widać to w obu rejestrach.

Każdy nieudany import wskazuje pole. `409 attempt_active`, `409 idempotency_conflict` i `409 optimistic_lock_conflict` dają trzy różne komunikaty. Żaden błąd nie kończy się cichym sukcesem, żaden brak danych nie udaje wyniku.

### Key Discoveries

- **API OSS-04 jest gotowe na tej gałęzi** — `3a23d593bd`, `f735d5a154` i pięć innych commitów. Podział okna „fixture do H17" nie ma zastosowania.
- **ACL ma już oba feature'y wykonania** (`acl.ts`) — brakuje wyłącznie gatingu w UI.
- **`usage` nie jest odczytywalne po zapisie** — żyje w `ResultManifestV1.usage` (`contracts.ts:445`) zapisanym jako evidence, a modułu nie ma jak o nie zapytać.
- **Host detalu już łamie limit LOC** (335) — plan musi go dotknąć, więc go naprawia.
- **Rejestr prób może być nieczytelny** — `attemptRegisterReadable: false` jest osobnym, nazwanym stanem, nie brakiem prób.
- **Domena dopuszcza jedną aktywną próbę i 16 łącznie** — UI musi rozróżnić „już trwa" od „wyczerpano limit".

## What We're NOT Doing

- **Nadzoru nad taskiem React jako fazy planu.** Spawn, review i poprawka tasku formularza to czynność operacyjna w oknie; kryteria 4.4 i 4.5 są współodbiorem, a nie deliverable'em tego dokumentu.
- **Endpointów `GET` dla evidence, manifestu i rejestru prób** — `api/` należy do OSS. Plan je zamawia, nie pisze.
- **Filtrowania i paginacji listy zadań** — wymaga zmiany `GET /projects/[id]/tasks`, czyli cudzego pliku.
- **Trybu `automatic`** — `reserveAttemptRequestSchema` (`contracts.ts:688`) dopuszcza z publicznego API wyłącznie `manual_handoff`; tryb automatyczny należy do EXEC-04 i wchodzi przez `trustedExecution`.
- **Osobnego widoku przebiegu obu runów** na wspólnej osi czasu — brak `GET /tasks/[id]/attempts` czyniłby z tego agregację po wszystkich zadaniach po stronie klienta.
- **Ekranu raportu i `EvidenceTable`** — UI-05.
- **Osobnych bramek UX / Key Visual / DS-UI, sync komentarzy Figma → Kanban i ustawień procesu** — pakiet Adama po korekcie kierunku, patrz sekcja niżej.
- **Migracji i inicjalizacji bazy.**
- **Przepisania detalu projektu na server component** — poza oknem.

## Implementation Approach

Nowy server page root `/backend/delivery/projects/[id]/tasks/[taskId]` z nazwanymi client islands, zgodnie z Frontend Architecture Contract z pakietu Adama („Nowe page roots są server-side; osobne client islands"). Akcje wykonania mają własne stany — wciskanie ich w host, który już ma 335 LOC, pogłębiłoby naruszenie, które plan i tak musi naprawić.

Logika parsowania i decyzji żyje w **czystych modułach** (`attemptKey.ts`, `resultImport.ts`, `attemptRegister.ts`), nie w komponentach — ten sam zabieg trzymał `ProposalImportDialog` przy 293 LOC w UI-03.

Wszystkie mutacje przez `apiCall` z nagłówkiem optimistic lock; wersję zadania bierzemy z `taskUpdatedAt` zwracanego przez **każdy** z pięciu endpointów, nie z refetchu — sekwencja demo to kilka mutacji pod rząd.

Klucz idempotencji jest **pochodną** `(taskId, baseRevision, attemptNumber)`: powtórne kliknięcie trafia w istniejącą próbę i zwraca `200` z tym samym `attemptId`, zamiast tworzyć drugą albo generować mylący `409`.

Granica własności: plan pisze w `backend/`, `components/`, `i18n/`, `lib/fixtures/` (pliki własne) i `__integration__/`. **Nie dotyka `api/`, `commands/`, `data/`** — sprawdzane `git status` w każdej fazie.

## Critical Implementation Details

**Kolejność wymuszona przez domenę.** `GET /tasks/[id]/package` wymaga `attemptId`, a `POST /tasks/[id]/results` wymaga `attemptId` — bez rezerwacji nie ma ani pakietu, ani miejsca na wynik. UI ma tę kolejność pokazywać, nie obchodzić: przycisk eksportu i import wyniku są nieaktywne, dopóki nie ma aktywnej próby, z nazwanym powodem.

**`reconciliation_required` nie przyjmuje zwykłego importu.** Próba w tym stanie domyka się wyłącznie przez `reconcile`. Dlatego wariant `completed` musi reużywać tego samego pola manifestu co import wyniku — inaczej operator utyka bez wyjścia.

**Rozłączność trzech konfliktów `409`.** `attempt_active` (trwa inna próba), `idempotency_conflict` (ten sam klucz, inny ładunek) i `optimistic_lock_conflict` (nieaktualna wersja zadania) mają trzy różne przyczyny i trzy różne wyjścia. Trzeci idzie przez `surfaceRecordConflict`; pierwsze dwa mają własne komunikaty. Zlanie ich w jeden komunikat zamienia kontrolę w dekorację — dokładnie błąd, który review UI-02 wytknęło w innym miejscu.

**`attemptRegisterReadable: false` to nie „brak prób".** `serializeTask` (`api/serializers.ts:108`) zwraca pustą tablicę, gdy rejestr się nie parsuje. UI ma trzy rozłączne stany: brak prób, rejestr nieczytelny, rejestr z wpisami. `TasksSection` już to rozróżnia (`i18n` klucz `attempts.unreadable`) — detal zadania musi robić to samo.

**Usage nie przeżywa reloadu.** To świadome ograniczenie wyboru „echo z importu": UI pokazuje usage z manifestu, który właśnie przyjęto, i **mówi wprost**, że trwałego odczytu nie ma. Milczenie w tym miejscu czytałoby się jako „brak usage w wyniku", co jest innym faktem.

## Phase 1: Route detalu zadania, rejestr prób i dekompozycja hosta

### Overview

Powstaje miejsce, w którym mieszka wykonanie, i znika naruszenie limitu LOC w hoście, który plan i tak musi dotknąć. Żadnej mutacji — tylko odczyt i nawigacja.

### Changes Required

#### 1. Nowy server page root detalu zadania

**Files:** `backend/delivery/projects/[id]/tasks/[taskId]/page.tsx`, `.../page.meta.ts`

**Intent:** Dać wykonaniu własny route, żeby akcje i ich stany nie powiększały hosta detalu projektu.

**Contract:** `page.tsx` jest server componentem bez `use client` — przekazuje `params` do client islandu, wzorem `backend/delivery/projects/[id]/page.tsx:1`. `page.meta.ts` z `requireAuth: true`, `requireFeatures: ['delivery_os.projects.view']`, `navHidden: true` i breadcrumbem trzystopniowym: lista projektów → projekt → zadanie. Feature'y wykonania gatują akcje wewnątrz, nie dostęp do strony — operator z samym `projects.view` ma widzieć rejestr prób bez możliwości mutacji.

#### 2. Client island detalu zadania

**File:** `backend/delivery/projects/[id]/tasks/[taskId]/DeliveryTaskDetailClient.tsx`

**Intent:** Złożyć widok zadania z odczytu `GET /tasks/[id]` i utrzymać wersję zadania między mutacjami kolejnych faz.

**Contract:** Czyta `TaskDto` przez `apiCall`. Trzyma `taskUpdatedAt` w stanie i podaje go następnej mutacji — nie refetchuje między akcjami. `LoadingMessage`/`ErrorMessage` z `@open-mercato/ui/backend/detail`. Gatuje akcje na `delivery_os.attempts.manage`, `delivery_os.attempts.reconcile` i `delivery_os.results.import`. Sekcje wykonania montują się w fazach 2–4; w tej fazie plik składa nagłówek zadania (tytuł, status, `statusReason`, `acIds`, `allowedPaths`, `targetProfileId/Version`, `dependsOnTaskIds`) i rejestr prób.

#### 3. Rejestr prób ze znacznikami czasu

**Files:** `components/task/attemptRegister.ts`, `components/task/AttemptRegisterTable.tsx`

**Intent:** Pokazać przebieg każdej próby tak, żeby nakładanie się dwóch runów było odczytywalne wprost.

**Contract:** `attemptRegister.ts` to czysty moduł: sortowanie prób, wyliczenie stanu aktywności z `ACTIVE_ATTEMPT_STATES`, wyliczenie przedziału `reservedAt → closedAt ?? teraz`, rozróżnienie trzech stanów wejścia (brak prób / `attemptRegisterReadable: false` / wpisy). `AttemptRegisterTable.tsx` renderuje wiersz na próbę: numer, tryb, `AttemptState`, `reservedAt`, `claimedAt`, `closedAt`, `workerRef`/`externalRunId`, `outcome`, badge `stop_unconfirmed` i `reconciliation_required`. Wszystkie etykiety z i18n, statusy przez tokeny `{property}-status-{status}-{role}` — bez `text-red-*`.

#### 4. Znacznik aktywnej próby i link na liście zadań

**File:** `components/detail/TasksSection.tsx`

**Intent:** Operator ma widzieć z listy, które zadania mają trwającą próbę, i wejść w zadanie jednym kliknięciem.

**Contract:** Dodać do istniejącego wiersza znacznik aktywnej próby (z `attemptRegister.ts`, ta sama funkcja co w detalu) i link do `/backend/delivery/projects/{projectId}/tasks/{taskId}`. Istniejąca selekcja `onSelectTask` i trzy empty-state'y zostają bez zmian — naprawa F1 z UI-03 nie może się cofnąć.

#### 5. Dekompozycja hosta detalu projektu

**Files:** `backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx`, `components/detail/BaselinePanel.tsx`

**Intent:** Zejść poniżej 300 LOC w pliku, który plan i tak modyfikuje, zamiast pogłębiać istniejące naruszenie.

**Contract:** Wydzielić z hosta spójny blok baseline'ów (pasek wersji, sekcje wymagań i designu, akcje decyzji i zamrożenia wraz z ich stanem) do `BaselinePanel.tsx`. Host zostaje składaczem: pobranie projektu, `projectVersion`, gating feature'ów, `InjectionSpot` wykonania, `selectedTaskId` z `?taskId=`. Zachowanie bez zmian — istniejące testy `sections.test.tsx` i `page.test.tsx` muszą przejść bez modyfikacji asercji. Granica: `wc -l` obu plików poniżej 300.

#### 6. Klucze i18n w pięciu locale

**Files:** `i18n/{en,pl,de,es,ko}.json`

**Intent:** Pokryć nazewnictwo detalu zadania i rejestru prób bez łamania parytetu.

**Contract:** Nowa przestrzeń `delivery_os.task.*`: `title`, `breadcrumb`, `loadError`, `notFound`, sekcja `attempts.*` z etykietami sześciu `AttemptState`, czterech `outcome`, `stopConfirmation.stop_unconfirmed`, `register.{empty,unreadable}` oraz nagłówkami kolumn. Klucze płaskie, sortowane alfabetycznie, dodane **jednocześnie we wszystkich pięciu plikach**. Żadnego stringa w JSX.

### Success Criteria

#### Automated Verification

- Testy modułu `delivery_os` przechodzą, w tym nowe testy `attemptRegister` dla trzech stanów wejścia
- Test `AttemptRegisterTable` renderuje sześć `AttemptState` i badge `stop_unconfirmed` z nazwanymi etykietami
- Test `TasksSection` potwierdza, że znacznik aktywnej próby i link nie cofają naprawy F1 z UI-03
- `DeliveryProjectDetailClient.tsx` i `BaselinePanel.tsx` mają poniżej 300 LOC
- Istniejące testy `sections.test.tsx`, `page.test.tsx` i `executionHost.test.tsx` przechodzą bez zmiany asercji
- `yarn i18n:check-sync`, `yarn i18n:check-usage` i `yarn i18n:check-hardcoded` są czyste
- `yarn typecheck` i `yarn check:client-boundaries` przechodzą; `check:client-boundaries` nie zgłasza nowego client page root
- Granica własności `git status --porcelain -- {api,commands,data}` jest pusta

#### Manual Verification

- Operator wchodzi z listy zadań w detal zadania i wraca breadcrumbem
- Zadanie bez prób, zadanie z historią i zadanie z nieczytelnym rejestrem dają trzy różne komunikaty

**Implementation Note:** Po tej fazie i przed fazą 2 potwierdzić z człowiekiem, że dekompozycja hosta nie zmieniła zachowania sekcji baseline z UI-02/03.

---

## Phase 2: Rezerwacja próby i eksport pakietu

### Overview

Pierwsza mutacja. Kolejność rezerwacja → pakiet jest wymuszona przez domenę i ma być widoczna, nie obchodzona.

### Changes Required

#### 1. Klucz idempotencji

**File:** `components/task/attemptKey.ts`

**Intent:** Sprawić, żeby powtórne kliknięcie rezerwacji trafiało w tę samą próbę zamiast tworzyć drugą albo generować mylący konflikt.

**Contract:** Czysta funkcja `buildAttemptIdempotencyKey({ taskId, baseRevision, attemptNumber })` zwracająca wartość zgodną z `idempotencyKeyHeaderSchema` — regex `^[\x21-\x7E]{1,200}$` (`contracts.ts:172`). Stabilna dla tych samych wejść, różna po zmianie którejkolwiek składowej. Zmiana `baseRevision` daje nowy klucz, więc UI musi pokazać, którą rewizję rezerwuje.

#### 2. Akcja rezerwacji

**File:** `components/task/ReserveAttemptAction.tsx`

**Intent:** Zarezerwować próbę i pokazać jej tożsamość, zanim cokolwiek opuści system.

**Contract:** `POST /api/delivery_os/tasks/{id}/attempts` przez `apiCall`, nagłówek `Idempotency-Key` z `attemptKey.ts`, nagłówek optimistic lock z `taskUpdatedAt`, body `{ mode: 'manual_handoff', baseRevision }`. Pięć rozłącznych wyników: `201` utworzono nową próbę; `200` zwrócono istniejącą (**sukces z własnym komunikatem**, nie cichy); `409 attempt_active` — trwa inna próba, z jej numerem; `409 attempt_limit_reached` — wyczerpano 16 prób; `409 optimistic_lock_conflict` → `surfaceRecordConflict`. `422 task_not_ready` i `409 dependency_not_verified` nazwane przez domenę, nie jako „błąd zapisu". Akcja gated na `delivery_os.attempts.manage`; bez feature'u przycisk nie renderuje się wcale.

#### 3. Panel pakietu

**File:** `components/task/TaskPackagePanel.tsx`

**Intent:** Wydać `TaskPackageV1` w obu realnych układach: CLI na tym samym stanowisku i na innym hoście.

**Contract:** `GET /api/delivery_os/tasks/{id}/package?attemptId={attemptId}` przez `apiCall`. Podgląd pakietu z `baselineId`, `baselineHash`, `baseRevision`, `allowedPaths`, `acIds`, `targetProfile`; kopiowanie do schowka i pobranie pliku `.json`. Bez aktywnej próby panel nie pokazuje pustki, tylko nazwany powód („rezerwacja jest warunkiem eksportu"). Nieudane kopiowanie (brak uprawnień schowka) daje **nazwany** stan, nie ciche przejście — pobranie pliku zostaje dostępne.

#### 4. i18n rezerwacji i eksportu

**Files:** `i18n/{en,pl,de,es,ko}.json`

**Contract:** `delivery_os.task.reserve.*` (etykieta, potwierdzenie, pięć wyników, powód niedostępności) i `delivery_os.task.package.*` (tytuł, kopiowanie, pobranie, brak próby, błąd schowka). Parytet w pięciu plikach.

### Success Criteria

#### Automated Verification

- Testy `attemptKey`: stabilność dla tych samych wejść, zmiana po każdej ze składowych, zgodność z regexem nagłówka
- Test `ReserveAttemptAction` rozróżnia `201`, `200`, `409 attempt_active`, `409 attempt_limit_reached` i `409 optimistic_lock_conflict` — pięć różnych komunikatów
- Test potwierdza, że `200` jest prezentowane jako sukces, a nie jako błąd
- Test `TaskPackagePanel`: brak aktywnej próby daje nazwany powód; nieudane kopiowanie nie ukrywa pobrania
- Test gatingu: bez `delivery_os.attempts.manage` akcja rezerwacji nie renderuje się
- `i18n:check-sync`, `i18n:check-usage`, `i18n:check-hardcoded`, `typecheck` przechodzą; granica własności pusta

#### Manual Verification

- Operator rezerwuje próbę, widzi `attemptId`, kopiuje pakiet i pobiera go jako plik
- Powtórne kliknięcie rezerwacji nie tworzy drugiej próby i mówi, że zwrócono istniejącą

---

## Phase 3: Import wyniku, kontrole i usage

### Overview

Wynik z Cezara wraca do systemu. To miejsce, w którym kryterium 4.6 („rzeczywisty tryb przekazania, brakujące usage") zapada.

### Changes Required

#### 1. Parser manifestu wyniku

**File:** `components/task/resultImport.ts`

**Intent:** Złapać błąd manifestu przy literówce agenta, zanim pójdzie żądanie, i nazwać go polem.

**Contract:** Czyste parsery z rozłącznymi wynikami wejścia: `empty`, `too_large` (limit z `validators.ts:40`), `not_json`, `not_object`, `schema`. Walidacja `resultManifestV1Schema` (`contracts.ts:426`). Kod dostawczy czytany z `params.deliveryCode`, nie z `issue.code` — ten sam wniosek, który UI-03 wyciągnął dla `proposalImport.ts`: `addDeliveryIssue` zgłasza wszystko jako zod `custom`, więc bez tego `path_not_allowed`, `unknown_test_id` i `baseline_mismatch` dostałyby to samo słowo. Podwójna walidacja, nie zastępcza — serwer pozostaje źródłem prawdy.

#### 2. Dialog importu wyniku

**File:** `components/task/ResultImportDialog.tsx`

**Intent:** Przyjąć `ResultManifest v1` wzorem, który już przeszedł w UI-03, z podglądem przed wysyłką.

**Contract:** Wklejenie JSON z licznikiem znaków i limitem, podgląd przed wysłaniem, `Cmd/Ctrl+Enter` zatwierdza, `Escape` anuluje. `POST /api/delivery_os/tasks/{id}/results` z `{attemptId, manifest}`. Rozłączne wyniki: `201` przyjęto; `200 duplicate` **sukces** z własnym komunikatem; `409 result_conflict`; `409 attempt_not_active`; `409 correction_limit_reached`; `409 optimistic_lock_conflict` → `surfaceRecordConflict`; `422` per kod z `RESULT_ACCEPTANCE_CHECKS` (`lib/resultAcceptance.ts:139`); `413 payload_too_large`. `details[]` renderują się jako **lista wszystkich ścieżek**, nie jeden komunikat. Logika parsowania mieszka w `resultImport.ts` — dialog zostaje poniżej 300 LOC.

#### 3. Podgląd wyniku, kontrole i usage

**File:** `components/task/ResultSummary.tsx`

**Intent:** Pokazać, co wynik faktycznie stwierdza, bez zamiany braków w PASS.

**Contract:** `checks[]` w trzech rozłącznych stanach `passed` / `failed` / `not_run` — `not_run` nie jest zielone i nie jest sumowane do przechodzących. `changedPaths[]`, `findings[]`, `artifacts[]` z rozmiarami. Źródło evidence `manual` vs `adapter` nazwane wprost. `usage`: `source` (`runner` | `provider` | `subscription` | `manual`) i wartości — przy literale `'unknown'` komunikat mówi, że **wynik nie podaje zużycia**, a nie że zużycie wynosi zero. Komponent renderuje wyłącznie manifest, który właśnie przyjęto; pod nim stałe zdanie, że trwałego odczytu usage z zapisanego evidence **nie ma** i po odświeżeniu strony ta sekcja znika. Test czyta tę frazę z `i18n/en.json`, żeby usunięcie jej z copy było wykrywalne.

#### 4. i18n importu wyniku

**Files:** `i18n/{en,pl,de,es,ko}.json`

**Contract:** `delivery_os.task.result.*` — etykiety dialogu, osiem wyników odpowiedzi, trzy `CheckStatus`, cztery `usage.source`, `usage.unknown`, `usage.notPersisted`, `source.{manual,adapter}`.

### Success Criteria

#### Automated Verification

- Testy `resultImport` dla pięciu ścieżek wejścia: `empty`, `too_large`, `not_json`, `not_object`, `schema`
- Test rozróżnia kody dostawcze `path_not_allowed`, `unknown_test_id` i `baseline_mismatch` — nie zwija ich do jednego słowa
- Test `ResultImportDialog` rozróżnia `201`, `200 duplicate`, `409 result_conflict`, `409 attempt_not_active` i `422`
- Test potwierdza, że `details[]` renderują się jako lista wszystkich ścieżek
- Test `ResultSummary`: `not_run` nie jest liczone jako przechodzące; `usage: 'unknown'` daje komunikat o braku danych, nie zero
- Test czyta z `i18n/en.json` frazę o braku trwałego odczytu usage
- Testy używają negatywnych fixture'ów `result-manifest.{foreign-task,foreign-attempt,unknown-test,status-skipped,path-escape}`
- `i18n:*`, `typecheck`, `check:client-boundaries` przechodzą; granica własności pusta

#### Manual Verification

- Operator importuje manifest z sesji Cezara i widzi kontrole, zmienione ścieżki i usage
- Powtórny import tego samego manifestu mówi „już przyjęty" i nie tworzy drugiego evidence
- Manifest z `usage: 'unknown'` pokazuje brak danych, a nie zero

---

## Phase 4: Anulowanie, uzgodnienie i spec integracyjny

### Overview

Domknięcie niepewnej próby i wykonywalny scenariusz całej ścieżki. Tu zapada zakaz „obietnicy niepotwierdzonego zatrzymania".

### Changes Required

#### 1. Anulowanie próby

**File:** `components/task/CancelAttemptAction.tsx`

**Intent:** Zażądać zatrzymania i powiedzieć prawdę o tym, czego system nie wie.

**Contract:** `POST /api/delivery_os/tasks/{id}/attempts/{attemptId}/cancel` z `{reason?}` (≤2000 znaków). Odpowiedź niesie `state: 'cancel_requested'` i `stopConfirmation: 'stop_unconfirmed'`. Komunikat mówi, że **zażądano zatrzymania, a zatrzymanie procesu nie jest potwierdzone** — nigdy „anulowano". Próba zostaje widoczna jako aktywna z badge'em `stop_unconfirmed`, a akcja uzgodnienia jest wyeksponowana jako droga domknięcia. Dialog uzgodnienia **nie otwiera się automatycznie** — operator zwykle nie wie jeszcze, czy proces stanął. `409 attempt_not_active` i `409 attempt_closed` mają własne komunikaty.

#### 2. Dialog uzgodnienia

**File:** `components/task/ReconcileAttemptDialog.tsx`

**Intent:** Dać każdej niepewnej próbie rozstrzygnięcie zgodne z tym, co operator faktycznie wie.

**Contract:** `POST /api/delivery_os/tasks/{id}/attempts/{attemptId}/reconcile`. Cztery rozstrzygnięcia z `ReconciliationResolution`: `not_started`, `stopped`, `completed`, `unknown`. Wszystkie wymagają `externalEvidence.note` i `observedAt`, opcjonalnie `externalRunId`. Wariant `completed` dokłada pole manifestu i **reużywa `resultImport.ts`** z fazy 3 — bez tego próba w `reconciliation_required` nie ma jak przyjąć wyniku, który dotarł poza systemem. Brak manifestu przy `completed` blokuje wysyłkę lokalnie (`createCrudFormError`), zanim serwer zwróci `422 manifest_required`. `unknown` nazwane jako **stan nierozstrzygnięty zapisany świadomie**, nie jako porażka. `409 attempt_not_reconcilable` z własnym komunikatem. Akcja gated na `delivery_os.attempts.reconcile`. Walidacja w czystym module, dialog poniżej 300 LOC.

#### 3. Fixture stanów granicznych

**Files:** `lib/fixtures/attempt-register.{active,stop-unconfirmed,reconciliation-required,unreadable}.v1.json`

**Intent:** Dać testom komponentowym rejestry, których dziś nie ma w żadnym fixture.

**Contract:** Rejestry `ExecutionAttempt[]` zgodne z `contracts.ts:620`: próba aktywna z `reservedAt`/`claimedAt`, próba po cancel ze `stopConfirmation: 'stop_unconfirmed'`, próba w `reconciliation_required`, oraz dwie nakładające się próby na dwóch zadaniach. Rejestrowane w `lib/fixtures/index.ts` obok istniejących. Fixture nieparsowalny dla ścieżki `attemptRegisterReadable: false`.

#### 4. i18n anulowania i uzgodnienia

**Files:** `i18n/{en,pl,de,es,ko}.json`

**Contract:** `delivery_os.task.cancel.*` (etykieta, pole powodu, komunikat o niepotwierdzonym zatrzymaniu, dwa konflikty) i `delivery_os.task.reconcile.*` (cztery rozstrzygnięcia z opisami, pola dowodu zewnętrznego, wymóg manifestu, `attempt_not_reconcilable`).

#### 5. Spec integracyjny

**File:** `__integration__/TC-DELIVERY-UI-004.spec.ts`

**Intent:** Zapisać wykonywalny scenariusz całej ścieżki wobec żywych kontraktów, gotowy do pierwszego przebiegu.

**Contract:** Konwencja `TC-DELIVERY-UI-<NNN>` w nazwie pliku i jako prefiks tytułu testu (wzór `TC-DELIVERY-UI-001.spec.ts:9`). Trzy testy: (a) ścieżka pełna — rezerwacja → pakiet → import wyniku → status zadania; (b) ścieżka niepewna — rezerwacja → cancel → `stop_unconfirmed` widoczny → reconcile `unknown` → próba domknięta; (c) ścieżki negatywne — powtórna rezerwacja zwraca tę samą próbę, import na obcym `attemptId` odrzucony, `completed` bez manifestu zablokowane lokalnie. Teardown archiwizuje **własne** projekty po id i kasuje **własne** załączniki — wzorem poprawki F2 z review UI-02. Fixture tworzone w setupie przez API, bez polegania na danych seed.

### Success Criteria

#### Automated Verification

- Test `CancelAttemptAction` potwierdza, że komunikat mówi o żądaniu zatrzymania i braku potwierdzenia — asercja czyta frazę z `i18n/en.json`
- Test potwierdza, że dialog uzgodnienia **nie otwiera się** automatycznie po anulowaniu
- Test `ReconcileAttemptDialog` pokrywa cztery rozstrzygnięcia; `completed` bez manifestu nie wysyła żądania
- Test `409 attempt_not_reconcilable` daje komunikat rozłączny z `attempt_not_active`
- Testy komponentowe konsumują cztery nowe fixture rejestru, w tym ścieżkę nieczytelną
- Test dwóch nakładających się prób potwierdza, że oba rejestry pokazują przedziały jednocześnie aktywne
- `TC-DELIVERY-UI-004` istnieje i przechodzi `typecheck` oraz `npx eslint`; teardown adresuje projekty po id
- Testy modułu `delivery_os` przechodzą w całości; `i18n:*`, `typecheck`, `check:client-boundaries` czyste; granica własności pusta

#### Manual Verification

- Operator anuluje próbę i widzi, że zatrzymanie nie jest potwierdzone; rozumie, że uzgodnienie jest następnym krokiem
- Operator uzgadnia próbę jako `unknown` i widzi ją domkniętą bez fałszywego śladu wykonania
- Operator prowadzi dwa zadania jednocześnie i widzi nakładające się przedziały prób
- Cała ścieżka rezerwacja → pakiet → wynik → poprawka → nowa próba przechodzi na żywej aplikacji

**Implementation Note:** Manualne pozycje wymagają działającej aplikacji z tabelami `delivery_*` i kontem operatora. W obecnym środowisku ich nie wykonamy — patrz „Luki pokrycia".

---

## Pozycja wobec korekty kierunku

Dodatek produktowy z 2026-09-19 wszedł po napisaniu UI-04. Dowód: `03-design-ui.md` był ostatnio zmieniany commitem `add868171a` (09:52), a nota korekty weszła commitem `00907224f1` (11:34) i **nie dotknęła plików `workstreams/01`…`04`**. Rozliczenie jest jawne, żeby nikt nie przeczytał tego planu jako pokrycia bieżących wymagań.

**Co z tego planu zostaje bez zmian.** Mechanika ręcznego przekazania — rezerwacja przed eksportem, pakiet, import manifestu wyniku, cancel ze `stop_unconfirmed`, cztery rozstrzygnięcia uzgodnienia — jest tą samą mechaniką, której będzie potrzebowało wykonanie na WordPressie. FLOW-06 żąda „OM→realne WP→OM, ta sama próba/baseline, snapshot+kontrole, rzeczywista poprawka; bez fikcyjnego PASS": zmienia się executor i treść pakietu, nie kontrakt próby. Rejestr prób, rozłączność trzech konfliktów `409` i zakaz zamiany `not_run` w PASS przenoszą się w całości.

**Co ten plan realizuje w wersji v1.** Wykonanie jest tu prowadzone przez task React generowany przez Cezara. Dodatek stwierdza, że „WordPress jest obowiązkowym E2E tego demo; React nie zastępuje odbioru WP", przy zachowaniu Reacta jako ścieżki kompatybilnej (decyzja 3). Ten plan buduje więc UI wykonania, które jest **konieczne, ale niewystarczające** dla nowego demo.

**Czego ten plan nie pokrywa, a należy do pakietu UI.** To są zadania, nie braki do cichego uzupełnienia — pełna lista w [pakiecie Adama](../../flow-handoff/03-adam-ui-figma.md):

- **F0: osobny probe odczytu komentarzy Figmy** — nadal niewykonany, blokuje FLOW-03. UI-03 wpisał go jako pozycję blokującą; ten plan go nie dotyka.
- **Osobne widoki i bramki UX, Key Visual i DS/UI** z własnymi wersjami i utratą aktualności po zmianie upstream.
- **Provider komentarzy Figma** i karty w **natywnym** Kanbanie `staff`.
- **Wejście „Proces realizacji projektów" w ustawieniach** z edycją w Workflows Studio.
- **Handoff tokenów do WordPressa w F2** i macierz `ekran/sekcja → blok/pole WP`.
- **Wykonanie na realnym WordPressie** — FLOW-06 w pełnym zakresie; domena WP execute/reserve/result nie istnieje, a WP-M01/M02 to osobny budżet.

**Mapowanie na nowe ID odbioru.** Pakiet UI odpowiada za FLOW-01…05, 07 i 09. Ten plan **nie zamyka żadnego z nich samodzielnie**. Wnosi wkład cząstkowy do trzech: **FLOW-06** w części kontraktu próby i zakazu fikcyjnego PASS (ale na Reakcie, nie na WP), **FLOW-09** w części „aktywna próba reconcile" po zmianie Scope/UX/KV/UI, oraz **FLOW-04** w części `409` przy stale edit. `TC-DELIVERY-UI-004` jest spec'em ścieżki v1 i nie zastępuje żadnego FLOW.

**Budżet.** Dodatek stwierdza, że „dotychczasowe harmonogramy 36 h / 87 osobogodzin oraz limit WP 6 h nie są estymatą nowego zakresu", a README zespołu czyni nową estymatę deliverable'em F0. Nominalne **4 h** z `03-design-ui.md` to liczba przeniesiona sprzed korekty. Estymata tego planu: **~8 h** (2 + 1,5 + 2 + 2,5). To wycena **wyłącznie jego zakresu**, nie całego pakietu UI, i nie obejmuje probe'u komentarzy ani listy operacji API uzgodnionej z Mateuszem — te dwa obowiązki F0 pozostają otwarte po UI-03.

## Zgodność z harmonogramem i mapą kryteriów

**Kryteria Progress.** Mapa pokrycia w [README](../README.md) przypisuje UI-04 cztery kryteria — `| 4.3 | EXEC-04, OSS-04, UI-04, QA-04 |`, `| 4.4, 4.5 | OSS-04, UI-04, QA-04 |`, `| 4.6 | EXEC-04, UI-04, QA-04 |` — podczas gdy opis strumienia deklarował trzy (4.3, 4.5–4.6). UI-04 było jedynym zadaniem Fazy 4 z niezgodną deklaracją. **Ten plan deklaruje 4.3–4.6 za README.** Wszystkie cztery są współodbiorem; żadnego nie zaznacza ten plan samodzielnie. Zgodnie z wymogiem README („wyznaczyć jedną osobę zapisującą wynik") zapis w Progress planu głównego wykonuje jedna osoba po dowodach od OSS-04, EXEC-04, UI-04 i QA-04.

**4.4 i 4.5 powstają poza tym planem.** 4.4 („React przechodzi build/typecheck/testy AC, a negatywny fixture wykazuje…") i 4.5 („Review odrzuca konkretny wynik, agent poprawia kod…") materializują się w repo React i w oknie QA-04 (H19–22) oraz przy merge OSS-04 (H20–22). Okno UI-04 kończy się **H20**. Plan dostarcza UI, w którym te zdarzenia są widoczne — dwa runy, findingi z manifestu, nowa próba po poprawce — ale dowód pochodzi z cudzego artefaktu. Kto zbiera ten dowód po H20, wymaga uzgodnienia przed startem.

**`allowedPaths` nie są ustalane przed spawn.** Strumień mówi „podział allowedPaths ustalony przed spawn", ale README umieszcza artefakt „task DAG/allowedPaths" w bramce H16 dostarczanej przez „UI-03 + QA-03 + człowiek", a OSS-03 waliduje „niedozwolone allowedPaths" przy imporcie planu. Podział pochodzi więc z **zatwierdzonego baseline'u**, nie z ad-hoc uzgodnienia. UI je wyłącznie **pokazuje** (nagłówek zadania w fazie 1) i nie ma możliwości ich zmienić.

**Wejścia.** Zapis „realne komendy OSS-04 od H17" jest nieaktualny — patrz Current State Analysis. Plan nie ma podokna fixture.

## Testing Strategy

### Unit / komponentowe

- Czyste moduły: `attemptRegister` (trzy stany wejścia, przedziały czasu, aktywność), `attemptKey` (stabilność, zmienność, regex), `resultImport` (pięć ścieżek wejścia, kody dostawcze).
- Komponenty: rozłączność komunikatów per kod błędu w każdej z pięciu akcji; gating feature'ów; trzy stany `CheckStatus`; `usage: 'unknown'`.
- Regresja: istniejące `sections.test.tsx`, `page.test.tsx`, `executionHost.test.tsx` przechodzą bez zmiany asercji po dekompozycji hosta.

### Integracyjne

`TC-DELIVERY-UI-004` — trzy testy opisane w fazie 4. Napisany wobec żywych kontraktów, przechodzi `typecheck` i `eslint`, **nieuruchomiony** (patrz Luki pokrycia). Samowystarczalny: fixture tworzone przez API w setupie, własne rekordy kasowane w teardownie.

### Manualne

1. Wejść z listy zadań w detal zadania; sprawdzić trzy stany rejestru prób.
2. Zarezerwować próbę, skopiować pakiet i pobrać go jako plik; kliknąć rezerwację drugi raz.
3. Zaimportować manifest wyniku; sprawdzić `not_run`, `usage`, źródło `manual`.
4. Anulować próbę na drugim zadaniu; potwierdzić komunikat o niepotwierdzonym zatrzymaniu.
5. Uzgodnić próbę jako `unknown`, potem drugą jako `completed` z manifestem.
6. Prowadzić dwa zadania jednocześnie; potwierdzić nakładające się przedziały.

## Bramka walidacji

**Decyzja użytkownika: `yarn test`, `yarn lint` i `yarn build:app` pozostają pominięte**, tak samo jak w UI-03. Uruchamiany zestaw na każdej fazie:

```bash
yarn workspace @open-mercato/core test --testPathPatterns='delivery_os'
yarn i18n:check-sync && yarn i18n:check-usage && yarn i18n:check-hardcoded
yarn typecheck
yarn check:client-boundaries
npx eslint <zmienione pliki>
git status --porcelain -- packages/core/src/modules/delivery_os/{api,commands,data}
```

Runner ustalany raz na sekwencję: tryb Docker, gdy compose wystawia kontener `app`, w przeciwnym razie local. Przy UI-03 zastosowanie miał **local** — `docker ps` pokazywał tylko `mercato-postgres` i `mercato-meilisearch`.

To jest **świadome ograniczenie dowodu**, nie pełna bramka. Faza 1 rusza `DeliveryProjectDetailClient.tsx` — zatwierdzony kod UI-02/03 — a regresji w cudzych sekcjach nie wykryje ani test modułu, ani `typecheck`. Testy regresji wymienione w kryteriach fazy 1 są jedynym zabezpieczeniem tego miejsca.

## Luki pokrycia — czego ten plan nie udowodni

1. **`TC-DELIVERY-UI-004` nie zostanie uruchomiony.** Baza nie ma tabel `delivery_*`, `users` jest pusta, serwer dev nie działa, a `db:migrate`/`initialize` wymagają osobnej zgody. Świadoma decyzja, nie przeoczenie.
2. **Żadna kontrola ręczna nie zostanie wykonana** — pozycje Manual w Progress pozostają niezaznaczone.
3. **Pełna bramka repo nie zostanie uruchomiona** — `yarn test`, `yarn lint` i `yarn build:app` pominięte na polecenie użytkownika. Kto wznawia bramkę, zaczyna od tych trzech komend.
4. **Usage nie ma trwałego odczytu.** UI pokazuje je wyłącznie z manifestu przyjętego w bieżącej sesji i mówi o tym wprost. Kryterium 4.6 w części „brakujące usage" jest pokryte dla świeżego importu, nie dla historii.
5. **Nakładanie się dwóch runów jest dowodem obserwacyjnym.** Twardy dowód 4.3 leży w testach OSS-04/EXEC-04.
6. **Pobranie pliku i schowek nie zostaną sprawdzone w realnej przeglądarce** — testy komponentowe działają w jsdom.

## Prośby do OSS

1. **`GET /projects/[id]/evidence`** — lista evidence z filtrem po `taskId` i `kind`. Bez niej `EvidenceSection` i `ResultSummary` nie mają historii, a usage znika po reloadzie. To ta sama prośba, którą UI-03 zgłosił jako otwartą.
2. **Odczyt `result_manifest` po `evidenceId`** — `checks`, `findings`, `changedPaths` i `usage` są zapisywane, ale nieodczytywalne. Bez tego raport UI-05 też będzie miał problem.
3. **`GET /tasks/[id]/attempts`** — dziś rejestr przychodzi tylko w `TaskDto`, więc odświeżenie stanu próby wymaga pobrania całego zadania.
4. **Filtrowanie i paginacja `GET /projects/[id]/tasks`** — `status`, `search`, `page`; endpoint zwraca dziś wszystko.
5. **Paginacja `GET /baselines`** — prośba (c) z UI-02, przypomniana w UI-03, nadal otwarta.

## Zgodność z Frontend Architecture Contract

- **Jeden nowy page root, server-side.** `backend/delivery/projects/[id]/tasks/[taskId]/page.tsx` nie ma `use client` — zgodne z „Nowe page roots są server-side" z pakietu Adama. Nowy route wymaga **hydration smoke i testu kluczowej interakcji**; oba są w kryteriach faz 1 i 2.
- **Nazwane client islands:** `DeliveryTaskDetailClient`, `AttemptRegisterTable`, `ReserveAttemptAction`, `TaskPackagePanel`, `ResultImportDialog`, `ResultSummary`, `CancelAttemptAction`, `ReconcileAttemptDialog`, `BaselinePanel`.
- **Żaden komponent kliencki powyżej 300 LOC.** Logika parsowania i decyzji w czystych modułach (`attemptRegister.ts`, `attemptKey.ts`, `resultImport.ts`) — ten sam zabieg trzymał `ProposalImportDialog` przy 293 LOC. Dodatkowo plan **naprawia** zastane naruszenie: `DeliveryProjectDetailClient.tsx` schodzi z 335 poniżej 300.
- **Zero ciężkich bibliotek.** Pobranie pliku i schowek to API przeglądarki; żadnego SDK.
- **`yarn check:client-boundaries`** w kryteriach każdej fazy.

## References

- Strumień: [`../03-design-ui.md`](../03-design-ui.md) — UI-04
- Harmonogram i mapa kryteriów: [`../README.md`](../README.md)
- Plan główny, Faza 4 i Progress: [`../../plan.md`](../../plan.md)
- Poprzednik i wzorce: [`../ui-03/plan.md`](../ui-03/plan.md), [`../ui-03/handoff.md`](../ui-03/handoff.md)
- Korekta kierunku: [`../../flow-handoff/03-adam-ui-figma.md`](../../flow-handoff/03-adam-ui-figma.md)
- API i kontrakty: `packages/core/src/modules/delivery_os/{api,lib/contracts.ts,lib/attempts.ts,lib/resultAcceptance.ts}`
- Wzorzec dialogu importu: `components/detail/{ProposalImportDialog,ProposalPreview,proposalImport}.tsx`

## Progress

> Konwencja: `- [ ]` oczekuje, `- [x]` wykonane. Po wdrożeniu dopisz ` — <commit sha>`. Nie zmieniaj tytułów kroków. Ten Progress dotyczy wykonania UI-04; kryteria odbioru 4.3–4.6 zaznacza się wyłącznie w [planie głównym](../../plan.md#progress), po dowodach od OSS-04, EXEC-04, UI-04 i QA-04.

### Phase 1: Route detalu zadania, rejestr prób i dekompozycja hosta

#### Automated

- [ ] 1.1 Testy `attemptRegister` pokrywają trzy stany wejścia, przedziały czasu i aktywność
- [ ] 1.2 Test `AttemptRegisterTable` renderuje sześć `AttemptState`, cztery `outcome` i badge `stop_unconfirmed`
- [ ] 1.3 Test `TasksSection` potwierdza, że znacznik i link nie cofają naprawy F1 z UI-03
- [ ] 1.4 `DeliveryProjectDetailClient.tsx` i `BaselinePanel.tsx` mają poniżej 300 LOC
- [ ] 1.5 `sections.test.tsx`, `page.test.tsx` i `executionHost.test.tsx` przechodzą bez zmiany asercji
- [ ] 1.6 `i18n:check-sync`, `i18n:check-usage` i `i18n:check-hardcoded` są czyste
- [ ] 1.7 `typecheck` i `check:client-boundaries` przechodzą; brak nowego client page root
- [ ] 1.8 Granica własności `{api,commands,data}` jest pusta

#### Manual

- [ ] 1.9 Operator wchodzi z listy w detal zadania i wraca breadcrumbem
- [ ] 1.10 Brak prób, historia i rejestr nieczytelny dają trzy różne komunikaty

### Phase 2: Rezerwacja próby i eksport pakietu

#### Automated

- [ ] 2.1 Testy `attemptKey`: stabilność, zmienność po każdej składowej, zgodność z regexem nagłówka
- [ ] 2.2 Test `ReserveAttemptAction` daje pięć różnych komunikatów dla pięciu wyników
- [ ] 2.3 Test potwierdza, że `200` jest prezentowane jako sukces, nie jako błąd
- [ ] 2.4 Test `TaskPackagePanel`: brak próby daje nazwany powód, błąd schowka nie ukrywa pobrania
- [ ] 2.5 Test gatingu: bez `delivery_os.attempts.manage` rezerwacja nie renderuje się
- [ ] 2.6 `i18n:*`, `typecheck`, `check:client-boundaries` przechodzą; granica własności pusta

#### Manual

- [ ] 2.7 Operator rezerwuje próbę, kopiuje pakiet i pobiera go jako plik
- [ ] 2.8 Powtórne kliknięcie rezerwacji zwraca tę samą próbę z własnym komunikatem

### Phase 3: Import wyniku, kontrole i usage

#### Automated

- [ ] 3.1 Testy `resultImport` dla pięciu ścieżek wejścia
- [ ] 3.2 Test rozróżnia `path_not_allowed`, `unknown_test_id` i `baseline_mismatch`
- [ ] 3.3 Test `ResultImportDialog` rozróżnia `201`, `200 duplicate`, `409 result_conflict`, `409 attempt_not_active` i `422`
- [ ] 3.4 Test potwierdza, że `details[]` renderują się jako lista wszystkich ścieżek
- [ ] 3.5 Test `ResultSummary`: `not_run` nie jest liczone jako przechodzące
- [ ] 3.6 Test `usage: 'unknown'` daje komunikat o braku danych, nie zero
- [ ] 3.7 Test czyta z `i18n/en.json` frazę o braku trwałego odczytu usage
- [ ] 3.8 Testy konsumują negatywne fixture `result-manifest.*`
- [ ] 3.9 `i18n:*`, `typecheck`, `check:client-boundaries` przechodzą; granica własności pusta

#### Manual

- [ ] 3.10 Operator importuje manifest i widzi kontrole, ścieżki i usage
- [ ] 3.11 Powtórny import mówi „już przyjęty" i nie tworzy drugiego evidence
- [ ] 3.12 Manifest z `usage: 'unknown'` pokazuje brak danych, nie zero

### Phase 4: Anulowanie, uzgodnienie i spec integracyjny

#### Automated

- [ ] 4.1 Test `CancelAttemptAction` czyta z `i18n/en.json` frazę o niepotwierdzonym zatrzymaniu
- [ ] 4.2 Test potwierdza, że dialog uzgodnienia nie otwiera się automatycznie po anulowaniu
- [ ] 4.3 Test `ReconcileAttemptDialog` pokrywa cztery rozstrzygnięcia; `completed` bez manifestu nie wysyła żądania
- [ ] 4.4 Test `409 attempt_not_reconcilable` jest rozłączny z `attempt_not_active`
- [ ] 4.5 Testy konsumują cztery nowe fixture rejestru, w tym ścieżkę nieczytelną
- [ ] 4.6 Test dwóch nakładających się prób potwierdza jednoczesne przedziały aktywności
- [ ] 4.7 `TC-DELIVERY-UI-004` istnieje, przechodzi `typecheck` i `eslint`, teardown adresuje projekty po id
- [ ] 4.8 Testy modułu przechodzą w całości; `i18n:*`, `typecheck`, `check:client-boundaries` czyste; granica własności pusta

#### Manual

- [ ] 4.9 Operator anuluje próbę i widzi, że zatrzymanie nie jest potwierdzone
- [ ] 4.10 Operator uzgadnia próbę jako `unknown` i widzi ją domkniętą bez fałszywego śladu
- [ ] 4.11 Operator prowadzi dwa zadania jednocześnie i widzi nakładające się przedziały
- [ ] 4.12 Cała ścieżka rezerwacja → pakiet → wynik → poprawka → nowa próba przechodzi na żywej aplikacji
