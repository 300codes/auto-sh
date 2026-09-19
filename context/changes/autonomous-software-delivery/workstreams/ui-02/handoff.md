# UI-02 — przekazanie

> Szkielet założony na starcie Fazy 2, uzupełniony w Fazie 3. Ten plik **nie zalicza** żadnego kryterium
> [planu głównego](../../plan.md#progress) — 2.3 i 2.4 są współodbiorem OSS-02, EXEC-02, UI-02 i QA-02
> i zaznacza je jedna wyznaczona osoba po dowodach od wszystkich czterech stron.

- **Rewizja, na której przechodzi pełny zestaw testów modułu (52 suity / 1174 testy):** `0e9f1d6d69` (Faza 3,
  gałąź `feature/design-ui`). Fazy poprzedzające: `effc41b072` (Faza 1), `c83163ae2c` (Faza 2).
- **Runner walidacji:** **local**. W `docker ps` działają tylko `mercato-postgres` i `mercato-meilisearch`;
  kontenera `app` nie ma, więc tryb Docker nie ma zastosowania.
- **Uwaga o środowisku:** drzewo nie miało `node_modules` — przed pierwszą bramką wykonano
  `yarn install --immutable` (native build `cpu-features` nie przechodzi; to opcjonalna zależność `ssh2`, nie blokuje).
- **Review wdrożenia:** [`reviews/impl-review.md`](reviews/impl-review.md) — 0 critical, 6 warnings, 4 observations.
  Po triażu naprawiono F2–F7 i F9; F1 przyjęto jako ryzyko (patrz niżej), F8 zamieniono na trzecią prośbę do OSS,
  F10 nie wymagało działania. Jedna podpowiedź z F10 — wyeksportowanie stałej `data-testid` z `lib/contracts.ts` —
  **nie została wykonana**, bo `lib/` to powierzchnia OSS, której UI-02 nie wolno dotykać; do uzgodnienia z OSS.

## Zależność zapisana z góry: fixture domenowy

Kryteria **2.10** i **2.11** w Progress tego planu są **warunkowe** i pozostają **niezaznaczone**.
Oba wymagają projektu z **aktywnym** baseline i co najmniej jednym zadaniem. UI-02 takiego fixture'a
**nie tworzy** i nie będzie tworzyć:

- `baselineContentV1Schema` żąda niepustych `acceptanceCriteria`, każdego `requirementId` rozwiązującego się
  do wymienionego wymagania, plus `tokens`, `acTestMap`, `manualChecks` i `declaredTests`,
- zamrożenie draftu wymaga `delivery_os.projects.manage` i nagłówka blokady,
- zadanie potrzebuje `acIds` i `allowedPaths` w rootach profilu,
- aktywacja baseline to **dwie** decyzje przez `POST /baselines/[id]/decisions` (`requirements` i `design`).

**Dostawca fixture'a: OSS-02 / QA-02.** Do czasu jego dostarczenia pokrycie wyboru zadania oraz sekcji
wymagań/designu opiera się na testach komponentowych
(`components/detail/__tests__/sections.test.tsx`, `backend/delivery/projects/[id]/__tests__/executionHost.test.tsx`).

## Zakres dostarczony

**Nawigacja i lista**
- `backend/delivery/projects/page.meta.ts` + `page.tsx` — grupa **Delivery** w sidebarze głównym,
  guard `delivery_os.projects.view`. Po dodaniu stron uruchomiono `yarn build:packages && yarn generate`;
  rejestr modułów zawiera `/backend/delivery/projects` wraz z polami nawigacji.
- `components/projects/DeliveryProjectListClient.tsx` — `DataTable` na `GET /api/delivery_os/projects`
  z wyszukiwaniem, sortowaniem (`name`/`createdAt`/`updatedAt`), paginacją (`pageSize` 50) i przełącznikiem
  `includeArchived`. **Bez kolumny statusu i postępu** — lista ich nie zwraca. Bez przycisku eksportu
  (`export: { enabled: false }` po stronie OSS). Odpowiedź walidowana schematem przed użyciem.

**Tworzenie projektu**
- `backend/delivery/projects/create/{page.meta.ts,page.tsx}` — guard `delivery_os.projects.manage`,
  `navHidden`, breadcrumb do listy. Pola dokładnie z `projectCreateSchema`; `draftSpec` poza formularzem.
  Profil docelowy jest jednym selectem `id@version` — nie da się wybrać nieistniejącej pary.
- `components/projects/DeliveryProjectForm.tsx` — shell bez wiedzy o trybie (przyjmuje `fields`,
  `initialValues`, `onSubmit`, `optimisticLockUpdatedAt`), przygotowany pod owinięcie trybem edycji przez UI-03.

**Archiwizacja z listy**
- `DELETE /api/delivery_os/projects?id=<uuid>` przez `useGuardedMutation(...).runMutation(...)`,
  owinięte `withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), …)`.
- **Wiersz bez `updatedAt` nie ma akcji archiwizacji**, a handler i tak odmawia wysłania żądania.
  Powód: `enforceCommandOptimisticLockWithGuards` przepuszcza żądanie bez nagłówka (`assertOptimisticLock`
  wraca cicho przy braku oczekiwanej wersji), więc DELETE bez nagłówka dałby **200 i cichą archiwizację
  bez kontroli wersji**, nie 409.
- Cztery rozłączne gałęzie: 200 → flash + reload; 409 `optimistic_lock_conflict` → wspólny
  `RecordConflictBanner` przez `surfaceRecordConflict`; 409 domenowy (`attempt_active`,
  `reconciliation_required`) → komunikat nazywający aktywną/nieuzgodnioną próbę, **nie** „ktoś inny zmienił
  rekord"; 404 → utrata scope + odświeżenie listy.

**Szczegóły projektu**
- `components/detail/useProjectSections.ts` — baseline'y i zadania pobierane **niezależnie**, każde z własnym
  stanem `loading|error|ready`, własną funkcją ponowienia i własnym guardem sekwencji. Błąd jednego źródła
  nie odmontowuje pozostałych sekcji ani `InjectionSpot`.
- Cztery sekcje w `components/detail/` (prezentacyjne, dane dostaje z góry):
  wymagania z powiązanymi AC, design (metadanowy), zadania z wyborem, dowody.
- **Trzy rozłączne komunikaty** dla trzech różnych stanów: „projekt nie ma jeszcze baseline'u",
  „baseline bez zaplanowanych zadań", „lista dowodów niedostępna, bo nie ma endpointu odczytu".
  Do tego czwarty, osobny: „treść aktywnego baseline'u nieczytelna" — nigdy jako pusta sekcja.
- `percent: null` renderowany jako „—", nigdy jako 0%.
- Rejestr prób w trzech rozłącznych stanach: brak prób / próby wypisane / `attemptRegisterReadable: false`.
- Wybór zadania trzymany w query param (`?taskId=`), więc przeżywa reload i daje deep-link;
  po refetchu weryfikowany względem listy — zniknięcie zadania czyści wybór zamiast montować martwe id.
- `taskId` wchodzi do `executionWidgetContextV1`; **wersja kontraktu bez zmian** (`taskId` był już `nullable`).
  `refresh` przekazany do widgetu odświeża projekt **i** sekcje.

**Granica własności utrzymana.** `git status --porcelain -- .../delivery_os/{api,commands,data,lib}` jest pusty
na całej zmianie. Jedyny plik poza modułem to wygenerowany rejestr ikon
`packages/ui/src/backend/icons/lucideRegistry.generated.tsx` (efekt `yarn generate` po dodaniu ikony nawigacji).

## Zakres świadomie pominięty

- **Formularz edycji projektu** — przekazany do UI-03. `DeliveryProjectForm` jest przygotowany:
  UI-03 podaje pola z `projectUpdateSchema` i `initialValues.updatedAt`, bez dotykania tego komponentu.
  Powód wycięcia: dwie fiddliwe części (odłożony mount `CrudForm` do czasu pobrania `initialValues`,
  plumbing `updatedAt`) nie mieszczą się w oknie, a edycja nie występuje ani w `03-design-ui.md`,
  ani w Desired End State UI-02.
- **Podglądy ekranów z `attachmentId`** — sekcja designu jest metadanowa (nazwa, `nodeId`, viewport,
  `figmaVersion`, skrócony `sha256`, `capturedAt`). Miniatury z modułu `attachments` należą do UI-03.
- **Zatwierdzanie/odrzucanie decyzji** — historia decyzji jest read-only, bez żadnego przycisku (UI-03).
- **Advanced filters, presety, bulk actions, eksport listy** — poza zakresem.
- **Ekran zadań i UI wykonania / manual handoff** — UI-04.
- **Fixture pod sekcje z baseline'em** — patrz wyżej, OSS-02/QA-02.

## Prośby do OSS

### (a) `GET /projects/[id]/evidence` z filtrem po `kind` i `taskId`

Dziś `api/projects/[id]/evidence/route.ts` eksportuje **wyłącznie `POST`** — nie ma odczytu.
UI-02 **nie podstawia fixture'a**: sekcja dowodów mówi wprost, że lista jest niedostępna z powodu
brakującego endpointu, a nie że dowodów nie ma. Bez tego rozróżnienia odbierający wyciągnąłby wniosek,
że dowodów nie zarejestrowano.

- **Konsument:** sekcja dowodów UI-02 (`components/detail/EvidenceSection.tsx`) oraz `EvidenceTable` w UI-05.
- **Kształt sugerowany:** `{ items, total }` jak `baselines`/`tasks`, z query `kind` i `taskId`.

### (b) `status` i `progress` w `serializeProjectListRow`

`serializeProjectListRow` (`api/serializers.ts:17`) zwraca surowe pola encji. `status`, `progress`,
`taskCounts` i `attention` liczy `deriveProjectStatus` **wyłącznie** w route szczegółów.

- **Konsument:** kolumna statusu i postępu na liście projektów (UI-02 świadomie jej nie dodało).
- **Koszt, który trzeba nazwać:** `deriveProjectStatus` czyta dziś **cztery kolekcje na projekt**
  (baselines, tasks, evidence, decisions). Kolumna statusu na liście wymaga **agregatu**, nie pętli po
  `deriveProjectStatus` per wiersz — inaczej strona listy z 50 projektami robi 200 zapytań.
- UI-02 nie doliczało statusu po stronie klienta, żeby nie powstało drugie miejsce z logiką statusu.

### (c) Paginacja `GET /projects/[id]/tasks` i `GET /projects/[id]/baselines`

Oba route'y zwracają **wszystkie** nieusunięte rekordy, bez `limit` i bez parametrów stronicowania
(`api/projects/[id]/tasks/route.ts` → `findWithDecryption` z samym `orderBy`). Sekcje szczegółów renderują
je w całości; lista projektów tnie na 50, więc ekran szczegółów jest jedyną nieograniczoną powierzchnią
tej zmiany. Dziś nie ma projektu, który by to przełamał — ale przełamie go pierwszy realny plan.

- **Konsument:** sekcje zadań i designu UI-02 oraz ekran zadań UI-04.
- **Kształt sugerowany:** `page`/`pageSize` jak w `projectListQuerySchema`, odpowiedź `{ items, total, totalPages }`.
- UI-02 świadomie nie dokłada sztucznego cięcia po stronie klienta: bez API byłby to półśrodek do usunięcia,
  a licznik „pokazano N z M" bez `total` z serwera kłamałby o reszcie.

## Wynik walidacji, ograniczenia i luki pokrycia

### Co przeszło (runner: local)

| Komenda | Wynik |
|---|---|
| `yarn build:packages && yarn generate` | OK; rejestr zawiera `/backend/delivery/projects` z polami nawigacji |
| `yarn workspace @open-mercato/core test --testPathPatterns='delivery_os' --maxWorkers=4` | 52 suity / 1174 testy — OK |
| `yarn typecheck` | 40/40 zadań OK |
| `yarn lint` | 0 błędów |
| `yarn i18n:check-sync` | wszystkie 5 locale w synchronizacji |
| `yarn i18n:check-usage` | exit 0, brak brakujących kluczy |
| `yarn i18n:check-hardcoded` | brak zgłoszeń dla `delivery_os` |
| `git status --porcelain -- .../delivery_os/{api,commands,data,lib}` | pusty |

### Czego NIE udało się wykonać

**`TC-DELIVERY-UI-002` nie został uruchomiony na żywym środowisku.** Spec jest napisany i samosprzątający,
ale lokalna instancja nie jest zainicjalizowana: baza `open-mercato` nie ma tabel `delivery_*`
(migracje modułu nigdy nie zostały zaaplikowane), tabela `users` jest pusta (brak konta admina do logowania),
a serwer dev nie działa. Doprowadzenie do stanu wykonywalnego wymaga `yarn db:migrate` i `yarn initialize`,
czyli operacji, których `AGENTS.md` zabrania wykonywać bez zgody.

W konsekwencji **kryteria 3.1 i 3.2 pozostają niezaznaczone.** Nie zostały obejrzane jako zrobione.

**To jest świadoma decyzja prowadzącego zmianę (2026-09-19), nie przeoczenie.** Uruchomienie specu odłożono
do momentu, w którym środowisko będzie gotowe — najpewniej razem z fixture'em domenowym od OSS-02/QA-02,
który i tak jest potrzebny do 2.10/2.11.

### Ryzyko przyjęte świadomie po review wdrożenia

**Sekcja zadań mówi „brak baseline'u" także wtedy, gdy stan baseline'u jest nieznany.**
`hasActiveBaseline` ma typ `boolean | null`; host podaje `null` dla każdego stanu `/baselines` innego niż
`ready`, a render zwija `null` do gałęzi negatywnej. Skutek: przy trwałym błędzie `GET /projects/{id}/baselines`
sekcja zadań poda **nieprawdziwą przyczynę** braku zadań (powie „nie ma baseline'u", gdy w rzeczywistości nie
udało się go pobrać — co sekcje obok pokazują poprawnie jako błąd). Finding F1 z review wdrożenia;
**decyzja: przyjęte, nie naprawiane w UI-02.** Naprawa to jedna zmiana warunku w `TasksSection.tsx`
(nie renderować pustego stanu, dopóki `hasActiveBaseline === null`) — do wzięcia przez UI-03 albo UI-04.

### Luki pokrycia, które trzeba znać

1. **Wybór zadania i sekcje z baseline'em nie mają pokrycia integracyjnego.** `TC-DELIVERY-UI-002` prowadzi
   projekt **bez** baseline'u (bo tylko taki UI-02 potrafi utworzyć samodzielnie). Ścieżka z aktywnym baseline
   i zadaniami jest pokryta wyłącznie testami komponentowymi. Domknie ją fixture od OSS-02/QA-02.
2. **Widget EXEC-02 jest pustym szkieletem.** `widget.client.tsx` renderuje pusty
   `<div data-testid="delivery-execution-action">`. Podanie realnego `taskId` przełącza więc div o zerowej
   wysokości z nieobecnego na obecny — **dla oka operatora oba stany są identyczne**. UI-02 dowodzi
   **montowania** (obecność węzła DOM z właściwym `data-task-id` oraz jego brak po odebraniu
   `delivery_agents.execute` albo przy nieaktywnym rozszerzeniu). **Widoczna karta wykonania powstaje w EXEC-04**
   i musi być tak zapisana przy współodbiorze 2.3/2.4. Pokazanie pustego diva jako „karty wykonania"
   byłoby fikcyjnym PASS.
3. **Test hosta rozszerzenia używa stand-inu widgetu, nie kodu enterprise.**
   `__tests__/module-registration.test.ts` zawiera twardy guard: żaden plik `delivery_os` nie może importować
   `@open-mercato/enterprise` ani `delivery-cezar`. Dlatego `executionHost.test.tsx` rejestruje własny komponent
   odtwarzający kontrakt DOM szkieletu EXEC-02 i przepuszcza go przez **realny** `InjectionSpot` z **realnym**
   filtrowaniem ACL i realnym routingiem po `spotId`. Testowany jest host i runtime wstrzykiwania;
   wnętrze widgetu dowodzi się tam, gdzie widget mieszka.
4. **Archiwizacja w `TC-DELIVERY-UI-002` trafia w pozycję menu po klasie `text-destructive`**, nie po etykiecie —
   spec jest odporny na locale. Jeśli `RowActions` zacznie wystawiać `data-*` z id pozycji, warto przepiąć.

## Kontrola ręczna, której nikt jeszcze nie wykonał

Pozycje Progress **1.8, 1.9, 1.10, 2.10, 2.11, 2.12, 3.5 i 3.6** wymagają człowieka przy działającej aplikacji
i pozostają niezaznaczone. Kolejność do powtórzenia:

1. Wejść na listę z sidebara (grupa **Delivery**), bez wpisywania URL-a.
2. Założyć projekt formularzem — ma przekierować na jego szczegóły.
3. Na projekcie bez baseline'u potwierdzić **trzy różne** komunikaty w sekcjach i „—" zamiast 0%.
4. Otworzyć projekt z baseline'em i zadaniami (fixture OSS-02/QA-02), zaznaczyć zadanie, sprawdzić w DOM
   obecność `[data-testid="delivery-execution-action"]` z `data-task-id`.
5. Odebrać `delivery_agents.execute` albo dezaktywować rozszerzenie — węzeł ma zniknąć.
6. Odświeżyć stronę z zaznaczonym zadaniem — wybór ma przetrwać (`?taskId=`).
7. Zmienić projekt w drugiej karcie i spróbować archiwizacji z pierwszej — ma pojawić się baner konfliktu.
