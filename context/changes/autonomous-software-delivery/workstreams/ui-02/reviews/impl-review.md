<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UI-02 — Szkielet projektu i host rozszerzenia

- **Plan**: [`../plan.md`](../plan.md)
- **Scope**: Fazy 1–3 (cały plan) — `4cd516cfd7..HEAD` (`effc41b072`, `c83163ae2c`, `0e9f1d6d69`, `65140bcfb7`)
- **Date**: 2026-09-19
- **Runner**: local (brak kontenera `app`)
- **Verdict (przed triażem)**: NEEDS ATTENTION
- **Verdict (po triażu)**: SOUND — 8 findingów naprawionych, F1 przyjęty jako udokumentowane ryzyko, F10 bez działań
- **Findings**: 0 critical · 6 warnings · 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Zweryfikowane niezależnie (nie przyjęte na słowo)

| Kontrola | Wynik |
|---|---|
| `git diff 4cd516cfd7..HEAD -- delivery_os/{api,commands,data,lib}` | **pusty** — granica własności utrzymana |
| `[id]/__tests__/page.test.tsx` w diffie | **brak zmian** (0 bajtów różnicy) |
| „Siedem istniejących testów" | **potwierdzone**: 3 `it` + `it.each` na 4 przypadkach = 7; wszystkie przechodzą |
| `yarn workspace @open-mercato/core test --testPathPatterns='delivery_os'` | 52 suity / **1174 testy** OK — zgodne z handoffem |
| `yarn typecheck` | 40/40 zadań OK |
| `yarn lint` | 0 błędów (10 ostrzeżeń, żadne w `delivery_os`) |
| `yarn i18n:check-sync` | OK |
| `yarn i18n:check-usage` | exit 0, brak brakujących kluczy |
| Rejestr modułów | `/backend/delivery/projects` obecny z polami nawigacji (`backend-routes.generated.ts:1613`) |
| Parity i18n | 133 klucze × 5 locale, 0 brakujących, 0 nadmiarowych, porządek alfabetyczny OK; tłumaczenia realne (3–9 zbieżności z EN, wyłącznie terminy techniczne) |
| Skan DS | **0 twardych kolorów Tailwind, 0 arbitrary values, 0 `dark:` na tokenach statusu** w 11 zmienionych `.tsx` |
| Progress planu głównego | 2.3/2.4 **niezaznaczone** — dopisana wyłącznie nota o współodbiorze |

### Punkty z briefu przeglądu — rozstrzygnięcia

1. **Granica własności** — czysta, patrz tabela.
2. **Archiwizacja bez nagłówka** — **niemożliwa**. Podwójny guard: `rowActions` nie wystawia pozycji `delete` dla wiersza bez `updatedAt` (`DeliveryProjectListClient.tsx:232`), a `handleArchive` i tak wychodzi wcześniej (`:126-129`). Cztery gałęzie **są rozłączne**: zweryfikowałem realny `surfaceRecordConflict` (`packages/ui/src/backend/conflicts/index.ts`) i `extractOptimisticLockConflict` (`packages/ui/src/backend/utils/optimisticLock.ts:46-70`) — zwracają dopasowanie **wyłącznie** dla `code === 'optimistic_lock_conflict'` ze stringowymi `currentUpdatedAt`/`expectedUpdatedAt`; `attempt_active`/`reconciliation_required` (`lib/contracts.ts:32,38` → 409) przepadają dalej i trafiają na `archive.blocked`. Komunikat domenowy brzmi *„Archiving was refused: the project has an active or unreconciled execution attempt."* — **nie twierdzi**, że rekord zmienił ktoś inny. Brak podwójnego banera: `showRecordConflict` to store jednoelementowy z semantyką „pokaż lub zastąp" (`conflicts/store.ts:63`).
3. **Trzy puste stany** — trzy różne klucze i trzy realnie różne komunikaty (zweryfikowane na `en.json`); `percent: null` → `'—'` (`EvidenceSection.tsx:122`), nigdy 0%. Czwarty, osobny stan „baseline nieczytelny". Zastrzeżenie do siły asercji: **F3**.
4. **`attemptRegisterReadable: false`** — odróżnione, własny komunikat i własny `data-testid` (`TasksSection.tsx:39-45`), test pokrywa oba stany naraz na dwóch zadaniach.
5. **Test hosta rozszerzenia** — **nie jest fikcyjnym PASS**. Guard jest realny (`__tests__/module-registration.test.ts:64,194`), a test przepuszcza stand-in przez **realny** `InjectionSpot` z **realnym** filtrem ACL (`InjectionSpot.tsx:69-82`, `hasAllFeatures`) i realnym spotem. Stand-in odtwarza kontrakt DOM prawdziwego widgetu co do znaku (`widget.client.tsx:24`) i jego cechę. Ograniczenie jest uczciwie nazwane w handoffie (luka 3). Zastrzeżenia: **F6** (asercja kontraktu) i **F10** (nic nie pilnuje zgodności stand-inu z oryginałem).
6. **Siedem testów szczegółów** — plik nietknięty, 7 przypadków przechodzi.
7. **Design system** — czysto; zastrzeżenia dotyczą wyłącznie doboru komponentów, nie kolorów (**F7**).

## Findings

### F1 — Sekcja zadań twierdzi „brak baseline'u", gdy stan baseline'u jest nieznany

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality / Plan Adherence
- **Location**: `packages/core/src/modules/delivery_os/components/detail/TasksSection.tsx:85-98` (+ `backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx:166`)
- **Detail**: `hasActiveBaseline` jest typu `boolean | null` — autor **zamodelował trzeci stan** — ale render zwija go ternarnym operatorem do gałęzi negatywnej: `t(hasActiveBaseline ? '…baselineWithoutTasks' : '…noBaseline')`. Host podaje `null` dla **każdego** stanu baseline'ów innego niż `ready` (`:121-123`). Ponieważ `useProjectSections` strzela oboma żądaniami niezależnie, projekt z aktywnym baseline i zerem zadań pokaże *„No tasks, because the project has no approved baseline"* przez całe okno wyścigu — i **na stałe**, jeśli `GET /baselines` padnie. To dokładnie ta klasa fałszywego twierdzenia, którą plan wyklucza (plan.md:59, plan.md:171 — „odpowiedź, która nie przechodzi walidacji, jest błędem, nie pustą listą"). Niepokryte testem: jedyny przypadek z `hasActiveBaseline={null}` (`sections.test.tsx:243`) łączy go ze `state: 'error'`, który zwiera się wcześniej.
- **Fix A ⭐ Recommended**: Nie renderować pustego stanu zadań, dopóki `hasActiveBaseline === null` — pokazać neutralny placeholder albo nic, i odsłonić komunikat dopiero po rozstrzygnięciu baseline'ów.
  - Strength: Zachowuje trzystanowość, którą typ już deklaruje; zero nowych kluczy i18n; niemożliwe wypowiedzenie zdania o domenie bez danych.
  - Tradeoff: Przez chwilę sekcja zadań jest wizualnie pusta mimo `ready`.
  - Confidence: HIGH — jedna zmiana warunku w jednym pliku, reszta kontraktu bez zmian.
  - Blind spot: Nie sprawdzałem, czy QA-02 opiera scenariusz na natychmiastowej obecności tego komunikatu.
- **Fix B**: Dodać czwarty komunikat („nie wiadomo, czy projekt ma baseline — nie udało się go pobrać") w pięciu locale.
  - Strength: Operator dostaje wprost informację, że sekcja obok zawiodła, zamiast ciszy.
  - Tradeoff: Pięć nowych wpisów i18n i jeszcze jeden stan do utrzymania; duplikuje błąd już pokazany w sekcjach baseline'owych.
  - Confidence: MEDIUM — poprawne, ale rozmieniające plan „trzy komunikaty" na pięć.
  - Blind spot: Może wyglądać jak podwójny błąd na jednym ekranie.
- **Decision**: ACCEPTED — ryzyko przyjęte świadomie przez prowadzącego zmianę (triaż 2026-09-19). Nie naprawiane w UI-02; zapisane jako znane ograniczenie w [`../handoff.md`](../handoff.md) → „Ryzyko przyjęte świadomie po review wdrożenia", z gotową jednolinijkową naprawą do wzięcia przez UI-03/UI-04.

### F2 — `TC-DELIVERY-UI-002` archiwizuje pierwszy wiersz, niekoniecznie własny fixture

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality / Success Criteria
- **Location**: `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-UI-002.spec.ts:117-137`
- **Detail**: Po wpisaniu nazwy w wyszukiwarkę spec asertuje tylko `await expect(projectLink).toBeVisible()` — czyli że link jest **gdziekolwiek** w tabeli — po czym otwiera `page.getByRole('button', { name: /open actions/i }).first()`, menu **pierwszego wiersza**, i archiwizuje to, co tam jest. `FilterBar` debounce'uje wyszukiwanie, więc kliknięcie potrafi trafić w listę jeszcze nieprzefiltrowaną; przy domyślnym `createdAt desc` fixture zwykle bywa pierwszy, ale nic tego nie wymusza. `expect(archived.status()).toBe(200)` przejdzie tak czy owak, a `finally` zarchiwizuje jeszcze fixture — czyli **dwa** projekty. W dzielonym tenancie QA to zniszczenie cudzego rekordu. Spec **nigdy nie był uruchomiony**, więc nikt tego nie zaobserwował.
- **Fix**: Zawęzić trigger do wiersza zawierającego `projectLink` (`page.locator('tr', { has: projectLink }).getByRole('button', …)`) i doasertować, że `archived.url()` zawiera `projectId`.
- **Decision**: FIXED — trigger akcji zawężony do wiersza zawierającego link tego projektu (`page.locator('tr', { has: … })`), dodane oczekiwanie na przefiltrowaną odpowiedź listy (debounce) oraz asercja `archived.url()` zawiera `projectId`.

### F3 — Asercja „trzy różne komunikaty" jest strukturalnie gwarantowana, więc nie może upaść

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; naprawa oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: `components/detail/__tests__/sections.test.tsx:349`; `__integration__/TC-DELIVERY-UI-002.spec.ts:110`
- **Detail**: Oba miejsca dowodzą rozłączności przez `expect(new Set([a, b, c]).size).toBe(3)`, gdzie `a/b/c` to `container.textContent` / `innerText` **trzech różnych sekcji**. Te teksty różnią się już samymi nagłówkami sekcji, więc asercja przeszłaby, gdyby wszystkie trzy puste stany miały identyczną treść. W teście komponentowym ratunkiem są trzy linie `toContain(<klucz>)` tuż wyżej (`:346-348`) — realnie pinują trzy różne klucze. **Spec integracyjny nie ma tej przeciwwagi**, a to właśnie on jest kryterium 3.1, czyli żywym dowodem centralnego rozróżnienia planu. Dodatkowo w testach komponentowych `t` zwraca klucz, więc dowodzą różnicy **kluczy**, nie treści (treści sprawdziłem ręcznie na `en.json` — są realnie różne).
- **Fix**: W obu miejscach porównywać treść samych węzłów pustego stanu (a nie całych sekcji), a w specu dodać trzy asercje na rozłączne, konkretne fragmenty komunikatów.
- **Decision**: FIXED — oba miejsca porównują teraz treść samych węzłów pustego stanu (`delivery-requirements-section-empty`, `delivery-tasks-empty`, `delivery-evidence-list-unavailable`), z trzema asercjami parami różnych i kontrolą niepustości. Spec integracyjny dostał tę przeciwwagę, której wcześniej nie miał.

### F4 — Nowe pobrania sekcji nie unieważniają się przy zmianie organizacji

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; naprawa oczywista i wąska
- **Dimension**: Pattern Consistency / Architecture
- **Location**: `components/detail/useProjectSections.ts:200` (deps `[projectId, path, parse]`); `backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx:92`
- **Detail**: Lista robi to poprawnie — `useOrganizationScopeVersion()` (`DeliveryProjectListClient.tsx:57`) siedzi w zależnościach pobrania (`:121`), dokładnie jak wymagał plan. `useProjectSections` (kod **nowy**, napisany w tej zmianie) skopiował dyscyplinę guardu sekwencji, ale nie dyscyplinę scope'u: ani `useProjectResource`, ani `refreshProject` nie reagują na przełączenie organizacji. Efekt: po zmianie organizacji w topbarze sekcje wymagań, designu i zadań zostają z danymi poprzedniego scope'u aż do ręcznego „Retry". To nie jest wyciek serwerowy — dane były autoryzowane w poprzednim kontekście — ale AGENTS.md jest kategoryczne w sprawie scope'owania, a bratni komponent zrobił to dobrze. Wzorzec dla strony szczegółów: `warranty_claims/backend/warranty_claims/[id]/page.tsx`.
- **Fix**: Dodać `useOrganizationScopeVersion()` do zależności obu pobrań (hooka sekcji i `refreshProject`).
- **Decision**: FIXED — `useOrganizationScopeVersion()` dodany do zależności obu pobrań sekcji (`useProjectResource`) oraz do `refreshProject` w hoście.

### F5 — Testy rozgałęzienia 409 dowodzą zachowania mocka, nie kształtu realnego błędu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; naprawa oczywista i wąska
- **Dimension**: Success Criteria (kryterium 1.6)
- **Location**: `backend/delivery/projects/__tests__/list.test.tsx:67-69,182-201`
- **Detail**: `surfaceRecordConflict` jest podmieniony w całości, a test sam ustawia jego wartość zwracaną (`mockReturnValue(true)` / `false`). Dowodzi więc wyłącznie kolejności w `catch`. Nie dowodzi, że błąd, który lista faktycznie rzuca — `Object.assign(new Error('[internal] …'), { status: call.status, ...((call.result as Record<string, unknown> | null) ?? {}) })` (`DeliveryProjectListClient.tsx:144-147`) — ma kształt, który realny `extractOptimisticLockConflict` rozpozna. Zweryfikowałem ręcznie, że **dziś rozpozna** (spread wnosi `code`, `currentUpdatedAt`, `expectedUpdatedAt` na poziom główny, a żadne ciało błędu `delivery_os` nie niesie pola `status`, które nadpisałoby kod HTTP) — ale nic tego nie pilnuje. Zepsucie spreadu zamienia konflikt wersji w ogólny flash, a test zostanie zielony.
- **Fix**: Zaasertować przechwycony argument realnym helperem: `expect(extractOptimisticLockConflict(surfaceRecordConflictMock.mock.calls[0][0])).toBeTruthy()`, i symetrycznie `toBeNull()` w przypadku domenowym.
- **Decision**: FIXED — testy asertują przechwycony argument realnym `extractOptimisticLockConflict` (niemockowanym): `toBeTruthy()` dla konfliktu wersji i `toBeNull()` dla 409 domenowego.

### F6 — Kryterium 2.5 („kontekst walidowany schematem") jest asertowane na literale napisanym w teście

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; naprawa oczywista i wąska
- **Dimension**: Success Criteria
- **Location**: `backend/delivery/projects/[id]/__tests__/executionHost.test.tsx:152-167`
- **Detail**: Test „keeps the context valid against the frozen contract once a task is selected" buduje obiekt **w ciele testu** i waliduje go `executionWidgetContextV1Schema`. Nie dotyka kontekstu, który host złożył (`DeliveryProjectDetailClient.tsx:75-83,125-129`). Host mógłby wysłać zły `schemaVersion`, zgubić `baselineId` albo podać nieświeży `updatedAt` — asercja zostaje zielona. Łagodzące: (a) istniejący `page.test.tsx:52` waliduje **realny** kontekst hosta (dla `taskId: null`), (b) samo przepłynięcie `taskId` do widgetu jest dowiedzione atrybutem `data-task-id` na realnej ścieżce. Zostaje jednak dziura: `widgetContext` przy nieudanym `safeParse` **po cichu** wraca do kontekstu z `taskId: null` (`:128`) zamiast sygnalizować cokolwiek — i żaden test tego nie dotyka.
- **Fix**: Kazać stand-inowi zapisać otrzymany `context` i uruchomić `safeParse` na **nim**, dodatkowo asertując `taskId`, `baselineId` i `updatedAt`.
- **Decision**: FIXED — stand-in zapisuje otrzymany `context`, a test waliduje **ten** obiekt schematem i dodatkowo asertuje `schemaVersion`, `projectId`, `taskId`, `baselineId` i `updatedAt`.

### F7 — Trzy odstępstwa od reguł design systemu na poziomie doboru komponentów i copy

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; naprawa oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: `components/detail/EvidenceSection.tsx:203-209`; `components/detail/TasksSection.tsx:24-29`; `i18n/{en,pl,de,es,ko}.json` klucz `delivery_os.project.sections.baselineVersion`
- **Detail**: Kolory i tokeny są **bez zarzutu** (skan: zero naruszeń). Zastrzeżenia dotyczą czego innego: (a) ręcznie złożony baner informacyjny `rounded border border-status-info-border bg-status-info-bg …` zamiast `Alert` — `.ai/ds-rules.md:130` nakazuje `Alert` dla komunikatów inline; (b) własna mapa `statusVariant(status) → Badge variant` zamiast `StatusBadge` z `StatusMap` — `.ai/ds-rules.md:243` („USE `StatusBadge` for entity status display"); (c) `"Baseline v{version} · {hash}"` używa middota, wprost zakazanego przez `.ai/ds-rules.md:239` — w pięciu locale naraz. Powiązane, ale **zastane**: `DeliveryProjectDetailClient.tsx:152` renderuje status projektu jako `Badge variant="secondary"` (plan nakazał nie ruszać tego bloku).
- **Fix**: `Alert status="information" size="sm"`, `StatusBadge` + `StatusMap` w module, middot → em dash w pięciu plikach (`yarn i18n:fix` znormalizuje).
- **Decision**: FIXED — ręczny baner zastąpiony `Alert status="information"`, mapa statusów zadań przeniesiona na `StatusBadge` + `StatusMap<TaskDto['status']>` (`deliveryTaskStatusMap`), middot zamieniony na em dash w pięciu locale. API wszystkich trzech komponentów zweryfikowane przed podmianą.

### F8 — Strona szczegółów renderuje nieograniczone listy zadań i baseline'ów, a handoff tego nie zgłasza

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — realny kompromis; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: `components/detail/useProjectSections.ts:193`; `components/detail/TasksSection.tsx:99-136`
- **Detail**: `GET /projects/{id}/tasks` i `/baselines` są wołane **bez żadnych parametrów paginacji**, a route zwraca wszystkie nieusunięte rekordy (`api/projects/[id]/tasks/route.ts:51` — `findWithDecryption` z `orderBy` i bez `limit`). `TasksSection` mapuje je w całości na interaktywne przyciski, bez limitu i bez „pokazano N z M". Lista projektów tnie na 50 (`PAGE_SIZE`), więc ekran szczegółów jest jedyną nieograniczoną powierzchnią w tej zmianie. Paginacja po stronie API należy do OSS — ale handoff wymienia **tylko dwie** prośby do OSS i tej nie zawiera, więc zależność wypadnie z obiegu między strumieniami.
- **Fix**: Dopisać do `handoff.md` trzecią prośbę do OSS (paginacja `/tasks` i `/baselines`, z konsumentem: sekcje UI-02 i ekran zadań UI-04), a do czasu jej realizacji uciąć render po stałej liczbie z jawnym licznikiem reszty.
- **Decision**: FIXED (częściowo, zgodnie z triażem) — dopisana **trzecia prośba do OSS** w `handoff.md` (paginacja `/tasks` i `/baselines`, z konsumentem UI-02/UI-04 i sugerowanym kształtem). Cięcia renderu po stronie klienta świadomie NIE dodano: bez `total` z serwera licznik „pokazano N z M" kłamałby o reszcie, a sam cap byłby półśrodkiem do usunięcia.

### F9 — Komunikat o braku wersji odsyła operatora do ekranu, który nie ma archiwizacji

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; naprawa oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: `i18n/en.json` → `delivery_os.projects.list.archive.missingVersion`; `components/projects/DeliveryProjectListClient.tsx:126-129`
- **Detail**: Treść brzmi *„…Open the project and archive it from there."* — a UI-02 świadomie nie zbudowało akcji archiwizacji na ekranie szczegółów (to dopiero UI-03). Instrukcja prowadzi donikąd. Dodatkowo sam komunikat jest **nieosiągalny**: `rowActions` już wcześniej nie wystawia pozycji dla wiersza bez wersji (`:232`), więc `handleArchive` nigdy nie dostanie takiego rekordu. Obrona w głąb jest dobra; myląca kopia nie.
- **Fix**: Przeredagować na neutralne („ten wiersz nie niesie wersji rekordu — odśwież listę") w pięciu locale, albo usunąć nieosiągalną gałąź i zostawić sam guard w `rowActions`.
- **Decision**: FIXED — komunikat przeredagowany w pięciu locale na neutralny („odśwież listę i spróbuj ponownie"), bez odsyłania do ekranu, który nie ma archiwizacji. Gałąź zostaje jako obrona w głąb.

### F10 — Odstępstwa udokumentowane i zachowania zastane, przyjęte świadomie

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; naprawa oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: wiele — patrz Detail
- **Detail**: Zebrane, żeby nie zginęły, ale żadne nie wymaga działania samo z siebie. **Odstępstwa od planu, wszystkie na plus i opisane w handoffie**: (a) `targetProfileId` + `targetProfileVersion` scalone w jeden select `id@version` (`create/page.tsx:50-60`) — czyni nieprawidłową parę niewybieralną, a wysyłany payload i tak przechodzi realny `projectCreateSchema` w teście (`form.test.tsx:107`); (b) `router.push` zamiast `successRedirect`, bo id istnieje dopiero po odpowiedzi — przy okazji `DeliveryProjectForm` wystawia prop `successRedirect`, którego nikt nie podaje; (c) zamiast rozszerzać `page.test.tsx` powstał `executionHost.test.tsx` — **lepiej**, bo nietknięty plik jest najmocniejszą formą kryterium 2.1; (d) ścieżka importu `createCrud` z planu (`@open-mercato/ui/backend/crud`) nie istnieje — implementacja poprawnie użyła `@open-mercato/ui/backend/utils/crud`; to błąd planu naprawiony w kodzie. **Zachowania zastane, których plan kazał nie ruszać** (`refreshProject` startuje od `setState({status:'loading'})`, więc `context.refresh()` wywołane przez widget odmontowuje widget, który je wywołał; `retryLastMutation` w zależnościach pobrania powoduje jedno dodatkowe `GET` na instalacjach z widgetem w globalnym spocie mutacji — `triggerEvent` jest `useCallback(…, [eventWidgets])`; `ErrorMessage` zamiast `RecordNotFoundState` dla `notFound`, wbrew `.ai/ui-backend-components.md:227`). **Kruchość bez guardu**: stand-in widgetu w `executionHost.test.tsx:18-32` odtwarza kontrakt DOM enterprise co do znaku, ale nic nie pilnuje, żeby tak zostało po zmianie po stronie EXEC — najtaniej wyeksportować `data-testid` i id cechy z `lib/contracts.ts` i importować po obu stronach. **Drobiazgi i18n**: `de`/`es` wariant `attempts.count` źle brzmi dla `count = 1` (`pl`/`ko` już to obchodzą przeredagowaniem); `t(\`…tasks.status.${status}\`)` w `EvidenceSection.tsx:151` bierze klucz z `taskCounts`, które jest `z.record(z.string(), …)` (`api/schemas.ts:49`), więc nieznany status wyrenderuje surowy klucz — warto podać fallback `t(key, status)`.
- **Fix**: Nic obowiązkowego. Jeśli coś — to guard na kontrakt DOM stand-inu (jedna stała w `lib/contracts.ts`) i fallback w `t()`.
- **Decision**: ACKNOWLEDGED — brak działań obowiązkowych. Fallback `t(key, status)` dla nieznanego statusu w `EvidenceSection` wprowadzony przy okazji F7. Podpowiedź wyeksportowania stałej `data-testid` z `lib/contracts.ts` **odrzucona w tym strumieniu**: `lib/` to powierzchnia OSS, której UI-02 nie wolno dotykać — do uzgodnienia z OSS. Warianty liczby mnogiej `de`/`es` zostawione bez zmian.

## Uwaga proceduralna

Skill przewiduje stemplowanie `change.md` na `status: impl_reviewed`. **Nie zrobiono tego świadomie**: `context/changes/autonomous-software-delivery/change.md` opisuje całą 36-godzinną zmianę (sześć strumieni), a nie UI-02; jej status to `implementing` i pozostałe strumienie trwają. Precedens: review wdrożenia UI-01 również nie przestemplowało tego pliku. Pole `updated` jest już ustawione na dzisiaj. Zaznaczenie `impl_reviewed` na poziomie całej zmiany byłoby dokładnie tym „obejrzeniem jako zrobione", które plan główny wyklucza.

## Triage summary

```
  Fixed:        F2, F3, F4, F5, F6, F7, F8 (częściowo), F9   (8)
  Accepted:     F1  (ryzyko przyjęte świadomie, zapisane w handoff.md)
  Acknowledged: F10 (bez działań; jedna podpowiedź odrzucona jako naruszenie granicy OSS)
  Skipped:      —
  Dismissed:    —

  ► Verdict after triage: NEEDS ATTENTION → SOUND
```

Bramka po naprawach (runner: local): testy `delivery_os` 52 suity / 1174 OK · `typecheck` 40/40 ·
`lint` 0 błędów · `i18n:check-sync` OK · `i18n:check-usage` exit 0 ·
`git status --porcelain -- delivery_os/{api,commands,data,lib}` pusty.
