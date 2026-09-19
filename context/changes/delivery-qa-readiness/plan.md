# Delivery QA readiness — plan wykonawczy

## Overview

Plan siedmiu zadań: QA-02, API security/kontrakty, backend QA-03, OSS manual flow,
przygotowanie QA-04, przygotowanie WP-M02 oraz odbiór. Powstaje na istniejących
specyfikacjach i nie rozszerza kontraktów produktu. W tej sesji przygotowujemy
dokumenty i review; poniższe kryteria implementacji pozostają oczekujące.

## Current State Analysis

Analiza commitu `68740781186420bd7952a52bd9c597fce53d02d0`: [research.md](research.md).
Istnieją R1–R19, testy reguł/komend/handlerów i jeden test UI. Brakuje integracji
HTTP dwóch tenantów. `manualFlow.route.test.ts` kończy się awaiting_review;
`evidence.route.test.ts` sprawdza dalszy review osobno, na mockowanym ORM.
R20–R22 oraz `packages/enterprise/src/modules/delivery_agents/` nie istnieją.
WP ma samodzielny pakiet, snapshot i test granicy OSS, bez hosta OM→WP→OM.

### Key Discoveries

- `packages/core/src/modules/delivery_os/api/projects/[id]/evidence/route.ts`: review przez R19 jest jedyną drogą do verified; import wyniku kończy się awaiting_review.
- `packages/core/src/modules/delivery_os/lib/fixtures/builders.ts`: fake executor generuje syntetyczne hashe i pomiary; użycie wyłącznie testowe.
- `packages/core/src/modules/delivery_os/lib/resultAcceptance.ts`: identyczny rezultat jest replay przed odrzuceniem terminalnej próby; inny hash daje result_conflict.
- `packages/core/src/helpers/integration/authFixtures.ts`: reuse tworzenia użytkowników/ACL/organizacji; helper selected-org wymaga wrappera obsługującego nagłówki lock/idempotency.
- `packages/core/src/modules/delivery_os/commands/projects.ts`: archiwizacja zachowuje historię. Nie dodawać DELETE baseline/evidence na potrzeby testów.
- `packages/core/src/modules/delivery_os/lib/__tests__/wordpressStudioContract.test.ts`: rozszerzyć obecne testy, zachowując odrzucenie raportu standalone.

## Desired End State

Na dedykowanym środowisku da się uruchomić powtarzalną suite R1–R19 i pełny OSS-only
flow z izolowanymi danymi. Każdy przypadek ma sprawdzalne oczekiwanie, cleanup oraz
wynik z rewizją kodu. Przy braku warunku wykonania wynik jest not_run z przyczyną,
a brak testu/dowodu jest missing — nigdy PASS.

Przygotowanie QA-04 kończy się scenariuszami awarii i formatem dowodów, bez deklaracji
restartu czy równoległości prawdziwego wykonawcy. Przygotowanie WP-M02 kończy się
testem mapowania na jawnej fixture, bez deklaracji świeżego PoC. Runbook rozdziela
odbiór tego pakietu przygotowawczego od odbioru całego demo.

## What We're NOT Doing

- Implementacji providera/workerów, UI, report/deploy/release API, produkcyjnego mappera WP ani nowych komend.
- Zmian schematu, ACL produktu, profili v1, retencji, publicznych DTO, pipeline PR i official-modules.
- Migracji/resetu bazy developera, publikacji preview, pracy na starym runtime WP ani realnego restartowania cudzych procesów.
- Zaznaczania Progress głównego planu na podstawie fixture lub historycznych wyników.
- Naprawiania wykrytych zmian zachowania pod pozorem testu; reprodukcja i evidence trafiają do właściciela OSS/EXEC.

## Implementation Approach

Jeden nowy helper fixture w istniejącej rodzinie `packages/core/src/helpers/integration/`,
testy w module `delivery_os/__integration__`, dokumenty w `hackathon/delivery-demo/`.
Wspólne źródła oczekiwań: istniejące schema/fixtures i tabela R1–R22; nie kopiować logiki
walidacji do nowego frameworka QA. Testy WP pozostają konsumentem kontraktu w core,
bez importu providera do produkcyjnego OSS.

Kolejność: 1 → 2 → 3 → 4; 5 można przygotowywać po 1; 6 niezależnie od live EXEC;
7 scala wyniki wszystkich etapów. Etapy są jednostkami implementacji, a nie nowymi
modułami lub osobnymi specyfikacjami architektury.

### Readiness i bezpieczne środowisko

Przed testami sprawdzić `.ai/qa/ephemeral-env.json` / `.ai/qa/test-env.json`, dostępność
modułu, tabel i prywatnego storage. Użyć dedykowanego środowiska QA z udokumentowaną
własnością jego DB/storage/cache. Istniejąca aplikacja developerska nie spełnia tego
warunku przez samą dostępność URL. Bootstrap administrator dostarczony przez konfigurację
środowiska służy tylko provisioningowi; sekretów nie zapisywać w raportach. Brak konta,
schematu lub zależności = not_run/environment, bez automatycznych migracji czy resetu.

Po każdym scenariuszu: zakończyć własny fake executor, uzgodnić wyłącznie faktycznie
znany stan próby, usunąć/archiwizować przez API własne zasoby, zapisać i sprawdzić cleanup.
Nie deklarować `stopped` dla nieznanego procesu. Historia append-only i tombstones
pozostają w rejestrze środowiska do jego usunięcia po suite. Pełny cleanup wymaga
usunięcia wyłącznie własnego disposable środowiska i jego storage; pozostawione środowisko
oznacza cleanup pending. Nie wykonywać szerokiego SQL DELETE/TRUNCATE.

## Phase 1: QA-02 — izolowane fixture i cleanup

### Changes Required:

**Nowy plik:** `packages/core/src/helpers/integration/deliveryFixtures.ts`.
**Intent:** Utworzyć per test tenant A z A1/A2 oraz B z B1, konta i role o minimalnych
features, projekty i załączniki z rzeczywistymi bytes. Nazwy zawierają runId/testId/retry
oraz losowy UUID. Każdy zasób rejestrować od razu, również podczas częściowego setupu.
**Contract:** Typowany uchwyt testowy zawiera aktorów/scope i ledger cleanup, bez sekretów
w evidence. Reuse authFixtures/api/generalFixtures/attachmentsFixtures. HTTP wrapper
przekazuje `om_selected_org`, `x-om-ext-optimistic-lock-expected-updated-at` i `Idempotency-Key`.
Nie mutować produkcyjnych helperów, aby zmienić semantykę cleanup wszystkim testom.

**Nowy plik:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FIXTURE-001.spec.ts`.
**Intent:** Udowodnić izolację kolejnych uruchomień i cleanup po błędzie w połowie setupu
oraz po utworzeniu aktywnej ręcznej próby. Bez oczekiwanego błędu maskującego awarię teardown.
**Contract:** Asercje: brak aktywnych prób/zasobów po cleanup, drugi cleanup bez efektu,
obce kontrolne zasoby pozostają; retained history ma jawny wykaz. Zadania archiwizować
w odwrotnej kolejności DAG, potem projekty, załączniki i aktorów/organizacje/tenanty.
Helpery ignorujące błędy opakować odczytem kontrolnym i raportem błędów, nie uznawać ich za sukces.

### Success Criteria:
#### Automated Verification:
- Fixture przechodzi dwa uruchomienia i obsługuje częściowy setup: `yarn test:integration --grep 'TC-DELIVERY-FIXTURE-001' --retries=0 --repeat-each=2`.
- Test potwierdza tenant A/B, org A1/A2/B1 i ograniczone ACL rzeczywistych sesji; cleanup nie narusza obcych danych.
#### Manual Verification:
- Operator potwierdza własność disposable środowiska oraz sposób usunięcia jego DB/storage/cache po suite; brak pełnego cleanup jest jawny.

## Phase 2: Istniejące API — ACL, scope, wersje i duplikaty

### Changes Required:

**Nowe pliki w istniejącym `packages/core/src/modules/delivery_os/__integration__/`:**
`TC-DELIVERY-001.spec.ts`, `TC-DELIVERY-004.spec.ts`, `TC-DELIVERY-005.spec.ts`,
`TC-DELIVERY-006.spec.ts`, `TC-DELIVERY-007.spec.ts`.
**Intent:** Przenieść niepowielone oczekiwania z mocked route tests na realne HTTP/DB.
**Contract:** Macierz R1–R19 i konkretne przypadki w [acceptance.md](../../../hackathon/delivery-demo/acceptance.md).

- Dla każdej istniejącej operacji: 401 bez auth; aktor bez właściwej feature dostaje 403;
  dozwolone wywołanie kontrolne; wildcard `delivery_os.*` respektowany. Nie porównywać grantów ręcznie.
- Osobno A1→A2 i A1→B1: listy bez obcych elementów, detail/mutacje bez ujawnienia danych;
  poprawny auth/scope z obcym ID daje 404. Nieuprawniony wybór organizacji może dać
  `422 organization_selection_invalid` — to inny przypadek niż odczyt obcego ID.
- Stary token updatedAt: PUT/DELETE projektu/zadania 409; parent project lock dla
  baseline/decyzji/proposal, task lock dla reserve/cancel/reconcile; brak wymaganego tokena 428.
- 400 zły kształt, 422 nieobsługiwana schemaVersion/reguła domenowa, 413 rozmiar;
  bazować na aktualnym katalogu błędów, nie jednej oczekiwanej odpowiedzi na każdy negatywny payload.
- Rezerwacja: 201 nowy klucz, 200 identyczny replay, 409 konflikt payloadu/aktywnej próby.
  Wznowienie identycznego klucza sprawdzić także ze starym lockiem. Publiczne automatic odrzucone.
- Wynik: identyczny replay 200 z tym samym evidenceId, inny manifest tej próby 409;
  obcy baseline/hash/task/attempt/baseRevision, niedozwolone paths i test IDs odrzucone.
- Co najmniej dwa jednoczesne HTTP reserve oraz dwa importy tego samego wyniku;
  obie odpowiedzi i odczyt trwałego stanu dowodzą jednej próby/jednego evidence.
  Do liczników bez read API użyć istniejącego `withClient` wyłącznie do scoped SELECT
  po zarejestrowanych ID w testowej DB, nie do wykonywania operacji pod testem.
  Nowy wrapper fixture musi wymagać jawnego `DATABASE_URL` tego środowiska przed
  wywołaniem `withClient` — bez fallbacku do plików `.env`. Utworzyć przez testowane
  API losowy rekord kontrolny (projectId + tenantId + organizationId + runId), następnie
  potwierdzić dokładnie ten rekord w DB. Dopiero zgodność zezwala na liczniki SQL;
  brak konfiguracji/rekordu lub mismatch daje `not_run/environment`, bez odczytów
  właściwych liczników. Wspólny `dbFixtures.ts` pozostaje bez zmian.
- Cancel/reconcile: unknown blokuje nową próbę i archive; stopped/not_started pozwala
  na właściwy dalszy krok, completed przechodzi zwykły import i nie nadaje verified.

### Success Criteria:
#### Automated Verification:
- Testy `TC-DELIVERY-001`, `004`, `005`, `006`, `007` przechodzą przez HTTP bez retry i potwierdzają brak zapisów po odmowach.
- Równoczesne reserve/result mają jeden trwały efekt; wyniki, liczby rekordów i oba request IDs trafiają do evidence.

## Phase 3: QA-03 — baseline i propozycje backendu

### Changes Required:

**Nowe pliki:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-002.spec.ts`
oraz `TC-DELIVERY-003.spec.ts` w tym samym katalogu; rozszerzenie nowego `TC-DELIVERY-004.spec.ts`.
**Intent:** Sprawdzić oba inputMode na wspólnym schemacie bez zależności od UI/Figmy.
**Contract:** Używać rzeczywistych uploadów testowych bytes i ich sha256, jawnie jako fixture designu.

- Manual baseline i requirements_proposal, następnie plan_proposal; źródła i stabilne ID
  zachowane. Powtórny identyczny import nie duplikuje baseline/wymagań/zadań.
- Fałszywy hash, obcy attachment, brak renderu/AC, nieznana wersja, obcy baseline/AC,
  absolute/traversal/outside-profile allowedPaths oraz mapowanie nieistniejącego testu są odrzucane.
- Snapshot pozostaje niezmienny po edycji draftu. Nowy/scalony baseline wymaga własnych
  requirements i design decisions związanych z jego hash/version; stare decyzje nie wystarczają.
- Brak obu decyzji, tylko jedna, rejected oraz stare decyzje blokują ready i reserve.
  Obie aktualne decyzje + poprawny plan odblokowują. Każda następna mutacja używa świeżej wersji rodzica.
- Jednoczesne sprzeczne decyzje z tym samym updatedAt: jedna zaakceptowana, druga konflikt;
  sprawdzić skutki, nie tylko kody HTTP. Wynik zadania starego scope nie dowodzi nowego baseline.

### Success Criteria:
#### Automated Verification:
- `TC-DELIVERY-002`, `003`, `004` przechodzą dla from_brief i from_design oraz wszystkich negatywnych przypadków z macierzy.
- Bez obu aktualnych decyzji nie powstaje wykonywalna próba, a hash/version zatwierdzonego snapshotu pozostają niezmienne.

## Phase 4: Pełny przebieg OSS-only

### Changes Required:

**Nowe pliki:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-008.spec.ts`
oraz `TC-DELIVERY-010.spec.ts`.
**Intent:** Spiąć istniejące endpointy w jedną rzeczywistą ścieżkę HTTP, rozszerzając
obecny zakres manualFlow do review i obu zakończeń.
**Contract:** Testowany serwer, nie tylko proces Playwright, musi być uruchomiony bez
enterprise; zapisać konfigurację aktywnych modułów. Manifest budowany fake executorem
z wyeksportowanego pakietu; provenance fixture w evidence QA, nie jako nowe pole publicznego DTO.

Ścieżka dodatnia: projekt → draft/render → baseline → dwie decyzje → zadania A i B
(B zależy od A) → ready A → reserve → GET package bez zapisu → import → awaiting_review
→ R19 review approved z kompletem dowodów → verified → możliwość uruchomienia B.
R19 evidence pokryć oddzielnie od nieistniejącego R20 deploy-decisions.

Druga ścieżka: review changes_requested → nowa próba → nowy wynik → nowe review.
Potwierdzić historię obu prób i granicę maxCorrectionRounds. Odrzucić próbę ustawienia
verified przez PUT, review innej rewizji, approved przy failed/not_run/missing tests
i manualCheck bez decyzji człowieka. Identyczny replay review jest idempotentny,
ale stare review po nowszym wyniku nie może udawać bieżącego odbioru.

### Success Criteria:
#### Automated Verification:
- `TC-DELIVERY-008` i `010` przechodzą na serwerze OSS-only; wynik sam nie ustawia verified, zależne zadanie czeka na proof.
- Ścieżka changes_requested zachowuje obie próby i egzekwuje limit korekt; replay nie duplikuje evidence.

## Phase 5: QA-04 — scenariusze awarii i dowody AC

### Changes Required:

**Dokument przygotowany w tej sesji, do zweryfikowania podczas implementacji:** `context/changes/delivery-qa-readiness/recovery-scenarios.md`.
**Istniejące punkty odniesienia:** `packages/core/src/modules/delivery_os/commands/__tests__/executorFlow.test.ts`
i `reconcile.test.ts`. **Dokument do uzupełnienia:** `hackathon/delivery-demo/acceptance.md`.
**Intent:** Utrwalić scenariusze i wymagane pomiary dla EXEC, pokrywając teraz istniejącą
maszynę stanów OSS bez tworzenia fikcyjnego endpointu wykonawcy.
**Contract:** Każdy scenariusz ma trigger awarii, stan trwały przed/po, liczniki efektów,
minimalny trace i jawny warunek uruchomienia live. Lista poniżej jest minimalnym zakresem.

| Scenariusz | Oczekiwanie | Możliwe teraz / później |
|---|---|---|
| Przed parkowaniem WAIT_FOR_SIGNAL | Brak enqueue/spawn przed trwałym park | Opis teraz; worker EXEC później |
| Po claim, nieznany spawn, restart | Reconciliation, bez ponownego CLI | Reguły OSS teraz; proces live później |
| Po zapisie evidence, przed signal | Ten sam evidence, ponowienie delivery bez spawn | Fake OSS teraz; trwały restart później |
| Po signal, przed delivered | Idempotentne resume, brak drugiego efektu biznesowego | Opis teraz; workflow live później |
| Concurrent replay | Jeden wynik, jedno skuteczne resume | HTTP wynik teraz; workflow później |
| Cancel przed/po claim | Żądanie ≠ potwierdzony stop; late result odrzucony; unknown blokuje | API OSS teraz; proces live później |
| Dwa niezależne runy | Nakładające się przedziały, odrębne worktree, efektywna concurrency ≥2 | Scenariusz teraz; async/Redis/EXEC później |
| Dwa starty tego samego task | Jeden aktywny attempt i spawn | Rezerwacja HTTP teraz; spawn później |
| Finalna rewizja i fixture negatywna | Stary PASS nie przechodzi na finalny commit; test wykrywa wprowadzony błąd | AC proof teraz; finalna aplikacja później |

Nie dodawać pustych/skipped testów EXEC sugerujących implementację modułu. Brak modułu
to wpis zależności, a nie PASS suite. Nie modyfikować workerów należących do EXEC.

### Success Criteria:
#### Automated Verification:
- Istniejące testy `executorFlow.test.ts`, `reconcile.test.ts` i `acProof.test.ts` zostały uruchomione z zapisanym wynikiem i oznaczeniem mock/fixture.
- Każdy scenariusz recovery wskazuje trigger, oczekiwaną trwałość, liczniki spawn/evidence/resume i warunek live; brak EXEC ma wpis not_run/dependency.

## Phase 6: WP-M02 — mapowanie i kontrola na fixture

### Changes Required:

**Modyfikowany plik:** `packages/core/src/modules/delivery_os/lib/__tests__/wordpressStudioContract.test.ts`.
**Nowy helper testowy:** `packages/core/src/modules/delivery_os/lib/__tests__/wordpressMappingFixture.ts`.
**Nowe dane:** `hackathon/delivery-demo/adapters/wordpress/fixtures/oss-mapping/`
(`README.md`, `base-snapshot.fixture.json`, `result-snapshot.fixture.json`, `checks.fixture.json`,
`artifacts/` z bezpiecznymi surowymi raportami i definicją testu).
**Intent:** Sprawdzić pełny testowy envelope z pakietu OSS i dwóch snapshotów; mapper
pozostaje helperem testowym, przyszły caller produkcyjny należy do EXEC/provider owner.
**Contract:** [wordpress-mapping.md](wordpress-mapping.md) opisuje pochodzenie każdego pola.
Fixture jest oznaczona w sidecar/README; ścisłe DTO OSS nie dostaje nowego pola provenance.

Testy dodatnie: snapshot revision, korelacja pakietu, theme diff z dodaniem/zmianą/usunięciem,
pełne ResultChecks, hashe wyliczone z rzeczywistych bytes fixture, serializacja i walidacja
`resultManifestV1Schema`, `checkResultCorrelation`, `evaluateResultAcceptance`.
Testy negatywne: obcy project/task/attempt/baseline/hash, inny baseRevision,
stara wersja profilu, nieznany AC/test, fałszywy hash bytes, niedozwolona ścieżka,
duplikat checkId, niepełny ToolCheck, partial/failed/not_run, wygasły/unverified preview.
Rozróżnić odrzucenie kształtu od poprawnego zapisu failed/not_run, który nie daje proof.
Nie oczekiwać, że schema sama sprawdzi bytes pliku albo aktualną dostępność URL.

Workspace rewizji bazowej porównuje obecny `checkResultCorrelation`. Zgodność
`resultRevision.externalWorkspaceId` z witryną bazową musi osobno sprawdzać nowy
mapper testowy przed zbudowaniem wyniku. Obecny OSS tej drugiej reguły nie egzekwuje:
zmiana workspace wyniku razem z odpowiadającymi mu checks może przejść walidację.
Zapisać tę obserwację do przekazania OSS; nie pisać testu oczekującego nieistniejącej
odmowy API i nie zmieniać produkcyjnych kontraktów w tej fazie.

Na fixture `externalRunId` ma jawny identyfikator fikcyjnego runa, powiązany w testowym
ledger z toolExecutionId; nie przyjmować, że site creation attempt jest bieżącym attempt.
Snapshot wymaga baseRevision i resultRevision, bez baseCommit/resultCommit. Zmiana
samej bazy zmienia contentHash, ale nie dodaje fikcyjnego path w motywie; przygotowanie
ujawnia tę granicę, nie ustanawia nowej polityki mutacji bazy.

Budżet WP: użytkownik potwierdził 1 h wykorzystaną / 5 h pozostało. Wliczać dalszą
analizę, implementację, review i dokumentację WP; na wyczerpaniu zapisać niedostarczone
elementy, nie finansować nimi niejawnie live PoC. Ta faza nie wymaga Studio.

### Success Criteria:
#### Automated Verification:
- Rozszerzony `wordpressStudioContract.test.ts` przechodzi dla pełnego fixture i przypadków negatywnych; ToolCheck nadal nie jest dowodem AC.
- Fixture hashe odpowiadają zapisanym bytes, a failed/not_run/missing i niezweryfikowany preview nie stają się PASS/verified w ocenie QA.

## Phase 7: Runbook, indeks dowodów i przekazanie

### Changes Required:

**Dokumenty przygotowane w tej sesji, do uzupełnienia podczas implementacji:**
`hackathon/delivery-demo/runbook.md`, `acceptance.md`, `evidence-index.md`.
**Nowy helper:** `packages/core/src/helpers/integration/deliveryEvidence.ts`.
**Intent:** Zapisywać mały JSON do `testInfo.outputPath` i dołączać go przez
`testInfo.attach`, wykorzystując natywny reporter Playwright; bez osobnego frameworka.
Włączyć helper do nowych testów. Indeks ma wskazywać surowe raporty i ich sha256.
**Contract:** Format w runbooku: suiteRunId, caseId, testId/acIds, provenance,
codeRevision/appRevision, scope IDs, project/task/attempt/baseline/hash, sourceRevision,
profile/version, command, exit/status/reason, reportPath/hash, timestamp i cleanupStatus.
Pola niemające zastosowania są jawne, a brak pomiaru pozostaje nieznany. Sekrety i DB dumpy
nie trafiają do repozytorium. Mianownik kontroli wynika z macierzy, nie z liczby odkrytych testów.

### Success Criteria:
#### Automated Verification:
- Nowa suite HTTP jest odkrywana, przechodzi bez retry, zapisuje powiązane raporty i wynik cleanup; brakujące testy są wykazane oddzielnie.
- Indeks pokrywa wszystkie siedem zadań i rozróżnia missing, failed, not_run oraz zależności; wszystkie twierdzenia PASS wskazują bieżący dowód.
#### Manual Verification:
- Odbierający potwierdza zakres przygotowania, listę błędów/zależności i pozostawione odbiory live; główny plan nie ma niezasłużonych zaznaczeń.

## Testing Strategy

Runner wybrać raz przed sekwencją według `.ai/docs/agent-instructions.md`: działający
compose app → Docker i `node scripts/docker-exec.mjs <argumenty yarn>`, inaczej local.
Zapisać runner i compose w evidence. To nie zastępuje ustalenia, że docelowy URL/DB jest disposable.

```bash
yarn workspace @open-mercato/core test delivery_os --runInBand
yarn test:integration --list --grep 'TC-DELIVERY'
yarn test:integration --grep 'TC-DELIVERY-(FIXTURE-001|00[1-8]|010)' --retries=0
yarn test:integration --grep 'TC-DELIVERY-FIXTURE-001' --retries=0 --repeat-each=2
yarn workspace @open-mercato/core typecheck
git diff --check
```

Pierwsza komenda obejmuje również rozszerzony test WP i istniejące recovery/acProof.
Wynik testu negatywnego to PASS, gdy oczekiwane odrzucenie nastąpiło; kontrolowany
negatywny fixture aplikacji ma natomiast wykazać failed w raporcie jej AC.
Testy bezpieczeństwa wywołują pełny HTTP router, nie importują handlerów bez auth middleware.
Blokady i duplikaty sprawdzać także przez stan trwały, nie wyłącznie response.status.
Nie zwiększać globalnego timeoutu/workerów ani nie zmieniać konfiguracji pipeline.

Zmiana helpera wymaga weryfikacji rzeczywistego importu przez test. Nowe pliki testowe
nie wymagają `yarn generate`; uruchomić generator dopiero jeśli realizacja zmieni discovery.
Pakietu WP nie trzeba przebudowywać dla fixture po stronie core. Przy publikacji zmian
stosować wymagany gate repo; pełny gate QA-06 pozostaje osobnym odbiorem finalnej rewizji,
w kolejności `validation.commands` z `.ai/agentic.config.json`. Nie nazywać tej wąskiej suite pełnym gate.

## Performance Considerations

Domyślnie jeden worker Playwright, minimum rekordów per case. Wyścigi wykonać dwoma
żądaniami w jednym scenariuszu, bez globalnego zwiększania concurrency. Polling ma
bounded timeout i warunek, bez stałych sleep służących do maskowania wyścigu. Nie uruchamiać
realnych agentów w zwykłej suite HTTP.

## Migration & Backward Compatibility

Brak zmian schematu, kontraktów v1 i profili. Nowe helpery służą testom. Przed zmianą
jakiegokolwiek kontraktu wrócić do właściciela/specyfikacji; nie dopasowywać API do fixture.
Rollback pakietu QA polega na wycofaniu testów/helperów/dokumentów; aplikacja nie zmienia
zachowania. Sprzątanie środowiska jest obowiązkowe niezależnie od wyniku suite, z zachowaniem
bezpiecznych raportów. Nie usuwamy historii developerów ani aktywnych runów innych osób.

## Risks & Dependencies

| Warunek | Działanie przy braku |
|---|---|
| Gotowa DB/app/bootstrap/storage | not_run/environment; dostarczyć instrukcję provisioning, nie aplikować migracji do cudzej DB |
| Wykryty błąd produktu | failed z reprodukcją i expected/actual; przekazać OSS, zachować kontrolę w macierzy |
| R20–R22, UI obu wejść | missing implementation / not_run; nie tworzyć endpointów w tym planie |
| EXEC async/Redis/park/resume | Scenariusze gotowe, live recovery/two-run not_run/dependency |
| Host WP + profil uruchomiony na aktualnym snapshot | Fixture może przejść; PoC pozostaje not_run |
| Brak pomiaru lub raw report | missing albo not_run/tool_error; nie generować syntetycznego PASS |
| Przekroczenie czasu WP | Jawny handoff w ramach 6 h; nie oznaczać zakresu ukończonym |

## References

- [Plan nadrzędny](../autonomous-software-delivery/plan.md), [QA](../autonomous-software-delivery/workstreams/04-quality-preview.md), [WP](../autonomous-software-delivery/workstreams/05-wordpress-michal.md).
- [Spec OSS](../../../.ai/specs/2026-09-18-delivery-os-hackathon.md), [spec enterprise](../../../.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md), [spec WP](../../../.ai/specs/2026-09-19-wordpress-studio-tools.md).
- [Handover API](../delivery-os-oss-domain/handover/OSS-01-api-and-tests.md), [badanie](research.md), [brief](plan-brief.md).
- `.ai/qa/AGENTS.md`, `packages/core/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/docs/agent-instructions.md`.

## Progress

### Phase 1: QA-02 — izolowane fixture i cleanup
#### Automated
- [x] 1.1 Fixture przechodzi dwa uruchomienia i obsługuje częściowy setup: `yarn test:integration --grep 'TC-DELIVERY-FIXTURE-001' --retries=0 --repeat-each=2`.
- [x] 1.2 Test potwierdza tenant A/B, org A1/A2/B1 i ograniczone ACL rzeczywistych sesji; cleanup nie narusza obcych danych.
#### Manual
- [ ] 1.3 Operator potwierdza własność disposable środowiska oraz sposób usunięcia jego DB/storage/cache po suite; brak pełnego cleanup jest jawny.

### Phase 2: Istniejące API — ACL, scope, wersje i duplikaty
#### Automated
- [x] 2.1 Testy `TC-DELIVERY-001`, `004`, `005`, `006`, `007` przechodzą przez HTTP bez retry i potwierdzają brak zapisów po odmowach.
- [x] 2.2 Równoczesne reserve/result mają jeden trwały efekt; wyniki, liczby rekordów i oba request IDs trafiają do evidence.

### Phase 3: QA-03 — baseline i propozycje backendu
#### Automated
- [x] 3.1 `TC-DELIVERY-002`, `003`, `004` przechodzą dla from_brief i from_design oraz wszystkich negatywnych przypadków z macierzy.
- [x] 3.2 Bez obu aktualnych decyzji nie powstaje wykonywalna próba, a hash/version zatwierdzonego snapshotu pozostają niezmienne.

### Phase 4: Pełny przebieg OSS-only
#### Automated
- [x] 4.1 `TC-DELIVERY-008` i `010` przechodzą na serwerze OSS-only; wynik sam nie ustawia verified, zależne zadanie czeka na proof.
- [x] 4.2 Ścieżka changes_requested zachowuje obie próby i egzekwuje limit korekt; replay nie duplikuje evidence.

### Phase 5: QA-04 — scenariusze awarii i dowody AC
#### Automated
- [x] 5.1 Istniejące testy `executorFlow.test.ts`, `reconcile.test.ts` i `acProof.test.ts` zostały uruchomione z zapisanym wynikiem i oznaczeniem mock/fixture.
- [x] 5.2 Każdy scenariusz recovery wskazuje trigger, oczekiwaną trwałość, liczniki spawn/evidence/resume i warunek live; brak EXEC ma wpis not_run/dependency.

### Phase 6: WP-M02 — mapowanie i kontrola na fixture
#### Automated
- [x] 6.1 Rozszerzony `wordpressStudioContract.test.ts` przechodzi dla pełnego fixture i przypadków negatywnych; ToolCheck nadal nie jest dowodem AC.
- [x] 6.2 Fixture hashe odpowiadają zapisanym bytes, a failed/not_run/missing i niezweryfikowany preview nie stają się PASS/verified w ocenie QA.

### Phase 7: Runbook, indeks dowodów i przekazanie
#### Automated
- [x] 7.1 Nowa suite HTTP jest odkrywana, przechodzi bez retry, zapisuje powiązane raporty i wynik cleanup; brakujące testy są wykazane oddzielnie.
- [x] 7.2 Indeks pokrywa wszystkie siedem zadań i rozróżnia missing, failed, not_run oraz zależności; wszystkie twierdzenia PASS wskazują bieżący dowód.
#### Manual
- [ ] 7.3 Odbierający potwierdza zakres przygotowania, listę błędów/zależności i pozostawione odbiory live; główny plan nie ma niezasłużonych zaznaczeń.
