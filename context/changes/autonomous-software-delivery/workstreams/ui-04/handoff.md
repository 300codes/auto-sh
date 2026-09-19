# UI-04 — przekazanie

> Ten plik **nie zalicza** żadnego kryterium [planu głównego](../../plan.md#progress). Kryteria 4.3–4.6 są
> współodbiorem OSS-04, EXEC-04, UI-04 i QA-04; zapis wykonuje jedna osoba po dowodach od wszystkich czterech.
> Rozliczenie wobec nowych ID odbioru (FLOW-01…09, WP-01…05) zostaje takie, jak opisuje sekcja
> „Pozycja wobec korekty kierunku" w [planie UI-04](plan.md) — ten plan **nie zamyka żadnego z nich samodzielnie**.

## Rewizja i runner

- **Runner walidacji:** **local**. Tak samo jak przy UI-03 — compose nie wystawia kontenera `app`.
- **Wykonane i przechodzące:**
  - `yarn generate` (nowy page root jest wykrywany przez auto-discovery — 2 wpisy w `modules.generated.ts`),
  - `yarn workspace @open-mercato/core test --testPathPatterns='delivery_os'` → **93 suity / 1737 testów**,
  - `yarn typecheck` → czysty (40/40),
  - `yarn check:client-boundaries` → czysty; **`delivery_os` nie pojawia się na liście client page rootów**,
  - `yarn i18n:check-usage` → 0 brakujących kluczy, `yarn i18n:check-hardcoded` → 0 twardych stringów,
  - `npx eslint` na zmienionych plikach → **0 błędów**, 2 ostrzeżenia (`react-hooks/exhaustive-deps`
    dla `scopeVersion`: jedno zastane w `DeliveryProjectDetailClient`, jedno nowe w
    `DeliveryTaskDetailClient` — ten sam świadomy wzorzec „scopeVersion jako wyzwalacz refetchu",
    co w `useProjectSections`),
  - granica własności pusta: `git status --porcelain -- packages/core/src/modules/delivery_os/{api,commands,data}`
    nie zwraca nic.
- **`yarn i18n:check-sync` kończy się kodem 1**, ale **wyłącznie** z powodu zastanego nieposortowania kluczy
  w module `auth` (5 zgłoszeń, 1 moduł). `delivery_os` jest czysty we wszystkich pięciu locale.
  Ten plan nie dotyka `auth`; naprawa należy do właściciela tamtego modułu (`yarn i18n:check-sync --fix`).
- **ŚWIADOMIE POMINIĘTE NA POLECENIE UŻYTKOWNIKA — nie uruchomione, nic o nich nie wiadomo:**
  **`yarn test`** (pełny zestaw monorepo poza `delivery_os`), **`yarn lint`** (pełna bramka lintera)
  oraz **`yarn build:app`**. Kto wznawia bramkę, zaczyna od tych trzech komend.

## Zakres dostarczony

**Route detalu zadania** (`backend/delivery/projects/[id]/tasks/[taskId]/`)
- `page.tsx` jest **server componentem** (bez `use client`), `page.meta.ts` gatuje stronę na
  `delivery_os.projects.view` z `navHidden` i trzystopniowym breadcrumbem. Feature'y wykonania
  (`attempts.manage`, `attempts.reconcile`, `results.import`) gatują **akcje wewnątrz**, nie dostęp:
  operator z samym `projects.view` widzi rejestr prób bez możliwości mutacji.
- `DeliveryTaskDetailClient.tsx` (147 LOC) czyta `GET /tasks/[id]`, trzyma `taskUpdatedAt` w stanie i podaje
  go następnej mutacji — wersję bierze z odpowiedzi mutacji, nie z refetchu. Breadcrumb nie potrafi nieść
  id projektu (metadane są statyczne), więc powrót do projektu z zaznaczonym zadaniem daje osobny link
  w nagłówku zadania.

**Rejestr prób** (`components/task/attemptRegister.ts`, `AttemptRegisterTable.tsx`)
- Czysty moduł rozróżnia **trzy rozłączne stany wejścia**: brak prób / `attemptRegisterReadable: false` /
  wpisy. Wylicza numer próby z kolejności rezerwacji, aktywność z `ACTIVE_ATTEMPT_STATES` i przedział
  `reservedAt → closedAt ?? teraz`, a `attemptIntervalsOverlap` pozwala pokazać dwa runy naraz.
- `findActiveAttempt` **milczy przy nieczytelnym rejestrze** — nieczytelny rejestr nie jest dowodem, że nic
  nie trwa. Lista zadań i detal używają tej samej funkcji, więc nie mogą się rozjechać.

**Dekompozycja hosta** — `DeliveryProjectDetailClient.tsx` zszedł z **335 → 275 LOC**; wydzielony
`components/detail/BaselinePanel.tsx` ma 131 LOC. Zachowanie bez zmian: `sections.test.tsx`, `page.test.tsx`
i `executionHost.test.tsx` przechodzą **bez zmiany asercji**.

**Rezerwacja i pakiet** (`attemptKey.ts`, `baseRevision.ts`, `ReserveAttemptAction.tsx`, `TaskPackagePanel.tsx`)
- Klucz idempotencji jest **czystą pochodną** `(taskId, baseRevision, attemptNumber)`, zgodną z regexem
  nagłówka `^[\x21-\x7E]{1,200}$` także dla wrogiego `externalWorkspaceId` (część czytelna + 64-bitowy
  skrót FNV-1a surowego tokenu). Powtórne kliknięcie trafia w tę samą próbę i daje `200`, nie drugą próbę.
- Pięć rozłącznych wyników rezerwacji: `201` nowa, `200` istniejąca (**sukces z własnym komunikatem**),
  `409 attempt_active` z numerem trwającej próby, `409 attempt_limit_reached`, `409 optimistic_lock_conflict`
  → `surfaceRecordConflict`. `task_not_ready`, `dependency_not_verified` i `idempotency_conflict` mają
  własne zdania.
- Rodzaj rewizji bierze się z **profilu docelowego** (`git` → `commitSha`, `snapshot` → `contentHash`
  + `externalWorkspaceId`); nieznany profil jest nazwany, nie zgadywany.
- Panel pakietu bez aktywnej próby podaje **nazwany powód** („rezerwacja jest warunkiem eksportu"), a nieudane
  kopiowanie do schowka (brak API / odmowa) daje osobny komunikat i **nie ukrywa pobrania pliku**.

**Import wyniku** (`resultImport.ts`, `ResultImportDialog.tsx`, `ResultSummary.tsx`, `ResultIssueList.tsx`)
- Parser ma pięć rozłącznych wyników wejścia (`empty`, `too_large`, `not_json`, `not_object`, `schema`)
  i czyta kod dostawczy z **`params.deliveryCode`**, nie z `issue.code` — inaczej `path_not_allowed`,
  `duplicate_stable_id` i `revision_mismatch` dostałyby słowo `custom`.
- `details[]` z serwera renderują się jako **lista wszystkich ścieżek**, nie jeden komunikat.
- `checks[]` w trzech stanach; **`not_run` nie jest zielone i nie jest doliczane do przechodzących**, a gdy
  wystąpi, pod licznikami pojawia się zdanie, że kontrola nieuruchomiona niczego nie dowodzi.
- `usage: 'unknown'` mówi, że **wynik nie podaje zużycia**, a nie że zużycie wynosi zero. Pod sekcją usage
  stoi stałe zdanie, że **trwałego odczytu nie ma** i sekcja zniknie po odświeżeniu. Test czyta obie frazy
  z `i18n/en.json`, żeby usunięcie ich z copy było wykrywalne.

**Anulowanie i uzgodnienie** (`CancelAttemptAction.tsx`, `reconcileInput.ts`, `ReconcileAttemptDialog.tsx`,
`ReconcileResolutionChoice.tsx`)
- Komunikat po anulowaniu mówi, że **zażądano zatrzymania, a zatrzymanie NIE jest potwierdzone**, i wskazuje
  uzgodnienie jako drogę domknięcia — nigdy „anulowano". Test czyta tę frazę z `i18n/en.json`.
- **Dialog uzgodnienia nie otwiera się automatycznie** po anulowaniu (osobny test); jest wystawiony jako akcja
  w wierszu próby, dla prób aktywnych i `reconciliation_required`, gated na `delivery_os.attempts.reconcile`.
- Cztery rozstrzygnięcia; `completed` dokłada pole manifestu i **reużywa `resultImport.ts`**. Brak manifestu
  blokuje wysyłkę **lokalnie**, zanim serwer zwróci `422 manifest_required`. `unknown` jest nazwane jako stan
  nierozstrzygnięty zapisany świadomie.

**Fixture rejestru** (`lib/fixtures/attempt-register.{active,stop-unconfirmed,reconciliation-required,unreadable}.v1.json`)
- Rejestrowane w `lib/fixtures/index.ts` przez `loadAttemptRegisterFixture`, który **odtwarza zachowanie
  `serializeTask`**: rejestr niespełniający kontraktu wraca pusty i oznaczony jako nieczytelny. Fixture
  deklaruje swoją czytelność i liczbę prób, więc dryf dokumentu wywala fixture zamiast po cichu zmieniać
  to, co asercje sprawdzają.
- Okna `active` [10:00 → otwarte) i `stop-unconfirmed` [10:30 → otwarte) **nakładają się celowo**: test
  pokazuje dwa runy aktywne jednocześnie na dwóch zadaniach.

**Spec integracyjny** — `__integration__/TC-DELIVERY-UI-004.spec.ts`, trzy testy (pełna ścieżka / ścieżka
niepewna / ścieżki negatywne). Samowystarczalny: projekt tworzony w setupie przez API i archiwizowany
**po własnym id** w `finally`, własne załączniki kasowane.

## Odstępstwa od planu

1. **`createCrudFormError` nie jest użyte przy `completed` bez manifestu.** Ten helper jest kontraktem
   `CrudForm`, a dialog uzgodnienia nie jest `CrudForm` — rzucony błąd nie miałby kto obsłużyć. Zachowanie
   wymagane przez plan jest dostarczone: `buildReconcileRequest` blokuje wysyłkę lokalnie i **nazywa pole**
   (`{ ok: false, field: 'manifest', reason: 'required' }`), a dialog renderuje komunikat tego pola.
2. **Breadcrumb do projektu nie jest linkiem.** `PageMetadata.breadcrumb` jest statyczne i nie zna
   `params.id`. Trzeci stopień jest na miejscu; powrót do konkretnego projektu prowadzi przez osobny link
   w nagłówku zadania (`?taskId=` zachowuje zaznaczenie).
3. **Sześć zastanych kluczy `delivery_os.audit.{intake,flow,decisions}.*` dopisano do pięciu locale.**
   Brakowały przed tym planem (referencje w `commands/`, których ten plan nie dotyka), a bez nich
   `i18n:check-usage` kończył się kodem 1. Dopisanie samych kluczy mieści się w granicy własności (`i18n/`).
4. **Piąty fixture „dwie nakładające się próby" nie powstał jako osobny plik.** Nakładanie wyrażają dwa
   z czterech zamówionych rejestrów, których przedziały celowo na siebie zachodzą.

## Czego ten plan nie udowodnił

1. **`TC-DELIVERY-UI-004` nie został uruchomiony.** Baza nie ma tabel `delivery_*`, `users` jest pusta,
   serwer dev nie działa, a `db:migrate`/`initialize` wymagają osobnej zgody. Świadoma decyzja.
2. **Żadna kontrola ręczna nie została wykonana** — 11 pozycji Manual w Progress pozostaje niezaznaczonych.
3. **Pełna bramka repo nie została uruchomiona** — `yarn test`, `yarn lint`, `yarn build:app` pominięte.
4. **Usage nie ma trwałego odczytu** — UI pokazuje je tylko z manifestu przyjętego w bieżącej sesji i mówi
   o tym wprost. Kryterium 4.6 w części „brakujące usage" jest pokryte dla świeżego importu, nie dla historii.
5. **Pobranie pliku i schowek nie zostały sprawdzone w realnej przeglądarce** — testy działają w jsdom.
6. **Nakładanie się dwóch runów jest dowodem obserwacyjnym** na fixture; twardy dowód 4.3 leży w testach
   OSS-04/EXEC-04.

## Prośby do OSS (bez zmian wobec planu)

1. `GET /projects/[id]/evidence` — lista evidence z filtrem po `taskId` i `kind`.
2. Odczyt `result_manifest` po `evidenceId` — `checks`, `findings`, `changedPaths` i `usage` są zapisywane,
   ale nieodczytywalne. To jedyny powód, dla którego sekcja usage znika po odświeżeniu.
3. `GET /tasks/[id]/attempts` — dziś rejestr przychodzi wyłącznie w `TaskDto`.
4. Filtrowanie i paginacja `GET /projects/[id]/tasks`.
5. Paginacja `GET /baselines` — prośba (c) z UI-02, nadal otwarta.
