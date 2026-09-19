<!-- PLAN-REVIEW-REPORT -->
# Plan Review: UI-02 — Szkielet projektu i host rozszerzenia

- **Plan**: [`../plan.md`](../plan.md)
- **Mode**: Deep
- **Date**: 2026-09-19
- **Verdict (przed triażem)**: REVISE
- **Verdict (po triażu)**: SOUND
- **Findings**: 4 critical · 4 warnings · 2 observations — wszystkie 10 naprawione w planie

Review wykonany w świeżym kontekście, bez wiedzy o przebiegu planowania. Trzy z czterech findingów CRITICAL zweryfikowane niezależnie przed naniesieniem poprawek.

## Verdicts

| Dimension | Przed | Po triażu |
|-----------|-------|-----------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | FAIL | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

17/17 ścieżek ✓, 18/20 twierdzeń o API ✓ (2 błędne behawioralnie — F1, F3), brief↔plan ✓.

Potwierdzone jako poprawne: `lib/contracts.ts:714-722` (`taskId: uuidSchema.nullable()` — centralne twierdzenie planu trafione), `api/projects/route.ts` DELETE z query param (:85-97) i przepisanie `includeArchived`→`withDeleted` (:105-114), `export: { enabled: false }` (:64), `sortFieldMap` (:62), `serializers.ts:17` i `:109`, `projectUpdateSchema` faktycznie wyklucza `inputMode`/`targetProfileId` (`validators.ts:152-159`), `TARGET_PROFILES`, `DEFAULT_DELIVERY_LIMITS`, `ListEmptyState`, `useOrganizationScopeVersion`, `surfaceRecordConflict`, `buildOptimisticLockHeader`, `CrudForm.tsx:895-904`, wszystkie pięć plików wzorcowych, `components/` jako konwencja (25 modułów core), Playwright wykrywa lokalne `__integration__/`, „7 istniejących testów" zgadza się (3 `it` + `it.each` na 4 przypadki).

## Findings

### F1 — Karta enterprise, którą plan obiecuje pokazać, nie istnieje

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — stawka architektoniczna
- **Dimension**: End-State Alignment / Blind Spots
- **Location**: Faza 2 §5, kryterium 2.9, Desired End State, kontrole ręczne 3–4
- **Detail**: Plan przeczytał `widget.client.tsx` tylko do guardu `null`. Gałąź pozytywna (`:21-26`) renderuje pusty `<div data-testid="delivery-execution-action">` z komentarzem `{/* Execution controls rendered by EXEC-04 */}`. Po całej Fazie 2 wybór zadania przełącza div o zerowej wysokości z nieobecnego na obecny — oba stany są dla operatora nieodróżnialne, więc odbioru „rozszerzenie pojawia się … i znika" nie da się zademonstrować wizualnie w żadną stronę.
- **Fix A ⭐ Recommended**: Przedefiniować kryterium na dowód DOM — obecność `[data-testid="delivery-execution-action"]` z właściwym `data-task-id` i jego brak po odebraniu `delivery_agents.execute`.
  - Strength: osiągalne w UI-02 i uczciwe co do tego, czego dowodzi.
  - Tradeoff: wizualna połowa odbioru przechodzi do EXEC-04 i musi być zapisana przy współodbiorze 2.3/2.4.
  - Confidence: HIGH — plik widgetu ma 27 linii i nie ma innej ścieżki renderowania.
  - Blind spot: odbierający patrzący na ekran nie zobaczy zmiany i może odczytać to jako porażkę, jeśli nie zostanie uprzedzony.
- **Fix B**: Poprosić EXEC o minimalny widoczny placeholder w szkielecie widgetu przed H6.
  - Strength: odbiór staje się naprawdę wizualny.
  - Tradeoff: to plik EXEC — zależność międzystrumieniowa w oknie 2 h wbrew regule własności z README.
  - Confidence: MED — zależy od dostępności EXEC o H5.
  - Blind spot: placeholder sam w sobie jest ryzykiem fikcyjnego PASS.
- **Decision**: FIXED via Fix A — poprawione cztery miejsca: Current State Analysis, Desired End State, kontrakt Fazy 2 §5, kryteria (2.9 przeniesione z ręcznych do automatycznych) oraz Implementation Note rozdzielający montowanie od wizualnej karty EXEC-04.

### F2 — `yarn generate` nie pada nigdzie, a strony bez niego nie trafiają do routera

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots / Plan Completeness
- **Location**: Faza 1 §1, Weryfikacja, Progress 1.1–1.6
- **Detail**: Strony backendu nie są trasami plikowymi — idą przez wygenerowany rejestr (`apps/mercato/src/bootstrap-common.ts:8` → `@/.mercato/generated/modules.bootstrap.generated`), a skaner CLI (`packages/cli/src/lib/generators/scanner.ts:135`) zbiera `page.tsx`/`page.meta.ts` i czyta pola nawigacji (`module-facts.ts:1489`). `.mercato/generated/` w tym drzewie nie istnieje; AGENTS.md ma to jako twarde Always. Pułapka jest cicha: testy Jest importują `../page` wprost, więc przechodzą na nieaktualnym rejestrze — padają dopiero kontrola sidebara i `TC-DELIVERY-UI-002`.
- **Fix**: Dodać `yarn build:packages && yarn generate` jako pierwszy krok Fazy 1 po wylądowaniu plików stron i na górę bloku Weryfikacja; odnotować, że generate pisze poza modułem, więc kontrola granicy `git diff --stat` zostaje bez zmian.
- **Decision**: FIXED — krok dodany w Fazie 1 §1, w bloku Weryfikacja i jako kryterium 1.1.

### F3 — „pominięcie nagłówka — 409" jest odwrotnie; brak `updatedAt` archiwizuje po cichu

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM
- **Dimension**: Contract break / Blind Spots
- **Location**: Critical Implementation Details, Faza 1 §3, kryteria 1.5/1.8
- **Detail**: Blokada optymistyczna zawodzi **otwarcie**. `assertOptimisticLock` wraca cicho przy braku oczekiwanej wersji (`packages/shared/src/lib/crud/optimistic-lock-command.ts:125-126`; komentarz: „clients that don't send the token are never blocked"), a `delivery_os.projects.delete` idzie przez `lockProjectForWrite` → `enforceCommandOptimisticLockWithGuards` (`commands/shared.ts:207`), nie przez `requireLockHeader` (tego używają tylko baselines/decisions/planImport/reconcile). DELETE bez nagłówka zwraca więc 200 i archiwizuje. Dodatkowo `updatedAt` w wierszu listy jest nullable (`api/schemas.ts:32`), a `buildOptimisticLockHeader` zwraca `{}` dla nie-stringa (`packages/ui/src/backend/utils/optimisticLock.ts:33`) — wiersz bez wersji produkuje dokładnie tę niechronioną archiwizację, którą kryterium 1.8 miało wykluczyć. Trzy „rozłączne" gałęzie planu mają czwartą, nienazwaną.
- **Fix**: Odmówić archiwizacji, gdy `row.updatedAt` nie jest niepustym stringiem (wyłączyć akcję albo dobrać wersję ze szczegółów); dodać test asertujący obecność `OPTIMISTIC_LOCK_HEADER_NAME`; poprawić zdanie na „pominięcie nagłówka — cichy 200 bez kontroli wersji".
- **Decision**: FIXED — zweryfikowane niezależnie przed naniesieniem. Poprawione Critical Implementation Details, kontrakt Fazy 1 §3, kontrakt testów §6 oraz dodane kryterium 1.7.

### F4 — Progress nie nosi jednego kryterium Fazy 2

- **Severity**: ❌ CRITICAL (reguła mechaniczna)
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Faza 2 Success Criteria vs `### Phase 2` w Progress
- **Detail**: Faza 2 wymieniała 8 kryteriów automatycznych, Progress 7 checkboxów — jeden sklejał dwa osobne bullety (toolchain oraz granica plików OSS). `/10x-implement` parsuje tę sekcję mechanicznie. Reszta kontraktu była czysta: jeden `## Progress` na dole, wszystkie trzy `## Phase N` odwzorowane jako `### Phase N` o identycznych nazwach, brak checkboxów poza Progress, Fazy 1 i 3 mapowały się jeden do jednego.
- **Fix**: Rozbić na osobne pozycje i przenumerować Fazę 2.
- **Decision**: FIXED — po wszystkich poprawkach zweryfikowane mechanicznie: 28 bulletów Success Criteria ↔ 28 checkboxów (10 / 12 / 6), nagłówki faz parują się jeden do jednego, brak checkboxów poza Progress.

### F5 — Komenda testowa jest niewykonywalna

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: cztery wystąpienia w planie
- **Detail**: `yarn test --testPathPattern delivery_os` zawodzi dwukrotnie. Root `test` to `turbo run test --concurrency=2` (`package.json:39`), więc flaga trafia w turbo, nie w Jest. A w tej wersji Jest flaga nazywa się `--testPathPatterns` (liczba mnoga) — zapisane we własnym handoffie repo (`.ai/runs/2026-07-28-workflows-ux-phase4/HANDOFF.md:16`); wzorce domowe używają formy workspace.
- **Fix**: Zamienić wszystkie cztery wystąpienia na `yarn workspace @open-mercato/core test --testPathPatterns='delivery_os' --maxWorkers=4`.
- **Decision**: FIXED.

### F6 — Parity pięciu locale jest deklarowane, ale nigdy nie sprawdzane

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Faza 1 §1 i §5, Weryfikacja, Progress
- **Detail**: `i18n:check-usage` konfrontuje wywołania `t()` z JSON-em i pada na *brakujących* kluczach — nie jest checkerem parity. Parity między pl/es/de/ko, płaską notację kropkową i **alfabetyczne ułożenie kluczy** wymusza `scripts/i18n-check-sync.ts`, obecny w kanonicznym gate (`.ai/agentic.config.json` → `yarn i18n:check-sync` tuż przed `check-usage`), którego plan nie uruchamiał. Przy ~40–60 kluczach wstawianych ręcznie w pięciu plikach kolejność puści najpierw.
- **Fix**: Dodać `yarn i18n:check-sync` do Weryfikacji i Progress; wspomnieć `yarn i18n:fix` jako normalizator.
- **Decision**: FIXED — dodane w pięciu miejscach; poprawione też fałszywe zdanie „parity locale jest sprawdzane przez gate".

### F7 — Dwie godziny nie mieszczą ~18 nowych plików

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — stawka architektoniczna
- **Dimension**: Lean Execution
- **Location**: Overview, Overview każdej fazy, ostatni wiersz Ryzyk
- **Detail**: Z własnych list plików planu: Faza 1 = 10 nowych plików + 5 edycji i18n w 50 min; Faza 2 = 6 nowych + 1 modyfikowany + 5 edycji i18n w 50 min; Faza 3 = samosprzątający spec Playwright + handoff w 20 min. Własne wzorce referencyjne planu mają 169, 357 i 109 linii. Faza 3 jest najmniej realna — a to ona dowodzi „operator przechodzi ręczny flow", więc to ona wypada przy twardym stopie o H6.
- **Fix A ⭐ Recommended**: Wyciąć formularz **edycji** (4 z 10 plików Fazy 1): `DeliveryProjectForm` staje się create-only, `[id]/edit/*` idzie do UI-03, które i tak włada tymi ekranami.
  - Strength: kupuje ~20 min i usuwa dwie najbardziej dražliwe części (odłożony mount `CrudForm`, plumbing `updatedAt`), nie ruszając żadnego kryterium — edycja nie występuje w `03-design-ui.md` ani w Desired End State.
  - Tradeoff: argument „jeden komponent, dwa tryby" słabnie — formularz tworzenia musi być napisany tak, by UI-03 mogło go owinąć.
  - Confidence: HIGH — spec UI-02 wymienia „CrudForm/DataTable i guarded mutations", co tworzenie + archiwizacja spełniają.
  - Blind spot: przy poślizgu UI-03 moduł nie ma jak poprawić literówki w nazwie projektu z UI.
- **Fix B**: Utrzymać zakres i zadeklarować okno 3 h.
  - Strength: dowozi pełny plaster.
  - Tradeoff: łamie harmonogram, do którego README przypina UI-03/H6; handoff Fazy 3 jest artefaktem, na którym polegają inne strumienie.
  - Confidence: MED. Blind spot: renegocjacja twardego stopu w trakcie okna zwykle nie następuje.
- **Decision**: FIXED via Fix A — formularz edycji wycięty, `DeliveryProjectForm` przygotowany pod owinięcie przez UI-03, granica dopisana do „What We're NOT Doing", `edit` usunięty z `RowActions`, okna faz przeliczone na ~35 / ~50 / ~35 min.

### F8 — Kryteria Fazy 2 wymagają fixture'a, którego plan nie tworzy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots
- **Location**: Progress 2.10/2.11, Faza 3 §1, Ryzyka wiersz 2
- **Detail**: Oba kryteria wymagają projektu z **aktywnym** baseline i co najmniej jednym zadaniem. Plan żadnego nie tworzy, a Faza 3 przyznaje lukę wprost — mimo to kryteria stały w Progress jako bezwarunkowe. Fallback „utworzyć baseline przez API" jest cięższy, niż brzmi: `baselineContentV1Schema` (`contracts.ts:482-508`) żąda niepustych `acceptanceCriteria`, każdego `requirementId` rozwiązującego się do wymienionego wymagania, plus `tokens`, `acTestMap`, `manualChecks`, `declaredTests`; zamrożenie wymaga `delivery_os.projects.manage` i nagłówka blokady; zadanie potrzebuje `acIds` i `allowedPaths` w rootach profilu (`validators.ts:177-191`); aktywacja to dwie decyzje przez `POST /baselines/[id]/decisions`.
- **Fix A**: Zbudować mały wielokrotnego użytku helper fixture (projekt → baseline → decyzje → zadanie) na istniejącym `lib/fixtures/baseline-content.v1.json`.
  - Strength: odblokowuje oba kryteria i przyszły przypadek baseline w `TC-DELIVERY-UI-002`; UI-03 go dziedziczy.
  - Tradeoff: kolejne minuty z okna już uznanego za przeciążone; QA-02 może budować to samo równolegle.
  - Confidence: HIGH. Blind spot: duplikacja pracy z QA-02.
- **Fix B ⭐ (wybrane)**: Oznaczyć kryteria jako warunkowe i zapisać zależność w `handoff.md` z góry, nie po fakcie.
  - Strength: zero dodatkowych minut, uczciwe wobec F7.
  - Tradeoff: wkład UI-02 w Progress 2.3/2.4 opiera się wtedy na testach komponentowych; jeśli nikt fixture'a nie dowiezie, sekcja będąca sensem Fazy 2 nie zostanie pokazana.
  - Confidence: HIGH.
- **Decision**: FIXED via Fix B — kryteria 2.10/2.11 oznaczone jako warunkowe z nazwanym dostawcą, wiersz ryzyka rozbudowany o realny koszt fixture'a, a szkielet `handoff.md` przeniesiony na start Fazy 2.

### F9 — Cztery sekcje budowane od zera bez konsultacji wspólnej rodziny komponentów

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architectural Fitness
- **Location**: Faza 2 §§2-4
- **Detail**: AGENTS.md kieruje „Reusing backend component families — check BEFORE building any from scratch" do `.ai/ui-backend-components.md`, który dokumentuje `SectionHeader`/`CollapsibleSection` (nagłówek + licznik + akcja), `TabEmptyState`, `DetailFieldsSection` i `RecordNotFoundState`. Plan cytował z tej rodziny tylko `LoadingMessage`/`ErrorMessage`, a nagłówki, liczniki i trzy puste stany specyfikował jako własne. Architektonicznie nic złego — ciała sekcji muszą być własne — ale chrome jest dokładnie tym, co rodzina pokrywa.
- **Fix**: Nazwać `SectionHeader`/`CollapsibleSection` i `TabEmptyState` jako chrome sekcji, zostawiając własny kod na ciała.
- **Decision**: FIXED — dodana nota wstępna do Changes Required Fazy 2 i wpis w References.

### F10 — Numery linii dryfują, a „design" to metadane bez obrazka

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis, Key Discoveries, Faza 2 §2
- **Detail**: (a) Kilka cytowanych linii przesuniętych o 1–9: `serializers.ts:18`→17, `serializers.ts:100`→109, `widget.client.tsx:27`→21, `api/projects/route.ts:63`→64. (b) `screens[]` niesie `attachmentId: uuidSchema`, a nic w planie nie rozwiązuje go do URL obrazka — sekcja „designu" pokaże tabelę hashy, nie design. Moduł `attachments` istnieje, więc odbierający może rozsądnie oczekiwać miniatury.
- **Fix**: Odświeżyć numery linii i dopisać granicę zakresu: podglądy z `attachmentId` należą do UI-03.
- **Decision**: FIXED — numery poprawione, granica dopisana do „What We're NOT Doing".

## Co w planie jest dobre i zostaje pod każdą rewizją

Trzy rozłączne puste stany, reguła `percent: null → "—"` i trójstanowy rejestr prób są poprawnym odczytem realnego kodu (`api/schemas.ts:37-42`, `api/serializers.ts:109`) i celują dokładnie w klasę fałszywego PASS, którą plan główny wyklucza. Odmowa podstawienia fixture'a pod brakujący `GET /projects/[id]/evidence` — zweryfikowane: ten plik route eksportuje wyłącznie `POST` — jest właściwa, a sformułowanie handoffu precyzyjne. Granica własności plików jest realna i sprawdzalna, a decyzja o rozbudowie zamiast przepisania `DeliveryProjectDetailClient.tsx` z zachowaniem jego siedmiu asercji jest dobrze wyważona.

## Triage summary

```
  Fixed:     F1 (Fix A), F2, F3, F4, F5, F6, F7 (Fix A), F8 (Fix B), F9, F10   (10)
  Skipped:   —
  Accepted:  —
  Dismissed: —

  ► Verdict after fixes: REVISE → SOUND
```
