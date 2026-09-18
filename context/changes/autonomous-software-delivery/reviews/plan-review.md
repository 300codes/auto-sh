<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Autonomous Software Delivery

- **Plan**: [Plan wdrożenia](../plan.md), [skrót](../plan-brief.md)
- **Mode**: Deep
- **Date**: 2026-09-18
- **Verdict**: SOUND po poprawkach; wykonalność integracji i estymaty pozostaje bramką H0–H3.
- **Findings**: 4 CRITICAL, 2 WARNING, 0 OBSERVATION; wszystkie FIXED w dokumentacji.

## Verdicts

| Dimension | Po poprawkach |
|---|---|
| End-State Alignment | PASS |
| Lean Execution | WARNING — 87 osobogodzin jest estymatą, wymaga ponownej oceny po próbach |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding

Grounding: 5/5 istniejących ścieżek ✓, 3/3 symboli ✓, brief↔plan ✓. Sprawdzono `agent_orchestrator/api/identity/token/route.ts`, `packages/core/AGENTS.md`, `workflows/lib/signal-handler.ts`, `agent_orchestrator/lib/runtime/invokeAgentForWorkflow.ts` i `.ai/agentic.config.json`; symbole `createModuleEvents`, `makeCrudRoute`, `withScopedApiRequestHeaders`. Nowe ścieżki delivery_os/delivery_agents/delivery-cezar są planowanymi plikami, nie brakującym istniejącym kodem. Jedna ukierunkowana analiza pomocnicza zweryfikowała workflow, kolejkę, rejestrację i ich wywołania. Nie wykonywano prób zewnętrznych integracji w ramach review.

## Findings

### F1 — Wynik może wyprzedzić parkowanie albo utracić wznowienie

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — wybór wymaga rozważenia kosztu i sposobu odzyskania
- **Dimension**: Blind Spots
- **Location**: Phase 4, execution bridge i lifecycle
- **Detail**: `packages/core/src/modules/workflows/lib/signal-handler.ts:186–192` odrzuca sygnał poza paused; linie 225–270 sprawdzają oczekiwany krok/sygnał. `workflow-executor.ts:309–343` nie wykonuje kroków przy samym startWorkflow. Plan nie określał odzyskania po zapisie evidence ani po sygnale przed potwierdzeniem dostarczenia.
- **Fix**: Osobny workflow na próbę, start i execute do zapisanego WAIT_FOR_SIGNAL przed enqueue; wewnętrzny odbiór wyniku i trwały pending/delivered z retry oraz uzgodnieniem historii.
  - Strength: Usuwa zbędny publiczny callback i wykorzystuje istniejący workflow.
  - Tradeoff: Worker potrzebuje przygotowanego środowiska OM/CLI; dochodzą testy okien awarii.
  - Confidence: HIGH dla ograniczeń workflow; próba CLI pozostaje H0–H3.
  - Blind spot: Rzeczywista sesja CLI nie została uruchomiona podczas review.
- **Before → After**: Publiczny `/attempts/:id/result` i ogólne „wznawia workflow” → wewnętrzna komenda, protokół parkowania i recovery, kryterium 4.7.
- **Decision**: FIXED — wariant wewnętrzny jawnie zatwierdzony przez użytkownika podczas triażu.

### F2 — Brak operacji tworzącej attempt przed eksportem

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — oczywiste doprecyzowanie istniejącego kontraktu
- **Dimension**: Plan Completeness
- **Location**: Kontrakty między stanowiskami, Phase 4–5
- **Detail**: Pakiet wymaga attemptId, ale odczyt GET nie miał poprzedzającej operacji rezerwacji. Obiecane reconciliation i decyzje publikacji nie miały wskazanych ścieżek zapisu.
- **Fix**: Jawny POST rezerwacji z idempotency key, odpowiedzią zawierającą attemptId i packageUrl; cancel/reconcile, evidence i decyzje deploy/release z autoryzacją i kontrolą wersji.
- **Before → After**: Sam eksport/import → pełny przepływ rezerwacja–eksport–import oraz operacje odzyskania i decyzji.
- **Decision**: FIXED — w ramach zleconego wdrożenia uwag; bez zmiany zakresu produktu.

### F3 — Dowód nie wskazuje testów AC i finalnej rewizji

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — istotne doprecyzowanie wiarygodności odbioru
- **Dimension**: End-State Alignment
- **Location**: ResultManifest, Phase 4–5
- **Detail**: Sam command/profile ID nie dowodzi pokrycia konkretnego AC. Zielony wynik zadania nie gwarantuje poprawności po integracji. Wymóg git SHA dla każdego raportu pomija snapshoty istniejącego WordPressa.
- **Fix**: Zamrożone AC→test IDs, hashe definicji testów, komplet obowiązkowych wyników na finalnej rewizji oraz sourceRevision git/snapshot; świeża korelacja WP z nową próbą.
  - Strength: Odbiór opiera się na sprawdzalnych dowodach.
  - Tradeoff: Weryfikator powtarza pełen zestaw po integracji.
  - Confidence: HIGH — wynika z kontraktu odbioru i dwóch niezależnych worktree.
  - Blind spot: Dokładny format eksportu snapshotu WP wymaga próby w istniejącym timeboxie.
- **Before → After**: checks z komendą/commitem → jawne pokrycie AC i raport finalnej rewizji; brak fikcyjnych commitów WP.
- **Decision**: FIXED — doprecyzowanie już wymaganego odbioru i WP PoC.

### F4 — Domyślna kolejka nie zapewnia dwóch równoległych wykonań

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — konfiguracja nowego workera, bez zmiany defaultów platformy
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 i Phase 4
- **Detail**: `packages/queue/src/strategies/local.ts:73,150` wykonuje zadania sekwencyjnie. `packages/cli/src/mercato.ts:1683–1717` ogranicza efektywną współbieżność budżetem DB. Samo zadeklarowanie dwóch zadań nie wystarcza.
- **Fix**: Readiness Redis/async, metadata nowego workera i jawna komenda concurrency=2; test nakładających się runów na docelowym hoście.
- **Before → After**: Ogólna „istniejąca kolejka” → konfiguracja, uruchomienie i pomiar rzeczywistej równoległości.
- **Decision**: FIXED — realizacja wcześniej zatwierdzonych dwóch równoległych zadań.

### F5 — Rejestracja modułów i miejsce renderowania widgetu są niedookreślone

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — użycie istniejących mechanizmów platformy
- **Dimension**: Plan Completeness
- **Location**: Architecture i Phase 2
- **Detail**: Resolver czyta `apps/mercato/src/modules.ts` (`packages/cli/src/lib/resolver.ts:343,551`), a enterprise jest warunkowe (`modules.ts:216–217`). Deklaracja spotu bez hosta InjectionSpot nie pokaże akcji wykonania.
- **Fix**: Wskazać istniejącą konfigurację aktywacji, dependency providera, generate, rzeczywisty InjectionSpot, typowany kontekst i injection-table enterprise; sprawdzić OSS-only.
- **Before → After**: Deklaracja modułów/spotu → konkretne punkty połączenia z aplikacją.
- **Decision**: FIXED — konfiguracja istniejących mechanizmów; logika nadal w packages.

### F6 — Propozycje wymagań i planu nie mają producenta

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — przypisanie istniejącej obietnicy do etapu i artefaktów
- **Dimension**: Plan Completeness
- **Location**: Phase 3
- **Detail**: FROM_BRIEF przyjmował gotową propozycję wymagań, lecz etap opisywał tylko generowanie designu. Brakowało kroku tworzącego architecture/plan summary i zadania.
- **Fix**: Ograniczone skills requirements-from-brief i plan-from-baseline, walidowany import przez komendy OSS, akceptacja scalonego baseline oraz wskazanie właścicieli. Przygotowanie bridge na fixture nie pozwala implementować aplikacji przed zatwierdzeniem.
- **Before → After**: Niewskazane źródło propozycji → jawna sesja agenta, import, review i dopiero wykonanie.
- **Decision**: FIXED — uzupełnienie przepływu bez nowego runtime/API LLM.

## Wynik triażu i ograniczenia

Naprawiono F1–F6 w planie i zsynchronizowano skrót. F1 rozstrzygnął użytkownik; pozostałe korekty realizują jego wcześniejsze zlecenie wdrożenia uwag, bez kolejnej zmiany architektury lub zakresu. Nie odrzucono ustaleń dotyczących dwóch wejść, live Figma, granicy OSS/enterprise, niezmieniania Cezara i limitu WP 6 h.

Review dokumentacji nie potwierdza gotowości środowiska ani nie dowodzi, że 87 osobogodzin wystarczy. H3 musi potwierdzić integracje i skorygować estymatę; niepowodzenie Figmy pozostaje blockerem, a manual_handoff Cezara jest już zatwierdzonym fallbackiem. Wszystkie pozycje Progress pozostają niewykonane.

## Wdrożenie uwag — uzupełnienie z 2026-09-18

Ponowny audyt planu wykazał, że cztery obietnice z sekcji Fix nie miały odpowiednika w weryfikowalnej treści planu. Uzupełniono je bez zmiany architektury i zakresu produktu.

| Luka | Finding | Stan przed | Wprowadzono |
|---|---|---|---|
| G1 | F4 | „Readiness Redis/async" żyło tylko w prozie Phase 4; Phase 1 nie miało ani pozycji pracy, ani kryterium | Kontrakt Phase 1 zapisuje `QUEUE_STRATEGY`, `QUEUE_REDIS_URL`/`REDIS_URL`, `DB_POOL_MAX`/`OM_WORKERS_DB_CONNECTION_BUDGET`; nowe kryterium 1.6 wymaga zmierzonej efektywnej współbieżności ≥2; wiersz H3 wymienia gotowość kolejki |
| G2 | F2 | ACL Phase 2 wyliczało tylko view/manage/approve/import, choć F2 dodał cancel/reconcile i decyzje publikacji | ACL rozdziela view, manage, approve, import, reconcile oraz publish/release; uzgodnienie próby i odbiór nie dzielą feature z edycją zadania |
| G3 | F6 | Import propozycji wymagań/planu nie miał kryterium ani wiersza integration coverage | Kryterium 3.6 odrzuca nieznaną wersję, obce referencje, allowedPaths poza repo i mapowanie AC na nieistniejący test; wiersze baselines i tasks rozszerzone |
| G4 | WARNING (Lean Execution) | Wiersz H3 nie zobowiązywał do korekty 87 osobogodzin | H3 obowiązkowo koryguje tabelę zmierzonym czasem prób i pełnego gate, zapisuje nową liczbę i cięcie zakresu, bez przesuwania freeze H28 |

Zgodnie z kontraktem `references/progress-format.md` nie renumerowano indeksów ani nie zmieniano tytułów zrewidowanych kroków. Pozycja 4.7 zachowała numer, a jej wiersz przeniesiono na koniec listy Automated etapu 4, żeby kolejność dokumentu odpowiadała kolejności indeksów. Kryterium 6.2 zachowuje słowo „callback"; obowiązuje dopisane w Phase 4 zastrzeżenie, że oznacza ono wewnętrzne dostarczenie wyniku.

Na wniosek użytkownika tabela 87 osobogodzin pozostaje niezmieniona: dodanej pracy weryfikacyjnej nie doszacowano przy biurku, a korekta jest wynikiem pomiaru w H3. WARNING dla Lean Execution pozostaje otwarty do tego momentu.

Grounding uzupełnień sprawdzony w kodzie: `QUEUE_STRATEGY` (`packages/cli/src/lib/queue-worker-supervisor.ts:118`), rozstrzyganie Redis (`packages/shared/src/lib/redis/connection.ts:62`), `--concurrency=` i zaciskanie budżetem DB (`packages/cli/src/mercato.ts:1670`, `:582`), `DB_POOL_MAX`/`OM_WORKERS_DB_CONNECTION_BUDGET` (`packages/cli/src/mercato.ts:600`), `upsertOwnedDefinition` (`packages/core/src/modules/workflows/lib/owned-definition.ts:54`) i token DI `workflowDefinitionAuthoring` (`packages/core/src/modules/workflows/di.ts:67`). Nadal nie uruchamiano prób zewnętrznych integracji; wszystkie pozycje Progress pozostają niewykonane.
