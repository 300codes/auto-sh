# UI-02 — Dostarczyć szkielet projektu i host rozszerzenia

> Zadanie ze strumienia [UI](../03-design-ui.md). Kryteria odbioru i ich status należą do [planu głównego](../../plan.md#progress) — ten plik opisuje wykonanie, nie zalicza bramek.

## Overview

H4–H6, 2 h. Doprowadzić `delivery_os` do stanu, w którym operator przechodzi cały ręczny flow z interfejsu: znajduje moduł w nawigacji, zakłada projekt, widzi jego wymagania, design, zadania i to, co wiadomo o dowodach, wybiera zadanie i widzi rozszerzenie enterprise — albo nie widzi go, bo enterprise jest nieaktywne lub brakuje ACL.

Zadanie współodbiera **2.3** i **2.4** razem z OSS-02, EXEC-02 i QA-02. UI-02 nie zalicza ich samo.

Punkt wyjścia jest lepszy, niż zakładał harmonogram: ekran szczegółów z rzeczywistym `InjectionSpot` powstał już podczas integracji nocnej, a API OSS jest realne, nie robocze. Dlatego zapis specyfikacji „do H9 dozwolone fixture" nie ma tu zastosowania — pracujemy na żywych endpointach wszędzie, gdzie istnieją, a brak endpointu nazywamy brakiem, nie zastępujemy fixturem.

## Current State Analysis

- **Ekran szczegółów istnieje i jest poprawny.** `backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx:1` pobiera `GET /api/delivery_os/projects/{id}`, waliduje odpowiedź `projectDetailSchema`, składa `executionWidgetContextV1` i montuje **rzeczywisty** `InjectionSpot` ze spotem zadeklarowanym w `extension-points.ts:10`. Ma poprawne `LoadingMessage`/`ErrorMessage`, guard przeciw wyścigowi żądań (`requestSequence`) i `refresh` przekazany do kontekstu. Pokrycie: 7 testów w `__tests__/page.test.tsx` oraz `__integration__/TC-DELIVERY-UI-001.spec.ts`.
- **Lista projektów nie istnieje, a moduł nie ma wpisu w nawigacji.** Jedyny `page.meta.ts` modułu ma `navHidden: true` (`backend/delivery/projects/[id]/page.meta.ts:5`). Do ekranu da się dziś wejść wyłącznie przez URL z ręcznie wklejonym UUID.
- **`CrudForm` nie jest użyty w module w ogóle.** Projekty powstają dziś tylko przez `POST /api/delivery_os/projects`.
- **API OSS pokrywa trzy sekcje z czterech.** `GET /projects/[id]/baselines` zwraca `{ items, total }` pełnych baseline'ów z `content` i `isActive`; `GET /projects/[id]/tasks` zwraca wszystkie nieusunięte zadania. **Dla dowodów istnieje wyłącznie `POST /projects/[id]/evidence`** (`api/projects/[id]/evidence/route.ts:22`) — nie ma odczytu.
- **Widget enterprise jest wyłączony przez brak zadania — i nawet włączony nic nie rysuje.** `widget.client.tsx:21` zwraca `null` gdy `context.taskId` jest puste, a host zawsze podaje `taskId: null`. Ale gałąź pozytywna renderuje **pusty `<div data-testid="delivery-execution-action">`** z komentarzem `{/* Execution controls rendered by EXEC-04 */}`. Podanie realnego `taskId` przełącza więc div o zerowej wysokości z nieobecnego na obecny; dla oka operatora oba stany są identyczne. Wizualna karta wykonania powstaje dopiero w EXEC-04 i **nie jest** czymś, co UI-02 może dostarczyć ani zademonstrować.
- **i18n jest kompletne w pięciu locale.** `i18n/{en,pl,de,es,ko}.json` mają po 31 kluczy; brak luk do nadrobienia, ale każdy nowy klucz wymaga pięciu wpisów.
- **Granica własności.** UI prowadzi `delivery_os/backend/`, `components/` i `i18n/`. `api/`, `commands/`, `data/` i `lib/` prowadzi OSS ([README strumieni](../README.md) → Wspólne pliki i commity).

### Key Discoveries

- **Kontrakt kontekstu już dopuszcza wybór zadania.** `executionWidgetContextV1Schema` ma `taskId: uuidSchema.nullable()` (`lib/contracts.ts:717`). Podanie realnego `taskId` nie wymaga zmiany wersji kontraktu ani zgody OSS — to wyłącznie praca hosta.
- **Archiwizacja projektu ma nietypowe wywołanie.** `DELETE /api/delivery_os/projects` czyta id z **query param**, nie ze ścieżki (`api/projects/route.ts:88-97`), i wymaga nagłówka optimistic lock — dokładnie tak robi to teardown w `TC-DELIVERY-UI-001.spec.ts`.
- **Lista archiwalnych ma własny parametr.** `GET /projects` przepisuje `includeArchived` na `withDeleted` we własnym wrapperze (`api/projects/route.ts:108-114`); wysłanie `withDeleted` wprost zostaje skasowane.
- **Lista nie zna statusu.** `serializeProjectListRow` (`api/serializers.ts:17`) zwraca surowe pola encji; `status`, `progress`, `taskCounts` i `attention` liczy `deriveProjectStatus` wyłącznie w route szczegółów, po zapytaniach o baselines, tasks, evidence i decisions.
- **Eksport listy jest wyłączony po stronie OSS.** `export: { enabled: false }` (`api/projects/route.ts:64`) — nie planować przycisku eksportu.
- **Rejestr prób może być nieczytelny.** `serializeTask` zwraca `attemptRegisterReadable: false` i pustą tablicę, gdy `parseAttemptRegister` odrzuci zawartość (`api/serializers.ts:109`). Pusta tablica nie znaczy „brak prób".
- **Baseline odróżnia deklarację od kontroli.** `content.declaredTests`, `acTestMap` i `manualChecks` to deklaracje planu, nie wykonane testy. Plan główny utrzymuje ten podział za `docs/orchestration-evidence.md:19`; UI nie może ich prezentować jako wyniku.

## Desired End State

Operator loguje się do backendu, widzi w sidebarze grupę Delivery, otwiera listę projektów, zakłada projekt formularzem, wchodzi w szczegóły i widzi cztery sekcje wypełnione danymi z API OSS albo jawnie nazwanym brakiem. Zaznacza zadanie; jeśli enterprise jest aktywne i użytkownik ma `delivery_agents.execute`, widget wykonania zostaje **zamontowany** z tym `taskId` — inaczej nie montuje się nic. Widget EXEC-02 jest dziś pustym szkieletem, więc dowodem jest obecność jego węzła DOM; widoczna karta wykonania powstaje w EXEC-04. Operator archiwizuje projekt z listy po potwierdzeniu; przy nieaktualnej wersji dostaje konflikt, a wiersz bez wersji nie pozwala nawet wysłać żądania.

Weryfikacja: `TC-DELIVERY-UI-002` przechodzi na żywym środowisku, testy komponentowe modułu przechodzą, `yarn i18n:check-usage` nie zgłasza brakujących kluczy, a `git diff --stat` nie pokazuje zmian w `api/`, `commands/`, `data/` ani `lib/` modułu.

## What We're NOT Doing

- Nie dotykamy `api/`, `commands/`, `data/` ani `lib/` w `delivery_os` — to powierzchnia OSS prowadzona równolegle przez inną osobę.
- Nie dodajemy `GET /projects/[id]/evidence` ani statusu do serializera listy; jedno i drugie idzie do OSS jako handoff.
- Nie budujemy proposals, skills, generacji Figmy ani importu manifestów — to UI-03.
- Nie dodajemy przycisków zatwierdzania/odrzucania decyzji — Progress 3.4/3.5 należy do UI-03.
- Nie budujemy formularza **edycji** projektu — `DeliveryProjectForm` zostaje przygotowany tak, by UI-03 owinęło go trybem edycji; sam tryb nie występuje w wymaganiach UI-02.
- Nie budujemy advanced filters, presetów, bulk actions ani eksportu listy.
- Nie renderujemy podglądów ekranów z `attachmentId` — sekcja designu zostaje metadanowa (nazwa, `nodeId`, viewport, `figmaVersion`, skrócony `sha256`); miniatury z modułu `attachments` należą do UI-03 razem z resztą pracy figmowej.
- Nie renderujemy sekcji z fixture, gdy realny endpoint nie istnieje — brak nazywamy brakiem.
- Nie tworzymy ekranu zadań ani UI wykonania/manual handoff — to UI-04.

## Implementation Approach

Trzy fazy w jednym dwugodzinnym oknie, ustawione tak, że każda kończy się czymś, co operator może kliknąć. Kolejność wynika z zależności demonstracyjnej: bez listy i formularza nie ma czego oglądać w szczegółach, a bez wyboru zadania nie ma czym udowodnić hosta rozszerzenia.

Istniejący ekran szczegółów jest **rozbudowywany, nie przepisywany**. Jego wzorzec — walidacja odpowiedzi schematem przed użyciem, guard sekwencji żądań, jawne rozdzielenie `notFound` od `error` — jest już przetestowany siedmioma przypadkami i zostaje regułą dla nowych sekcji. Nowe pobrania idą obok istniejącego, nie zamiast niego: błąd listy zadań nie może zabrać operatorowi hosta wykonania.

Sekcje żyją w `components/detail/` jako komponenty prezentacyjne przyjmujące już pobrane dane. To nie jest kosmetyka: UI-03 dokłada do tych samych sekcji zatwierdzanie i proposals, a UI-05 buduje `EvidenceTable` na tym samym modelu. Rozdzielenie pobierania od prezentacji teraz kosztuje kilkanaście minut, a później oszczędza przepisywanie.

Decyzja o danych, których nie ma, jest zapisana raz i obowiązuje wszędzie: **trzy różne komunikaty zamiast jednego**. „Projekt nie ma jeszcze baseline" to stan domeny. „Baseline nie ma zaplanowanych zadań" to inny stan domeny. „Dowodów nie da się odczytać, bo endpoint nie istnieje" to brak platformy i musi być nazwany jako taki — inaczej odbierający zobaczy pustą sekcję i wyciągnie wniosek, że dowodów nie ma.

## Critical Implementation Details

**Rejestr prób ma trzy stany, nie dwa.** `attemptRegisterReadable: false` oznacza, że zapis jest nieczytelny — nie że prób nie było. Sekcja zadań musi odróżnić „brak prób" od „rejestr nieczytelny"; zlanie ich w jeden pusty stan tworzy dokładnie ten fałszywy PASS, który plan główny wyklucza.

**`percent: null` nie jest zerem.** `projectProgressSchema` dopuszcza `percent: null` przy `total = 0`. Renderować „—" i same liczby `proven/total`; wyliczenie 0% z braku AC pokazuje projekt jako rozpoczęty i niezaliczony, podczas gdy on jeszcze nie ma kryteriów.

**Wybór zadania musi przeżyć odświeżenie i zniknięcie zadania.** `taskId` trzymać w query param, żeby reload i deep-link zachowały kontekst. Po refetchu zadań sprawdzić, czy wybrane id nadal istnieje na liście — zadanie zarchiwizowane w międzyczasie zniknie z odpowiedzi i kontekst wskaże nieistniejący rekord. Przy braku dopasowania wyczyścić wybór, nie montować spotu z martwym `taskId`.

**Guard sekwencji obowiązuje każde nowe pobranie.** Istniejący `requestSequence` chroni tylko zapytanie o projekt. Nawigacja między projektami przy trzech równoległych żądaniach potrafi wstawić sekcje poprzedniego projektu pod nagłówek następnego; test „ignores a previous project request" pokrywa dziś tylko jedną ścieżkę.

**Archiwizacja to `?id=` plus nagłówek, a brak nagłówka nie jest błędem.** `DELETE /api/delivery_os/projects?id=<uuid>`; wywołanie na ścieżce z id zwróci 404. Blokada optymistyczna **zawodzi otwarcie**: `assertOptimisticLock` wraca cicho, gdy nie ma oczekiwanej wersji (`packages/shared/src/lib/crud/optimistic-lock-command.ts:125` — „clients that don't send the token are never blocked"), a projekty idą przez `enforceCommandOptimisticLockWithGuards` (`commands/shared.ts:207`), nie przez `requireLockHeader`. Pominięcie nagłówka daje więc **200 i archiwizację bez kontroli wersji**, nie 409. To nie jest przypadek teoretyczny: `updatedAt` w wierszu listy jest nullable (`api/schemas.ts:32`), a `buildOptimisticLockHeader` zwraca `{}` dla nie-stringa (`packages/ui/src/backend/utils/optimisticLock.ts:33`), więc wiersz bez wersji wyprodukuje dokładnie tę niechronioną archiwizację. Ochrona musi być po stronie klienta: bez `updatedAt` nie wysyłać DELETE w ogóle.

## Phase 1: Lista, nawigacja i formularz projektu

### Overview

H4–H4:35. Doprowadzić do stanu, w którym operator dociera do modułu bez URL-a i zakłada projekt bez curl-a.

### Changes Required

#### 1. Wpis nawigacyjny i strona listy

**Pliki:** `packages/core/src/modules/delivery_os/backend/delivery/projects/page.meta.ts` (nowy), `.../projects/page.tsx` (nowy)

**Intent:** Udostępnić moduł w sidebarze i osadzić listę jako wyspę kliencką, tak samo jak zrobiono to dla szczegółów.

**Contract:** `page.meta.ts` z `requireAuth: true` i `requireFeatures: ['delivery_os.projects.view']` — tą samą cechą, której pilnuje `GET /projects`. Wpis nawigacyjny w nowej grupie Delivery: `pageGroup`/`pageGroupKey`, `pageTitle`/`pageTitleKey`, `pageOrder`, `icon`, `pageContext: 'main'`, `breadcrumb`. Wzorzec pełnego zestawu pól: `packages/core/src/modules/directory/backend/directory/tenants/page.meta.ts`. Klucze `delivery_os.nav.group` i `delivery_os.nav.projects` dopisane do wszystkich pięciu plików i18n — parity i kolejność alfabetyczną kluczy wymusza `yarn i18n:check-sync`, nie `check-usage` (ten sprawdza wyłącznie braki). `page.tsx` renderuje wyłącznie komponent kliencki — strona serwerowa nie może wciągać `node:crypto` do przeglądarki, co było przedmiotem poprawki integracyjnej dla szczegółów. Szczegóły zostają `navHidden: true` i dostają breadcrumb wskazujący listę.

**Natychmiast po wylądowaniu obu plików uruchomić `yarn build:packages && yarn generate`.** Strony backendu nie są trasami plikowymi — trafiają do routera i do sidebara wyłącznie przez wygenerowany rejestr modułów, który skanuje `page.tsx`/`page.meta.ts` i czyta pola nawigacji. `.mercato/generated/` w tym drzewie **nie istnieje**, więc bez tego kroku nowa strona nie istnieje dla aplikacji. Pułapka jest cicha: testy Jest importują `../page` i `../page.meta` wprost, więc przechodzą na nieaktualnym rejestrze, a padają dopiero kontrola ręczna sidebara i cały `TC-DELIVERY-UI-002`. Generate pisze poza modułem, więc kontrola granicy `git diff --stat` pozostaje bez zmian.

#### 2. Tabela projektów

**Plik:** `packages/core/src/modules/delivery_os/components/projects/DeliveryProjectListClient.tsx` (nowy)

**Intent:** Pokazać projekty w scope operatora z wyszukiwaniem, sortowaniem i paginacją, i pozwolić z nich wejść w szczegóły.

**Contract:** Wzorzec do skopiowania: `packages/core/src/modules/auth/backend/roles/page.tsx` (169 linii) — najbliższy potrzebnemu zakresowi. `DataTable` ze stabilnym `extensionTableId`, zasilany przez `apiCall` na `GET /api/delivery_os/projects`. Kolumny: nazwa (link do szczegółów), tryb wejścia, target profile z wersją, repozytorium, zaktualizowano, znacznik archiwalnego. **Bez kolumny statusu i postępu** — lista ich nie zwraca, a doliczanie ich po stronie klienta byłoby drugim miejscem z logiką statusu. Parametry zapytania zgodne z `projectListQuerySchema`: `page`, `pageSize` (≤100), `search`, `includeArchived`. Przełącznik archiwalnych wysyła `includeArchived`, nigdy `withDeleted`. `onSearchChange` i zmiana przełącznika resetują stronę na 1. Sortowanie wyłącznie po polach z `sortFieldMap`: `name`, `createdAt`, `updatedAt`. Bez przycisku eksportu. `RowActions` ze stabilnymi id (`open`, `delete`; `edit` dochodzi w UI-03) — DataTable wyprowadza z nich domyślne zachowanie kliknięcia wiersza. Pusty wynik przez `ListEmptyState`, pusty wynik wyszukiwania osobnym komunikatem. Odświeżanie po mutacji przez bump `reloadToken` w zależnościach pobrania; `useOrganizationScopeVersion()` w tych samych zależnościach, żeby przełączenie organizacji nie zostawiło cudzych wierszy.

#### 3. Archiwizacja z listy

**Plik:** ten sam komponent listy

**Intent:** Pozwolić operatorowi zarchiwizować projekt tak, żeby konflikt wersji i blokada aktywnej próby były widoczne, a nie cicho połknięte.

**Contract:** Akcja `delete` jest **niedostępna**, gdy `row.updatedAt` nie jest niepustym stringiem — bez wersji żądanie przeszłoby bez kontroli i cicho zarchiwizowało rekord (patrz Critical Implementation Details). Alternatywa przy braku wersji: dobrać ją z `GET /projects/{id}` przed wysłaniem; czego nie wolno, to wysłać DELETE bez nagłówka. Dalej: `useConfirmDialog` (pamiętać o wyrenderowaniu `ConfirmDialogElement` w drzewie), a samo wywołanie przez `useGuardedMutation(...).runMutation(...)` — to jedyna droga dla zapisu poza `CrudForm`. Żądanie: `DELETE /api/delivery_os/projects?id=<uuid>` owinięte w `withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), …)`. Obsłużyć trzy odpowiedzi rozłącznie: 200 — bump `reloadToken` i flash sukcesu; 409 — `runMutation` sam kieruje konflikt na trwały `RecordConflictBanner`, więc `catch` ma **wyjść wcześnie** po `surfaceRecordConflict(error, t, { onRefresh })`, zanim pokaże ogólny błąd; 404 — projekt poza scope, komunikat i odświeżenie listy. Nie budować własnego banera konfliktu. 409 pokrywa dwa różne przypadki domenowe — nieaktualne `updatedAt` oraz aktywną lub nieuzgodnioną próbę — więc komunikat nie może twierdzić, że rekord zmienił ktoś inny. Wzorzec: `packages/core/src/modules/currencies/backend/currencies/page.tsx:157-201`.

#### 4. Formularz tworzenia projektu

**Pliki:** `.../components/projects/DeliveryProjectForm.tsx` (nowy), `.../backend/delivery/projects/create/page.tsx` + `page.meta.ts` (nowe)

**Intent:** Dać operatorowi drogę założenia projektu z UI, w komponencie na tyle rozdzielonym, żeby UI-03 mogło go owinąć trybem edycji bez przepisywania.

**Contract:** `CrudForm` z `createCrud` z `@open-mercato/ui/backend/crud` — sam obsługuje `raiseCrudError`; `apiPath` podawać bez prefiksu `/api/` (`delivery_os/projects`). Wzorzec: `directory/backend/directory/tenants/create/page.tsx` (55 linii). Pola z `projectCreateSchema`: `name`, `inputMode` (`from_brief` / `from_design`, etykiety z i18n), `brief` (textarea, ≤20000), `targetProfileId` + `targetProfileVersion` z `TARGET_PROFILES`, `repositoryRef`, `limits` (`maxParallelTasks`, `maxCorrectionRounds`, `attemptTimeoutMinutes`) z `DEFAULT_DELIVERY_LIMITS` jako wartościami początkowymi. `draftSpec` poza formularzem. Strona guarded cechą `delivery_os.projects.manage` zgodnie z metadanymi POST route'u, z `navHidden: true` i dwuelementowym breadcrumbem. Lokalne błędy walidacji przez `createCrudFormError`. Po sukcesie `successRedirect` na szczegóły projektu.

`DeliveryProjectForm` przyjmuje `fields`/`initialValues`/`onSubmit` z zewnątrz i nie zna trybu — dzięki temu UI-03 dokłada edycję, podmieniając schemat na `projectUpdateSchema` i podając `initialValues.updatedAt`, bez dotykania tego komponentu. **Edycja nie wchodzi do UI-02**: nie występuje ani w `03-design-ui.md`, ani w Desired End State, a jej dwie fiddliwe części (odłożony mount `CrudForm` do czasu pobrania `initialValues`, plumbing `updatedAt`) to właśnie te ~20 minut, których Faza 3 potrzebuje bardziej.

#### 5. Tłumaczenia

**Pliki:** `packages/core/src/modules/delivery_os/i18n/{en,pl,de,es,ko}.json`

**Intent:** Utrzymać komplet pięciu locale, który moduł ma dzisiaj.

**Contract:** Każdy nowy klucz dodany do wszystkich pięciu plików w tej samej zmianie, w porządku alfabetycznym — `yarn i18n:check-sync` pilnuje parity i kolejności, `yarn i18n:fix` je normalizuje. Zakres: grupa i tytuły nawigacji, nagłówki kolumn, etykiety i opisy pól formularza, etykiety trybów wejścia, teksty dialogu potwierdzenia, komunikaty sukcesu i błędu, puste stany listy. Żadnego literału użytkownika w kodzie; wyjątkiem są komunikaty czysto wewnętrzne, które muszą mieć prefiks `[internal]`.

#### 6. Testy komponentowe listy i formularza

**Pliki:** `.../backend/delivery/projects/__tests__/list.test.tsx` (nowy), `.../components/projects/__tests__/form.test.tsx` (nowy)

**Intent:** Utrwalić zachowania, w których łatwo o cichy błąd: parametry zapytania, nagłówek blokady i rozgałęzienie odpowiedzi archiwizacji.

**Contract:** Lista: guard cechy w `page.meta`, mapowanie `search`/`page`/`pageSize`/`includeArchived` na query string, kolumny bez statusu, `RowActions` ze stabilnymi id, oraz trzy rozłączne ścieżki 200/409/404. Dwa osobne przypadki blokady: żądanie DELETE **musi** nieść nagłówek `OPTIMISTIC_LOCK_HEADER_NAME`, a wiersz bez `updatedAt` **nie może** go w ogóle wysłać. Formularz: pola odpowiadają `projectCreateSchema`, a `DeliveryProjectForm` nie zawiera własnej wiedzy o trybie. Mockować `apiCall`, nie `fetch`.

### Success Criteria

#### Automated Verification

- `yarn build:packages && yarn generate` przechodzi, a wygenerowany rejestr zawiera nową stronę listy.
- Testy jednostkowe modułu przechodzą: `yarn workspace @open-mercato/core test --testPathPatterns='delivery_os' --maxWorkers=4`.
- Typy i lint przechodzą dla zmienionych pakietów: `yarn typecheck`, `yarn lint`.
- `yarn i18n:check-sync` potwierdza parity i kolejność w pięciu locale; `yarn i18n:check-usage` nie zgłasza brakujących kluczy dla `delivery_os`; żaden nowy literał użytkownika nie trafia do `yarn i18n:check-hardcoded`.
- `git diff --stat` nie pokazuje zmian w `packages/core/src/modules/delivery_os/{api,commands,data,lib}/`.
- Testy pokrywają wszystkie trzy odpowiedzi archiwizacji (200, 409, 404) i obecność nagłówka optimistic lock w żądaniu DELETE.
- Test potwierdza, że wiersz bez `updatedAt` nie wysyła DELETE.

#### Manual Verification

- Operator widzi grupę Delivery w sidebarze i wchodzi na listę bez wpisywania URL-a.
- Operator zakłada projekt formularzem i ląduje na jego szczegółach.
- Archiwizacja pyta o potwierdzenie; próba archiwizacji rekordu zmienionego w drugiej karcie pokazuje konflikt, a nie cichy sukces.

**Implementation Note:** Nie przechodzić do Fazy 2 bez działającej ścieżki lista → formularz → szczegóły. Faza 2 rozbudowuje ekran, do którego Faza 1 dopiero tworzy wejście.

---

## Phase 2: Sekcje szczegółów i wybór zadania

### Overview

H4:35–H5:25. Zamienić minimalny ekran szczegółów w miejsce, z którego widać stan projektu, i uruchomić host rozszerzenia realnym `taskId`.

### Changes Required

> **Chrome sekcji bierzemy z rodziny, nie piszemy od nowa.** `.ai/ui-backend-components.md` dokumentuje `SectionHeader`/`CollapsibleSection` (nagłówek + licznik + akcja) i `TabEmptyState` z `@open-mercato/ui/backend`; AGENTS.md wymaga sprawdzenia tej rodziny **przed** budowaniem czegokolwiek od zera. Wszystkie cztery sekcje używają jej na nagłówki, liczniki i puste stany; własny kod zostaje wyłącznie na ciała sekcji, bo tylko one są specyficzne dla domeny.

#### 1. Równoległe pobieranie danych sekcji

**Plik:** `packages/core/src/modules/delivery_os/components/detail/useProjectSections.ts` (nowy)

**Intent:** Pobrać baseline'y i zadania obok istniejącego zapytania o projekt, bez wiązania ich w jeden wspólny stan ładowania.

**Contract:** Hook zwraca dla każdego źródła osobny stan `loading | error | ready` z własną funkcją ponowienia. Obie odpowiedzi walidowane przed użyciem — `baselineListResponseSchema` i `taskListResponseSchema` z `api/schemas.ts`; odpowiedź, która nie przechodzi walidacji, jest błędem, nie pustą listą. Ten sam guard sekwencji co w istniejącym kliencie, odrębny dla każdego źródła: odpowiedź poprzedniego projektu nigdy nie może wypełnić sekcji bieżącego. Hook nie decyduje o renderowaniu — zwraca dane i stany.

#### 2. Sekcje wymagań i designu

**Pliki:** `.../components/detail/RequirementsSection.tsx` (nowy), `.../components/detail/DesignSection.tsx` (nowy)

**Intent:** Pokazać treść aktywnego baseline'u w formie, na której UI-03 dobuduje zatwierdzanie.

**Contract:** Źródłem jest baseline z `isActive: true`; przy jego braku sekcje pokazują stan „projekt nie ma jeszcze zatwierdzonego baseline'u", nazwany wprost, nie jako pusta lista. `content` parsowany `baselineContentV1Schema`; treść, która nie przechodzi walidacji, daje stan błędu sekcji z możliwością ponowienia, nie ciche pominięcie pól. Wymagania: `requirements` z trwałymi ID, pod każdym powiązane `acceptanceCriteria`. Design: `screens` z nazwą, `nodeId`, viewportem, `figmaVersion` i skróconym `sha256`, plus `tokens` jako lista par. Obie sekcje read-only. Nagłówek podaje wersję baseline'u i skrócony `contentHash` — bez tego operator nie wie, którą wersję ogląda. Historia decyzji z `decisions` pokazana read-only; żadnych przycisków zatwierdzenia.

#### 3. Sekcja zadań z wyborem

**Plik:** `.../components/detail/TasksSection.tsx` (nowy)

**Intent:** Pokazać zadania i pozwolić wybrać jedno, którego identyfikator trafi do kontekstu hosta rozszerzenia.

**Contract:** Lista zadań z tytułem, statusem, `acIds`, numerem próby i liczbą prób z rejestru. Wybór pojedynczego zadania sterowany z góry — komponent przyjmuje `selectedTaskId` i `onSelectTask`, sam stanu nie trzyma. Rejestr prób w trzech rozłącznych stanach: prób brak, próby wypisane, rejestr nieczytelny (`attemptRegisterReadable: false`) — ostatni z własnym komunikatem, nigdy jako pusty. Zadania wyróżnione w `attention.blockedTaskIds` i `attention.reconciliationRequiredTaskIds` oznaczone tokenami statusu z design systemu, nie kolorami Tailwind. Brak zadań przy istniejącym baseline to osobny komunikat („baseline bez zaplanowanych zadań"), różny od braku baseline'u.

#### 4. Sekcja dowodów i jawny brak

**Plik:** `.../components/detail/EvidenceSection.tsx` (nowy)

**Intent:** Pokazać wszystko, co o dowodach wynika z istniejących API, i nazwać wprost tę część, której platforma jeszcze nie udostępnia.

**Contract:** Trzy bloki. **Postęp AC** z `projectDetail.progress`: `proven` z `total`, jednostka `ac`, a `percent: null` renderowany jako „—" — nigdy jako 0%. **Stan zadań** z `taskCounts` i `attention`. **Zadeklarowane pokrycie** z baseline'u: `acTestMap`, `declaredTests` i `manualChecks`, opatrzone jednoznaczną etykietą, że są deklaracją planu, a nie wykonanym testem — plan główny utrzymuje ten podział i UI nie może go zacierać. Czwarty element to komunikat: lista zarejestrowanych dowodów jest niedostępna, ponieważ `GET /projects/[id]/evidence` nie istnieje; treść wskazuje brak endpointu, nie brak dowodów. Bez fixture i bez żadnego PASS.

#### 5. Podłączenie sekcji i wyboru zadania do hosta

**Plik:** `packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx` (modyfikacja)

**Intent:** Osadzić sekcje pod istniejącym nagłówkiem i zasilić `InjectionSpot` realnym `taskId`, żeby rozszerzenie enterprise miało co renderować.

**Contract:** Zapytanie o projekt nadal bramkuje całą stronę — `loading`, `notFound`, `error` i guard sekwencji zostają bez zmian, tak samo jak zachowania utrwalone w siedmiu istniejących testach. Sekcje renderują się poniżej i mają własne `LoadingMessage`/`ErrorMessage` z `@open-mercato/ui/backend/detail`; błąd jednej z nich nie odmontowuje pozostałych ani `InjectionSpot`. Wybrane zadanie trzymane w query param, żeby przetrwało reload i dało deep-link. Po każdym refetchu zadań wybór weryfikowany względem zwróconej listy: brak dopasowania czyści wybór i ustawia `taskId: null`, zamiast montować spot z martwym identyfikatorem. `taskId` wchodzi do `executionWidgetContextV1` — kontrakt już to dopuszcza, wersja schematu bez zmian. Efektem jest **zamontowanie** widgetu EXEC-02, nie pojawienie się widocznej karty: ten widget jest pustym szkieletem, więc dowodem jest obecność jego węzła DOM, nie zrzut ekranu. `refresh` przekazany do widgetu odświeża projekt **i** sekcje, bo wynik wykonania zmienia status zadania.

#### 6. Tłumaczenia i testy sekcji

**Pliki:** `i18n/{en,pl,de,es,ko}.json`, `.../components/detail/__tests__/sections.test.tsx` (nowy), `.../backend/delivery/projects/[id]/__tests__/page.test.tsx` (rozszerzenie)

**Intent:** Domknąć locale i utrwalić rozróżnienia, które są sensem tej fazy.

**Contract:** Klucze nagłówków sekcji, pól, trzech odmiennych pustych stanów, stanu nieczytelnego rejestru, etykiety deklaracji pokrycia i komunikatu o brakującym endpoincie — w pięciu plikach. Testy: brak baseline'u, baseline bez zadań i brak endpointu dowodów dają **trzy różne** komunikaty; `percent: null` renderuje „—", nie „0%"; `attemptRegisterReadable: false` nie renderuje się jako brak prób; błąd zapytania o zadania zostawia widoczne pozostałe sekcje i `InjectionSpot`; wybór zadania trafia do `context.taskId` i do query param; zniknięcie wybranego zadania po refetchu czyści wybór. Istniejące testy szczegółów zostają nienaruszone w treści.

### Success Criteria

#### Automated Verification

- `yarn workspace @open-mercato/core test --testPathPatterns='delivery_os' --maxWorkers=4` przechodzi, w tym siedem istniejących testów szczegółów bez modyfikacji ich asercji.
- Test potwierdza trzy rozłączne komunikaty dla braku baseline'u, braku zadań i braku endpointu dowodów.
- Test potwierdza, że `percent: null` nie renderuje się jako wartość procentowa.
- Test potwierdza, że `attemptRegisterReadable: false` daje komunikat inny niż brak prób.
- Test potwierdza, że wybór zadania trafia do `context.taskId` walidowanego `executionWidgetContextV1Schema`, a zniknięcie zadania po refetchu czyści wybór.
- Test potwierdza, że błąd jednego źródła sekcji nie odmontowuje `InjectionSpot`.
- **Montowanie rozszerzenia potwierdzone dowodem DOM, nie wyglądem:** `[data-testid="delivery-execution-action"]` obecny z `data-task-id` równym wybranemu zadaniu i nieobecny po odebraniu `delivery_agents.execute` albo dezaktywacji rozszerzenia.
- `yarn i18n:check-sync` i `yarn i18n:check-usage` bez braków; `yarn lint` i `yarn typecheck` przechodzą.
- `git diff --stat` nadal nie pokazuje zmian w `api/`, `commands/`, `data/` ani `lib/`.

#### Manual Verification

Dwa pierwsze punkty są **warunkowe**: wymagają projektu z aktywnym baseline i zadaniem, którego UI-02 nie tworzy (patrz niżej). Przy braku fixture zostają niezaznaczone, a zależność jest zapisana w `handoff.md` z góry, nie po fakcie.

- Operator otwiera projekt z baseline'em i widzi wymagania z powiązanymi AC oraz ekrany z wersją Figmy.
- Operator zaznacza zadanie i widzi zrzut ekranu sekcji z zamontowanym węzłem rozszerzenia oraz drugi po odebraniu cechy — opatrzone informacją, że widoczna karta wykonania powstaje w EXEC-04.
- Sekcja dowodów mówi wprost, że lista dowodów jest niedostępna z powodu brakującego endpointu — odbierający nie odczytuje tego jako braku dowodów.

**Implementation Note:** Odbiór „rozszerzenie pojawia się tylko z aktywnym enterprise i ACL" rozpada się na dwie części. UI-02 dowodzi **montowania** — obu stanów, nie samego pozytywnego — dowodem DOM, bo widget EXEC-02 jest pustym szkieletem i nic nie rysuje. Część **wizualna** należy do EXEC-04 i musi być tak zapisana przy współodbiorze 2.3/2.4; pokazywanie pustego diva jako „karty wykonania" byłoby dokładnie tym fikcyjnym PASS, który plan główny wyklucza. Przygotować sposób odebrania cechy przed demonstracją.

---

## Phase 3: Dowód przejścia flow i przekazanie

### Overview

H5:25–H6, z 35 min zamiast 20 po wycięciu formularza edycji. Zamienić „działa u mnie" w przebieg, który ktoś inny może powtórzyć, i przekazać OSS dwie rzeczy, których UI-02 świadomie nie zrobiło.

### Changes Required

#### 1. Integracyjny przebieg ręcznego flow

**Plik:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-UI-002.spec.ts` (nowy)

**Intent:** Udowodnić odbiór „operator przechodzi ręczny flow" wykonaniem, nie deklaracją.

**Contract:** Samowystarczalny scenariusz: zalogowanie, wejście na listę z nawigacji, utworzenie projektu formularzem, odnalezienie go na liście przez wyszukiwanie, wejście w szczegóły, potwierdzenie widoczności czterech sekcji i ich stanów dla projektu bez baseline'u, powrót na listę i archiwizacja. Fixture zakładane w teście i sprzątane w `finally` — wzorzec z `TC-DELIVERY-UI-001.spec.ts`, bez polegania na danych demo. Asercje na rozróżnieniu pustych stanów, nie na samej obecności nagłówków sekcji. Scenariusz z baseline'em i zadaniami wymaga fixture domenowego, którego UI-02 nie tworzy — pokrycie wyboru zadania zostaje na poziomie testów komponentowych i jest wymienione w handoffie jako luka.

#### 2. Przekazanie dla OSS

**Plik:** `context/changes/autonomous-software-delivery/workstreams/ui-02/handoff.md` (nowy)

**Intent:** Zapisać dwie zależności tak, żeby nie zginęły między strumieniami ani nie zostały po cichu obejrzane jako zrobione.

**Contract:** Osobny plik strumienia UI — nie dopisywać do `next-tasks-2026-09-19.md` ani do `README.md`, które są edytowane równolegle. **Szkielet pliku założyć na starcie Fazy 2, nie na końcu** — zależność fixture'a z F8 ma być zapisana zanim okaże się blokadą, a nie po. Zawartość: SHA commitu, zakres dostarczony, zakres świadomie pominięty (w tym formularz edycji przekazany do UI-03), warunkowy status kryteriów 2.10/2.11 wraz z nazwanym dostawcą fixture'a (OSS-02/QA-02), oraz dwie prośby do OSS z uzasadnieniem i konsumentem. **(a)** `GET /projects/[id]/evidence` z filtrem po `kind` i `taskId` — konsument: sekcja dowodów UI-02 i `EvidenceTable` w UI-05. **(b)** `status` i `progress` w `serializeProjectListRow` wraz z kosztem: `deriveProjectStatus` czyta dziś cztery kolekcje na projekt, więc kolumna statusu na liście wymaga agregatu, nie pętli po `deriveProjectStatus`. Do tego wynik walidacji, znane ograniczenia i luka pokrycia z punktu 1.

#### 3. Zapis odbioru

**Plik:** [Progress planu głównego](../../plan.md#progress)

**Intent:** Odnotować współudział UI-02 w 2.3 i 2.4 bez zaliczania ich samodzielnie.

**Contract:** 2.3 i 2.4 są współodbiorem OSS-02, EXEC-02, UI-02 i QA-02. Status zaznacza jedna wyznaczona osoba, po dowodach od wszystkich czterech stron — nie tutaj i nie w dwóch miejscach naraz. Powstanie tego planu ani plików niczego nie zalicza.

### Success Criteria

#### Automated Verification

- `TC-DELIVERY-UI-002` przechodzi na żywym środowisku i sprząta założone rekordy także przy niepowodzeniu asercji.
- Scenariusz nie zależy od danych demo — przechodzi na świeżym tenancie.
- Pełny zestaw testów modułu przechodzi na tej samej rewizji, na której powstaje handoff; SHA zapisany w `handoff.md`.
- `handoff.md` zawiera SHA, zakres dostarczony, zakres pominięty i obie prośby do OSS z nazwanym konsumentem.

#### Manual Verification

- Osoba z innego strumienia przechodzi flow z `handoff.md` i dochodzi do tych samych ekranów.
- Wyznaczona osoba potwierdza, że 2.3/2.4 pozostają niezaznaczone do czasu dowodów od OSS, EXEC i QA.

**Implementation Note:** O H6 twardy stop. UI-03 startuje o H6 i nie czeka na domknięcie handoffu; niedokończony handoff zapisać z jawną listą braków, zamiast przedłużać okno.

---

## Weryfikacja

### Kontrole automatyczne

```bash
yarn build:packages && yarn generate
yarn workspace @open-mercato/core test --testPathPatterns='delivery_os' --maxWorkers=4
yarn typecheck
yarn lint
yarn i18n:check-sync
yarn i18n:check-usage
git diff --stat -- packages/core/src/modules/delivery_os/{api,commands,data,lib}
```

`generate` jest pierwszy i obowiązkowy — bez niego nowe strony nie trafiają do rejestru modułów, a testy Jest tego nie wykryją.

Ostatnia komenda ma nie zwrócić nic. Runner (local albo Docker) wybrać raz dla całej sekwencji i zapisać w handoffie.

### Kontrola ręczna

1. Wejść na listę z sidebara, założyć projekt formularzem, sprawdzić przekierowanie do szczegółów.
2. Otworzyć projekt bez baseline'u — potwierdzić trzy różne komunikaty w sekcjach i „—" zamiast 0%.
3. Otworzyć projekt z baseline'em i zadaniami, zaznaczyć zadanie, potwierdzić pojawienie się karty enterprise.
4. Odebrać `delivery_agents.execute` albo dezaktywować rozszerzenie i potwierdzić, że karta znika bez pustego miejsca.
5. Odświeżyć stronę z zaznaczonym zadaniem — wybór ma przetrwać.
6. Zmienić projekt w drugiej karcie i spróbować archiwizacji z pierwszej — ma pojawić się konflikt.

## Ryzyka

| Ryzyko | Sygnał | Reakcja |
|---|---|---|
| OSS zmienia serializer listy lub szczegółów w tym samym oknie | Testy UI czerwone po rebase na `dev-mateusz` | Walidacja odpowiedzi schematem wyłapie to jako błąd, nie jako puste dane; uzgodnić z OSS, nie poprawiać po swojej stronie serializera |
| Brak projektu z baseline'em i zadaniami do demonstracji | Nie ma na czym pokazać wyboru zadania ani sekcji wymagań | Kryteria 2.10/2.11 są **warunkowe** i zostają niezaznaczone; zależność zapisana w `handoff.md` przed startem Fazy 2, nie po fakcie. Fixture domenowy należy do OSS-02/QA-02 — jest cięższy niż wygląda: `baselineContentV1Schema` żąda niepustych AC z rozwiązywalnymi `requirementId`, `tokens`, `acTestMap`, `manualChecks` i `declaredTests`, a aktywacja baseline to dwie decyzje przez `POST /baselines/[id]/decisions`. Nie renderować fixture w UI ani nie budować własnego wariantu bez uzgodnienia z QA-02 |
| Enterprise nieaktywne na stanowisku | Karta wykonania nie pojawia się mimo wyboru zadania | To jest jeden z dwóch wymaganych stanów odbioru; udokumentować i pokazać stan pozytywny po aktywacji, nie symulować widgetu |
| Nowa grupa nawigacji koliduje z pracą innego strumienia | Konflikt w plikach i18n albo w sidebarze | Klucze prefiksowane `delivery_os.nav.*`; nie dotykać kluczy `backend.nav.*` |
| Okno 2 h kończy się w Fazie 2 | H6 | Twardy stop; Faza 3 zapisuje stan faktyczny z jawną listą braków. UI-03 startuje planowo |

## References

- Zadanie źródłowe: [UI-02 w strumieniu UI](../03-design-ui.md)
- Kryteria i Progress: [plan główny](../../plan.md#progress) — pozycje 2.3 i 2.4
- Poprzednie zadanie strumienia: [UI-01 — plan](../ui-01/plan.md)
- Harmonogram i przekazania: [README strumieni](../README.md), [kolejna runda](../next-tasks-2026-09-19.md)
- Stan zastany: [raport integracji](../../overnight-integration-2026-09-19.md)
- Wzorce UI: `packages/ui/AGENTS.md` (CrudForm, DataTable), `packages/ui/src/backend/AGENTS.md` (stabilne id `RowActions`, `useGuardedMutation`), `.ai/ui-backend-components.md` (rodzina `SectionHeader`, `CollapsibleSection`, `TabEmptyState` — sprawdzić PRZED budowaniem czegokolwiek od zera)
- Wzorce do skopiowania: lista — `packages/core/src/modules/auth/backend/roles/page.tsx`; guarded delete — `packages/core/src/modules/currencies/backend/currencies/page.tsx:157-201`; tworzenie — `packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx`; `page.meta.ts` — `packages/core/src/modules/directory/backend/directory/tenants/page.meta.ts`
- Optimistic locking: `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx`
- Kontrakt kontekstu hosta: `packages/core/src/modules/delivery_os/lib/contracts.ts:714`

## Progress

> Robocza lista kroków wykonania tego zadania. **Nie jest drugą checklistą odbioru** — status kryteriów 2.3 i 2.4 prowadzi wyłącznie [Progress planu głównego](../../plan.md#progress). Konwencja: `- [ ]` oczekuje, `- [x]` wykonane, po wdrożeniu dopisz ` — <commit sha>`.

### Phase 1: Lista, nawigacja i formularz projektu

#### Automated

- [x] 1.1 `yarn build:packages && yarn generate` przechodzi; rejestr zawiera nową stronę listy. — effc41b072
- [x] 1.2 `yarn workspace @open-mercato/core test --testPathPatterns='delivery_os' --maxWorkers=4` przechodzi. — effc41b072
- [x] 1.3 `yarn typecheck` i `yarn lint` przechodzą. — effc41b072
- [x] 1.4 `yarn i18n:check-sync` i `yarn i18n:check-usage` bez braków; brak nowych literałów użytkownika. — effc41b072
- [x] 1.5 `git diff --stat` nie pokazuje zmian w `api/`, `commands/`, `data/`, `lib/`. — effc41b072
- [x] 1.6 Testy pokrywają odpowiedzi 200/409/404 archiwizacji i obecność nagłówka optimistic lock. — effc41b072
- [x] 1.7 Test potwierdza, że wiersz bez `updatedAt` nie wysyła DELETE. — effc41b072

#### Manual

- [ ] 1.8 Grupa Delivery widoczna w sidebarze; lista dostępna bez wpisywania URL-a.
- [ ] 1.9 Utworzenie projektu formularzem kończy się na jego szczegółach.
- [ ] 1.10 Archiwizacja rekordu zmienionego równolegle pokazuje konflikt, nie cichy sukces.

### Phase 2: Sekcje szczegółów i wybór zadania

#### Automated

- [x] 2.1 Siedem istniejących testów szczegółów przechodzi bez zmiany ich asercji.
- [x] 2.2 Trzy rozłączne komunikaty: brak baseline'u, brak zadań, brak endpointu dowodów.
- [x] 2.3 `percent: null` nie renderuje się jako wartość procentowa.
- [x] 2.4 `attemptRegisterReadable: false` daje komunikat inny niż brak prób.
- [x] 2.5 Wybór zadania trafia do `context.taskId` walidowanego schematem; zniknięcie zadania po refetchu czyści wybór.
- [x] 2.6 Błąd jednego źródła sekcji nie odmontowuje `InjectionSpot`.
- [x] 2.7 Węzeł `[data-testid="delivery-execution-action"]` obecny z właściwym `data-task-id` i nieobecny po odebraniu `delivery_agents.execute`.
- [x] 2.8 `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn lint`, `yarn typecheck` przechodzą.
- [x] 2.9 `git diff --stat` nadal nie pokazuje zmian w `api/`, `commands/`, `data/`, `lib/`.

#### Manual

- [ ] 2.10 **Warunkowe (fixture OSS-02/QA-02):** wymagania z powiązanymi AC i ekrany z wersją Figmy widoczne dla projektu z baseline'em.
- [ ] 2.11 **Warunkowe (ten sam fixture):** zrzuty obu stanów montowania rozszerzenia, z adnotacją że widoczna karta powstaje w EXEC-04.
- [ ] 2.12 Sekcja dowodów nazywa brak endpointu, nie brak dowodów.

### Phase 3: Dowód przejścia flow i przekazanie

#### Automated

- [ ] 3.1 `TC-DELIVERY-UI-002` przechodzi i sprząta rekordy także przy niepowodzeniu asercji.
- [ ] 3.2 Scenariusz przechodzi na świeżym tenancie, bez danych demo.
- [ ] 3.3 Pełny zestaw testów modułu przechodzi na rewizji zapisanej w `handoff.md`.
- [ ] 3.4 `handoff.md` zawiera SHA, zakres dostarczony, zakres pominięty i obie prośby do OSS.

#### Manual

- [ ] 3.5 Osoba z innego strumienia przechodzi flow z `handoff.md`.
- [ ] 3.6 Wyznaczona osoba potwierdza, że 2.3/2.4 pozostają niezaznaczone do czasu dowodów od OSS, EXEC i QA.
