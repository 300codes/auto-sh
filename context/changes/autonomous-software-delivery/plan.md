# Autonomous Software Delivery — zoptymalizowany plan wdrożenia

> Data: 2026-09-18. Zespół: 4 developerów. Horyzont: 36 godzin kalendarzowych.
> Zakres i układ etapów zatwierdzone przez użytkownika. Dokument planuje implementację; nie potwierdza jej wykonania.
> Skrót: [plan-brief.md](plan-brief.md). Ustalenia i uzupełniające badanie: [research.md](research.md).

## Overview

Dostarczyć kontrolowany przebieg od briefu lub zaakceptowanych ekranów do działającego React preview, z zatwierdzeniem wymagań i designu, wykonaniem przez niezmodyfikowanego Cezara, niezależnym review, jedną rzeczywistą poprawką i raportem dowodów. Domena i planowanie działają w OSS; integracja wykonywania agentów żyje w enterprise.

Open Mercato dostarcza już uwierzytelnianie, ACL, komendy, załączniki, workflow, audit i podstawy UI. Wykorzystanie tych elementów jest warunkiem harmonogramu. Nie wyceniać ponownie całej koncepcji z 35 encjami jako pracy hackathonowej.

React jest obowiązkowym E2E. OM i WordPress są mierzalnymi PoC adapterów. WordPress otrzymuje własne narzędzia Studio w OM i całkowicie nową witrynę. Szczegóły WP-M01 oraz prac niezależnych od pozostałych strumieni zawiera [plan narzędzi Studio](../wordpress-studio-tools/plan.md). Podłączenie OSS/enterprise i PoC OM→WP pozostają późniejszym, zależnym odbiorem; lokalny smoke go nie zalicza.

## Current State Analysis

Źródłami są [specyfikacja](../../../hackathon/open-mercato-autonomous-software-delivery-spec.md) i [analiza ryzyk](../../../hackathon/analiza-ryzyk-autonomous-software-delivery.md). Analiza ustala ryzyka R-01–R-41, ale nie wszystkie opisane braki pozostają aktualne.

| Obszar | Stan i konsekwencja dla planu |
|---|---|
| Governance OM | Używamy istniejących workflow, komend, audit, approval i załączników. Nie budujemy nowego silnika procesu. |
| Propose-only | Agent nie dostaje prawa do bezpośrednich mutacji domeny OM. Efekty biznesowe przechodzą przez autoryzowane komendy; lokalna praca w docelowym repo jest oddzielną powierzchnią wykonania. |
| OAuth | Endpoint `packages/enterprise/src/modules/agent_orchestrator/api/identity/token/route.ts:43` już istnieje. Historyczny draft dispatchu nie jest dowodem jego braku. |
| Dispatch | Pełny trwały pull worker obejmuje fazy 1–4 specyfikacji dispatchu. Hackathon używa adaptera nad istniejącym CLI lub jawnego przekazania ręcznego. |
| Cezar | Oficjalne README dokumentuje headless `cezar-cli run`, worktree i zalogowane CLI. Dokładna wersja, output i odzyskanie runa wymagają próby H0–H3. |
| Figma | Oficjalne MCP umożliwia zapis `use_figma` przez Codex/Claude Code. Wymaga Full seat i prawa edycji. To zastępuje założenie o konieczności budowy własnej integracji zapisu. |
| WordPress | Własny pakiet delivery-wordpress wywołuje Studio CLI; stary serwer, API, DB, kolejka i projekty nie są zależnościami. |
| Dowody WP | Dokumentacja opisuje udany cykl z 2026-09-08, ale wskazane preview wygasło 2026-09-15. Potrzebny nowy pomiar; historyczne PASS nie wystarcza. |
| Koszty | Użytkownik wybrał posiadane subskrypcje. Nie zakładamy płatnych kluczy API ani raportu kosztu w USD, jeśli źródło go nie dostarcza. |

### Key Discoveries

- Granicę OSS/enterprise realizować jednokierunkowo: enterprise konsumuje publiczne kontrakty OSS; OSS nie importuje ani nie rozwiązuje serwisów swojego konsumenta. Wzorzec: `packages/core/AGENTS.md`, Cross-Module Coupling.
- `WorkflowInstance` jest właścicielem lifecycle wykonania; `ProcessInstance` to projekcja. Nie tworzyć drugiego silnika przez kolumnę status projektu: `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`, The Process Model.
- `/trace/ingest` zapisuje telemetrię; sam ingest nie jest akceptacją pracy ani wznowieniem workflow. Nie dodajemy znaczenia biznesowego do istniejącego kontraktu HMAC.
- Historyczne źródło, **superseded jako integracja runtime**: WordPress ma `POST /api/projects/:id/runs` i `GET /api/runs/:id/report`: `/var/www/html/ai-tools/ai-wordpress-orchestrator/src/server/app.js:167` i `:169`.
- WordPress oddziela deklarację modelu od kontroli hosta: `docs/orchestration-evidence.md:19` w tym samym repo. Ten podział zachowujemy w raportach OM.

## Desired End State

Operator tworzy projekt z briefu. Agent tworzy rzeczywiste, edytowalne ekrany w Figmie. OM zapisuje wymagania/AC oraz render i referencje designu jako baseline, który człowiek zatwierdza. Drugi projekt startuje z istniejących zatwierdzonych ekranów i ręcznie opisanych wymagań; dalej korzysta z tego samego kontraktu.

Cezar wykonuje dwa niezależne zadania w osobnych worktree. Co najmniej jeden finding review prowadzi do rzeczywistej poprawki i ponownego testu. OM pokazuje pochodzenie wyników, bieżące zadania, dowody testów, preview oraz powiązanie wymaganie → AC → zadanie → commit → test → deployment. Człowiek podejmuje końcową decyzję na podstawie tych dowodów.

Wariant awaryjny ma oznaczenie `manual_handoff`: operator uruchamia Cezara i importuje wynik. Nadal obowiązują wszystkie kontrole wyniku. Nie przedstawiamy tego wariantu jako pełnej automatyzacji przekazania pracy.

## Zakres i decyzje

| Decyzja | Wybór | Pochodzenie |
|---|---|---|
| Wejścia | FROM_BRIEF + ograniczone FROM_DESIGN | Użytkownik, odpowiedź 1 |
| Zespół | 4 developerów, 36 h; bez rozwijania Cezara | Użytkownik, odpowiedź 2 |
| Produkty | Domena/planowanie OSS, wykonanie enterprise | Użytkownik, odpowiedź 3 |
| Cezar | Adapter OM; ręczne przekazanie/import jako awaria | Użytkownik, odpowiedź 4 |
| Design | Tworzy agent podczas demo, zatwierdza człowiek | Użytkownik, odpowiedź 5 |
| Finansowanie | Istniejące subskrypcje; Extra Credits tylko po osobnej decyzji | Użytkownik, odpowiedź 6 |
| Platformy | React E2E; OM/WP PoC; własne narzędzia Studio i nowa witryna | Użytkownik, odpowiedź 7 i doprecyzowanie |
| Koniec | Preview/staging, dowody, akceptacja; dalsze etapy bez dat | Użytkownik, odpowiedź 8 |
| Harmonogram | Sześć etapów; H28–H36 stabilizacja; WP max 6 osobogodzin | Zatwierdzony układ planu |

## What We're NOT Doing

- Nie zmieniamy kodu Cezara i nie implementujemy pełnej floty pull/A2A, rejestru runnerów ani drabiny autonomii.
- Nie generujemy specyfikacji zachowania z samych obrazów FROM_DESIGN ani automatycznie nie rekonstruujemy całego DS.
- Nie traktujemy pixel diff Figma–przeglądarka jako bramki; screenshoty są dowodem dla człowieka, testy DOM i zachowania są obiektywną kontrolą.
- Nie budujemy ogólnego edytora grafu, canvasu z zoomem, automatycznego przenoszenia komentarzy między wersjami, katalogu 35 CRUD-ów ani retrieval repozytoriów.
- Nie wdrażamy produkcji, samonaprawy incydentów, rozliczeń wielowalutowych, wspólnego magazynu poświadczeń klientów ani bezpiecznego SaaS dla dowolnego obcego kodu.
- Nie używamy starego runtime WordPressa, jego sesji, API, kolejki, DB ani istniejących projektów. Źródła są wyłącznie referencją; własny pakiet OM korzysta bezpośrednio ze Studio CLI.
- Nie zmieniamy pipeline PR, etykiet, governance DS, publicznych kontraktów istniejących modułów ani wskaźnika official-modules.

## Implementation Approach

### Układ kodu i właściciele prawdy

Ścieżki niżej są **planowanymi nowymi plikami**, chyba że jawnie oznaczono reuse.

| Obszar | Lokalizacja | Odpowiedzialność |
|---|---|---|
| Domena OSS | `packages/core/src/modules/delivery_os/` | Projekty, baseline, zadania, decyzje, dowody, raport, ręczny import/export. |
| Wykonanie enterprise | `packages/enterprise/src/modules/delivery_agents/` | Uruchomienie istniejącego workflow, autoryzowane efekty, odbiór wyniku, projekcja wykonania. |
| Adapter Cezara | `packages/delivery-cezar/` | Dedykowany pakiet integracji z CLI; konsumowany przez enterprise. Bez provider-specific konfiguracji w core. |
| Kontrakty OSS | `delivery_os/lib/contracts.ts` | Wersjonowane DTO task/result/adapter, Zod, dostępne bez enterprise. |
| Deskryptory targetów | `delivery_os/lib/targetProfiles.ts` | Dane o React, OM i WordPress: możliwości, wymagane dowody, wersja profilu. Bez kodu zewnętrznych providerów. |
| Figma | Sesja obsługiwanego klienta MCP + import baseline do OSS | Zapis agenta na stanowisku designera. Nie powstaje nowy serwer proxy Figma. |
| WordPress PoC | Własny `packages/delivery-wordpress/` + wspólny manifest | Nowa witryna przez Studio CLI; integracja OSS/enterprise po gotowości ich kontraktów. Lokalny smoke nie zalicza PoC. |

UI enterprise dodaje akcję uruchomienia przez istniejący mechanizm widget injection. OSS udostępnia import/export i zadeklarowany spot `delivery_os.project.execution`; nie rozwiązuje tokena DI należącego do enterprise. Dostępność funkcji wynika z aktywnego rozszerzenia i ACL, nie z hardcoded roli.

Publiczny backend pozostaje autorytatywny dla danych i decyzji. Cezar zarządza lokalnymi krokami jednego zadania; własne narzędzia Studio wykonują operacje WP, a ich wywołaniami docelowo zarządza orchestrator OM. Żaden z nich nie zatwierdza projektu w OM. Powiązania do innych modułów to ID i snapshot, bez relacji ORM między modułami.

Host OSS rzeczywiście renderuje `InjectionSpot` z `spotId="delivery_os.project.execution"` na szczegółach projektu. Typowany kontekst zawiera projectId, opcjonalne taskId/baselineId, updatedAt i retryLastMutation; wynik mutacji odświeża dane hosta. Enterprise deklaruje widget w `widgets/injection-table.ts`. Sama deklaracja spotu nie renderuje rozszerzenia.

### Minimalny model danych

Zamiast osobnych CRUD-ów dla każdej nazwy ze specyfikacji: pięć encji OSS oraz istniejące encje platformy.

| Encja | Kontrakt |
|---|---|
| `DeliveryProject` | Nazwa, tryb wejścia, brief, target, draftSpec JSON, referencja aktywnego baseline, limity iteracji/czasu. Edytowalna, optimistic locking. |
| `DeliveryBaseline` | Append-only: wersja, hash, requirements z trwałymi ID, AC z trwałymi ID, screen refs, snapshot tokenów, architecture/plan summary, attachment IDs. Akceptacja w osobnej decyzji; baseline nie jest nadpisywany. |
| `DeliveryTask` | Baseline ID, AC IDs, dependencies IDs, opis, target, wersja profilu, status biznesowy, numer próby, walidowany rejestr `executionAttempts` JSON i referencje zewnętrznego wykonania/workflow. Edytowalna, optimistic locking. |
| `DeliveryEvidence` | Append-only: typ, task/attempt/baseline, sourceRevision (commit SHA lub hash snapshotu), manifest/hash załącznika, wyniki kontroli, źródło `adapter/manual`, aktor importu. Typy obejmują result_manifest, test, review, screenshot, deployment. |
| `DeliveryDecision` | Append-only: requirements/design/deploy/release/change, przedmiot i jego hash/wersja, verdict, actor, timestamp, reason. Decyzji nie edytujemy; nowa decyzja zastępuje poprzednią logicznie. |

Każda encja zawiera tenant i organization. Wszystkie odczyty, w tym relacje i załączniki, sprawdzają oba zakresy. Append-only nie oznacza braku ACL. Projekty i zadania zwracają `updatedAt`; update/delete oraz custom actions respektują optimistic locking.

`executionAttempts` zapisuje przed spawn: attemptId, idempotencyKey, baselineHash, baseCommit, mode, reservedAt, claimedAt, workerRef, externalRunId, workflowRef, cancellationRequestedAt i stan uzgodnienia. Przydział i claim wykonuje jedna komenda OSS pod blokadą wiersza zadania; tylko jeden attempt może być aktywny. Ten sam klucz i payload zwracają istniejącą próbę, inny payload daje 409. Rejestr ma limit 16 prób na zadanie; jego osiągnięcie blokuje nowy start, nie usuwa historii. To mały rejestr transportu, nie drugi silnik workflow. Zmiany operacyjne mają audit komendy. Wynik terminalny utrwala się w append-only evidence; częściowy indeks unique `(tenant_id, organization_id, task_id, attempt_id)` dla `kind = 'result_manifest'` chroni przed ponownym zapisem wyniku. Ten kontrakt działa również dla importu ręcznego bez enterprise.

DELETE projektów i zadań oznacza soft delete/archiwizację, bez kaskadowego usuwania baseline, decyzji, dowodów ani ich załączników. Aktywna lub nieuzgodniona próba blokuje usunięcie; najpierw cancellation i potwierdzenie zatrzymania/reconciliation. Projekt z aktywnym zadaniem również nie może zostać zarchiwizowany. Archiwalne raporty pozostają dostępne dla uprawnionych użytkowników, a domyślne listy pomijają archiwalne rekordy. Fizyczny cleanup jest osobną późniejszą decyzją retencji.

Wymagania/AC, pytania, ryzyka i ADR w tej iteracji są walidowanymi sekcjami draftu/baseline, a nie osobnymi tabelami z niezależnymi stronami. Daje to edycję i traceability bez kosztu kilkunastu CRUD-ów. Screen i komentarz wskazują konkretny snapshot; minimalny komentarz ma opcjonalne współrzędne 0–1, treść i status w draft review. Zatwierdzony baseline przechowuje snapshot rozstrzygnięć. Nie przenosimy kotwic automatycznie.

Traceability jest projekcją jawnych relacji wewnątrz `delivery_os`; nie wymaga polimorficznego silnika grafowego. API zwraca batch dla jednego projektu i baseline, z limitem wielkości. Do runów enterprise prowadzą ID/linki; przy nieaktywnym enterprise pozostaje czytelny snapshot.

### Kontrakty między stanowiskami

`TaskPackage v1`: `schemaVersion`, `projectId`, `taskId`, `attemptId`, `baselineId`, `baselineHash`, `targetProfileId/version`, `requirements/AC`, `designArtifactRefs`, `repositoryRef`, `baseCommit`, `allowedPaths`, `validationProfile`, `limits`, `idempotencyKey`.

`ResultManifest v1`: korelacja z pakietem, `externalRunId`, `baseCommit`, `resultCommit`, zmienione ścieżki, artefakty z hashami, `checks[]` z command/profile ID, exit code, czasem, commit SHA i statusem `passed/failed/not_run`, deklaracja agenta jako oddzielne pole, findings, usage ze wskazaniem źródła i wartości nieznanych.

Każda kontrola ma trwałe `checkId`, `testId`, `acIds[]`, `validationProfileVersion` i `testDefinitionHash`, a wynik testu również `sourceRevision` i hash surowego raportu. W profilu zatwierdzonym przed wykonaniem utrwalić `acId → requiredTestIds[]`; model nie może sam dopisywać brakujących mapowań jako dowodu pokrycia. PASS dla AC wymaga wszystkich obowiązkowych testów tego AC na odbieranej wersji, bez failed/skipped/not_run. Pusty zbiór wymaganych testów oznacza missing. Kryteria oceniane manualnie wskazują osobny `manualCheckId` i decyzję człowieka, nigdy fikcyjny test automatyczny.

Rewizja źródła to unia `sourceRevision = { kind: 'git', commitSha } | { kind: 'snapshot', contentHash, externalWorkspaceId }`. React i OM wymagają wariantu git; WP PoC może użyć hasha zamrożonego motywu i snapshotu danych. Nie wymyślać commit SHA dla raportu WordPressa. `baseCommit/resultCommit` są wymagane dla git, nieobecne dla snapshot; odpowiednia rewizja bazowa i wynikowa pozostaje obowiązkowa. Historyczny raport WP bez korelacji do nowego task/baseline zapisuje się wyłącznie jako materiał referencyjny, nie jako wynik nowej próby ani dowód jej AC. PoC musi odebrać świeży wynik własnych narzędzi skorelowany z wyeksportowanym pakietem; import starych raportów nie jest ścieżką wykonania.

### Publiczne operacje prób i decyzji

`GET /tasks/:id/package` jest tylko odczytem. Najpierw operator wywołuje `POST /api/delivery_os/tasks/:id/attempts` z `mode: manual_handoff`, `Idempotency-Key` i aktualnym nagłówkiem optimistic lock zadania. Komenda rezerwuje attempt i zwraca `201 { attemptId, taskId, baselineId, baselineHash, taskUpdatedAt, packageUrl }`; powtórzenie tego samego klucza zwraca istniejący rezultat `200`, inny payload `409`. `packageUrl` zawiera `attemptId`; GET dla nieistniejącej próby nie tworzy żadnego rekordu. Enterprise korzysta z tej samej komendy domenowej, przekazując tryb automatic przez zaufany kontekst wewnętrzny, nie przez edytowalne pole publicznego API.

`POST /tasks/:id/results` przyjmuje istniejący attemptId i manifest, zwraca `{ evidenceId, duplicate, taskStatus, taskUpdatedAt }`. Porównanie idempotencji dla już zaakceptowanego identycznego wyniku następuje przed odrzuceniem terminalnej próby; obcy tenant lub różny hash wyniku zawsze blokują replay. Nowy import nie może podmienić approvalu ani wywołać CLI.

`POST /tasks/:id/attempts/:attemptId/cancel` zapisuje żądanie anulowania; `POST .../reconcile` przyjmuje dowód stanu zewnętrznego i rozstrzygnięcie `not_started/stopped/completed/unknown`. Operacje wymagają osobnych features manage/reconcile oraz optimistic lock. Unknown nadal blokuje ponowny start i archiwizację. Completed prowadzi do zwykłej walidacji manifestu, nigdy bezpośrednio do verified. Stop potwierdza operator/wrapper na podstawie realnego procesu, nie samego kodu wyjścia żądania cancel.

Decyzje design/requirements korzystają z `/baselines/:id/decisions`. Publikacja ma `POST /projects/:id/deploy-decisions` ze wskazaniem baseline i rewizji do publikacji, a odbiór `POST /projects/:id/release-decisions` ze wskazaniem evidenceId zweryfikowanego deploymentu. Zapis dowodów review/test/deployment odbywa się przez `POST /projects/:id/evidence` z walidowanym discriminatorem rodzaju; endpoint nie wykonuje publikacji. Wszystkie ścieżki mają odczyt uprawnień i zakresu po stronie serwera, command guards oraz `openApi`.

Zaufane tenant/org pochodzą z sesji backendu, nigdy z manifestu. Repo i komendy są wybierane z konfiguracji stanowiska; agent nie dostarcza arbitralnej komendy shell do wykonania na serwerze OM. Worker uruchamia CLI tablicą argumentów bez powłoki. Załączniki mają limit rozmiaru, sprawdzenie typu, ścieżek i hashów; import nie uruchamia kodu z archiwum.

Własny wrapper mierzy exit code i wywołuje zapisane walidacje. Raport LLM nie może sam nadać testowi PASS. Ręcznie importowany raport zachowuje pochodzenie i wymaga powtórzenia krytycznych testów przez weryfikatora przed release. Trace ingest może uzupełnić obserwowalność, ale nie zmienia statusu odbioru.

### Lifecycle i reguły awarii

- Zadanie: `draft → ready → executing → awaiting_review → changes_requested → executing → verified`; dodatkowo `blocked`, `cancelled`. `verified` wymaga dowodów dla bieżącego baseline i sourceRevision. Deployment/release mają osobne dowody/decyzje.
- Lifecycle procesu należy do `WorkflowInstance`. Status i procent projektu są wyliczane z baseline, zadań, dowodów i decyzji; procent ma jawny mianownik, bez sztucznych 82%.
- `WorkflowInstance` dotyczy wykonania enterprise. W OSS-only eksport, import, ręczna decyzja i przejścia biznesowe zadania działają przez komendy `delivery_os`, bez tworzenia procesu agentowego. Pole workflowRef jest wtedy puste; UI nie sugeruje, że uruchomiono automatyzację.
- Zmiana scope tworzy nowy draft/baseline. Bieżące zadania pozostają przypięte do starej wersji; nowe zadania wymagają akceptacji nowej. Wynik starego baseline nie zalicza nowego.
- Domyślnie dwa aktywne zadania w odrębnych worktree, maksymalnie dwie rundy poprawek na zadanie; limit 20 minut na próbę wykonania, potem jawna eskalacja. Prawdziwe potrzeby dłuższej pracy wymagają decyzji operatora, nie samoczynnego zwiększenia limitu.
- Blokada zatrzymuje zadanie i potomków; niezależne zadania mogą pracować. Walidacja planu odrzuca cykl i zależność do obcego projektu.
- Jedna próba ma jeden klucz startu. Zapis rezerwacji przed spawn i warunkowy claim chronią przed równoczesnym startem. Po restarcie przy nieznanym stanie procesu status to `blocked/reconciliation_required`; sprawdzić zewnętrzny run przed retry. Nie obiecywać exactly-once dla CLI.
- Ręczne i automatyczne wyniki przechodzą tę samą walidację schematu, korelacji i wersji. Identyczny ponowny import nie tworzy nowego dowodu, ale ponawia niedostarczone wznowienie workflow; inna treść pod tym samym attempt/result key daje konflikt.
- Anulowanie blokuje nowe dispatch i przyjęcie spóźnionego wyniku. Adapter próbuje zatrzymać własną grupę procesów; bez potwierdzenia pokazuje `stop_unconfirmed`. Nie udawać zakończenia zewnętrznej sesji.
- Human gate trwa bez automatycznej akceptacji po czasie. Na hackathonie właściciel bramki jest obecny; automatyczny driver eskalacji pozostaje dalszym etapem.
- Brak limitu subskrypcji lub błąd uwierzytelnienia zatrzymuje nowe wywołania. Można jawnie przełączyć zatwierdzony profil i rozpocząć nową próbę; bez automatycznego zakupu kredytów i rotowania kont w celu obchodzenia limitów.

## Harmonogram, zasoby i ścieżka krytyczna

Rozpiska zadań na równoległe strumienie, przekazania i bloki pracy: [workstreams/README.md](workstreams/README.md). Zespół sam obsadza strumienie; zadania wymagające dostępu do lokalnego Studio wykonuje Michał lub upoważniony agent, według [pakietu WP](workstreams/05-wordpress-michal.md). Pakiet pozostaje w limicie 6 h, wydzielonym z poniższego przydziału D; nie dodaje piątej osoby. Używamy Markdown i commitów, bez GitHub Issues.

| Etap | Okno | A: OSS/backend | B: wykonanie | C: design/UI | D: QA/adapters | Razem h pracy |
|---|---|---:|---:|---:|---:|---:|
| 1. Próby | H0–H3 | 2 | 3 | 3 | 2 | 10 |
| 2. Fundament | H3–H10 | 6 | 4 | 2 | 2 | 14 |
| 3. Wejścia/Figma | H6–H16 | 4 | 0 | 7 | 2 | 13 |
| 4. React/review | H8–H24 | 5 | 9 | 4 | 5 | 23 |
| 5. Preview/PoC | H20–H28 | 2 | 2 | 2 | 5 | 11 |
| 6. Stabilizacja | H28–H36 | 4 | 4 | 4 | 4 | 16 |
| **Suma** | | **23** | **22** | **22** | **20** | **87** |

Pozostałe 57 h z nominalnych 144 to odpoczynek, oczekiwanie na generację/build, komunikacja i bufor. To szacunek planistyczny dla małego scenariusza i działającego środowiska; nie gwarancja zmieszczenia pełnej koncepcji. Tabela nie została podniesiona o pracę weryfikacyjną dodaną po review; jej korekta jest wynikiem pomiaru w H3, nie kolejnego szacowania przy biurku. Developer D ma w etapach 1 i 5 łącznie najwyżej 6 h na WP; OM PoC i QA mieszczą się w jego pozostałych przydziałach. Nakładające się okna nie oznaczają równoczesnej pracy jednej osoby nad dwoma zadaniami.

Pierwsze trzy godziny są twardym sprawdzeniem wykonalności, z limitem 60–90 minut na każde konkretne niepowodzenie. Nie uruchamiać równolegle dwóch agentów edytujących te same pliki. A integruje wspólne kontrakty i generator; B/C/D pracują na rozłącznych obszarach i małych commitach.

Ścieżka krytyczna: Figma write + środowisko → kontrakt baseline/result → zatwierdzony design → React implementacja → weryfikacja i poprawka → preview → akceptacja. WordPress nie leży na ścieżce krytycznej.

### Punkty decyzji

| Moment | Dowód | Działanie przy niepowodzeniu |
|---|---|---|
| H3 | Cezar start/result; Figma write/render; uruchomiony host OM; kolejka async/Redis | Dla Cezara przejść na uzgodnione manual_handoff. Brak Figma write oznacza niezaliczony wymóg FROM_BRIEF i eskalację; nie zastępować go ręcznym designem. Brak async/Redis odbiera etapowi 4 dwa równoległe runy. Na koniec okna obowiązkowo skorygować tabelę 87 osobogodzin zmierzonym czasem prób i pełnego gate, zapisać nową liczbę i ciąć zakres — bez przesuwania freeze H28. |
| H10 | OSS działa bez enterprise, DTO v1 zamrożone | Zatrzymać dodatki; A/B naprawiają kontrakt. Nie odraczać tenancy ani testu OSS-only. |
| H16 | Oba wejścia dają zatwierdzony baseline | Nie rozpoczynać implementacji na niezatwierdzonym snapshotcie. |
| H24 | React działa, correction loop ma dowody | Zakończyć rozwijanie dodatkowych funkcji i użyć bufora. WP pozostaje osobno raportowanym PoC; sam pakiet narzędzi nie zalicza integracji. |
| H28 | Preview i raport skorelowane z commit | Feature freeze; dalsza praca tylko nad kryteriami odbioru i błędami. |
| H34 | Próba demo + gate walidacyjny | Czerwone kryterium oznaczyć jako niezaliczone; nie zmieniać definicji PASS dla prezentacji. |

## Critical Implementation Details

### Granica sesji

Figma MCP i subskrypcyjne CLI działają na zalogowanych stanowiskach; nie zakładamy, że sesja interaktywna jest dostępna procesowi Node w kontenerze. Próba H0–H3 używa dokładnie tego procesu, użytkownika systemowego i konfiguracji MCP, których użyje demo. Bez przenoszenia plików poświadczeń do repo lub do kontekstu modelu.

### Kolejność zatwierdzania

Najpierw utrwalić dowody i snapshot, potem zatwierdzić ich konkretny hash, dopiero potem dopuścić efekt. Dwie równoczesne decyzje i spóźniony callback muszą być rozstrzygane transakcyjnie. Akceptacja wyniku agenta nie zastępuje osobnej zgody na publikację preview.

Decyzja append-only nie ma własnej edytowalnej wersji. Komenda zatwierdzenia porównuje hash przedmiotu i `updatedAt` projektu/zadania pod blokadą transakcji; drugi sprzeczny zapis dostaje konflikt. Aktualizacja aktywnego baseline i zapis decyzji są jedną transakcją.

### Prawda o kosztach i dowodach

`subscription / usage unknown` nie jest kosztem 0 USD. Brak testu jest `not_run`, brak dowodu zgodności AC jest `missing`, a upload bez weryfikacji URL jest `unverified`. To trzy odrębne stany, których UI nie może zamieniać na sukces.

## Phase 1: Próby integracji i zamrożenie scenariusza

### Overview

H0–H3. Usunąć niepewność dotyczącą sesji, Figma write, CLI i preview przed budową UI. Scenariusz referencyjny: mały katalog usług React, lista z filtrem i formularz zgłoszenia z walidacją oraz potwierdzeniem. Dane demonstracyjne, bez płatności i integracji produkcyjnych; 3–5 wymagań, 6–8 AC, desktop/mobile.

### Changes Required

**Files:** `hackathon/delivery-demo/readiness.md`, `hackathon/delivery-demo/fixtures/`, `.ai/specs/2026-09-18-delivery-os-hackathon.md`, `.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md`.

**Intent:** Zapisać wersje narzędzi, wynik prób, scenariusz i małe specyfikacje zgodne z podziałem licencyjnym. Przygotować repo React i wybrany już dostępny cel preview; jako bazowy profil React przyjąć Vite/TypeScript i statyczny build.

**Contract:** Dwa specy odwołują się do tego planu, zawierają model/API, integration coverage oraz Migration & Backward Compatibility. Readiness zapisuje `automatic/manual_handoff`, wersję Cezara i profile stanowisk bez sekretów. Hosting jest parametrem środowiska `previewTargetRef`; nie budujemy nowego providera hostingu. Brak gotowego targetu to blocker, nie zgoda na nowy płatny hosting. Readiness zapisuje także rozstrzygniętą kolejkę: `QUEUE_STRATEGY`, obecność `QUEUE_REDIS_URL`/`REDIS_URL` oraz `DB_POOL_MAX`/`OM_WORKERS_DB_CONNECTION_BUDGET`. Lokalna strategia przetwarza sekwencyjnie, więc nie dowodzi dwóch równoległych runów etapu 4; rozstrzygnięcie należy do tego okna, nie do H8.

**Files:** `packages/delivery-wordpress/`, nowy `hackathon/delivery-demo/wordpress-reuse.md`; szczegóły: [plan narzędzi Studio](../wordpress-studio-tools/plan.md).

**Intent:** WP-M01: maksymalnie 2 h readiness Studio i kontraktu własnych narzędzi. Dalej wykonywać niezależne narzędzia i nową witrynę w pozostałym budżecie 6 h łącznie; limit nie gwarantuje ukończenia całego pakietu WP.

**Contract:** Bez odczytu plików sekretów, zmian starego orchestratora i użycia jego runtime. Zapis `ready/blocked`, kontraktu narzędzi i nowego manifestu. Test samodzielności: odmowa wszystkich wywołań HTTP podczas testu narzędzi. Fixture i lokalna witryna nie zaliczają PoC OM→WP ani preview.

### Success Criteria

#### Automated Verification

- Readiness zawiera wersje, tryb Cezara, wybrany target preview oraz zapis exit code rzeczywistej próby CLI; dane sekretne są wykluczone.
- Agent utworzył frame w Figmie i zwrócił jego ID; odczyt tego ID i renderu potwierdza istnienie wyniku.
- Bazowa aplikacja React przechodzi build i test przykładowego AC na docelowym stanowisku.
- Readiness dowodzi gotowości kolejki do dwóch równoległych wykonań: zapisany `QUEUE_STRATEGY=async`, osiągalny Redis oraz zalogowany plan budżetu połączeń z efektywną współbieżnością nie mniejszą niż 2 dla jednej kolejki; strategia lokalna jest zapisana jako blocker równoległości, nie jako wynik pozytywny.

#### Manual Verification

- Zespół ogląda utworzony przez agenta ekran, potwierdza login/Full seat i prawa edycji oraz rozumie automatyczny lub ręczny tryb Cezara.
- D potwierdza gotowość własnych narzędzi Studio albo zapisuje blocker w timeboxie; historyczny tytuł Progress 1.5 zachowano, jego kryterium należy interpretować zgodnie z tą korektą.

**Implementation Note:** Po testach właściciel etapu potwierdza manualne kryteria. Zadania zależne czekają na wynik; niezależne przygotowanie kontraktów może trwać.

## Phase 2: Fundament OSS i kontrakt enterprise

### Overview

H3–H10. Zbudować minimalną domenę i granicę integracji; bez agentów można już założyć projekt, opisać wymagania, zaplanować zadania i zaimportować dowody.

### Changes Required

**Files:** `packages/core/src/modules/delivery_os/{index,acl,setup,events,di}.ts`, `data/{entities,validators}.ts`, `lib/{contracts,traceability,projectStatus}.ts`, `commands/`, `api/`, `migrations/`.

**Intent:** Wprowadzić pięć encji, domenowe komendy, odczyty i walidowane DTO v1. CRUD wzorować na `customers`, a nie kopiować cały moduł.

**Contract:** Prefiks tabel `delivery_`, UUID, tenant/org, updatedAt dla edytowalnych danych, addytywne API `/api/delivery_os/*`, zdarzenia `delivery_os.project.created`, `delivery_os.baseline.approved`, `delivery_os.task.updated`, `delivery_os.evidence.recorded`. Nowe ACL w `acl.ts` i `setup.ts` rozdzielają view, manage, approve, import, reconcile oraz publish/release. Anulowanie i uzgodnienie próby, decyzja publikacji i końcowy odbiór nie dzielą jednego feature z edycją zadania; sprawdzanie wildcardów idzie przez istniejące helpery, bez nazw ról. Writes przez command + mutation guards. Załączniki przez istniejący moduł attachments.

**Files:** `backend/delivery/projects/page.tsx`, `backend/delivery/projects/[id]/page.tsx`, `components/`, `i18n/*.json`, `extension-points.ts` w OSS; `packages/enterprise/src/modules/delivery_agents/{index,acl,setup,di}.ts`, `widgets/`.

**Intent:** Dwa ekrany OSS: lista i szczegóły projektu z sekcjami wymagania/design/zadania/dowody. Enterprise wstrzykuje akcje wykonania.

**Contract:** `CrudForm`, `DataTable`, `apiCall`, tłumaczenia i tokeny DS; brak nowych governance rules. Custom writes używają guarded mutations. OSS nie importuje enterprise; bez rozszerzenia nadal działa ręczny import/export. Brak agent execution w OSS.

**Aktywacja:** Zarejestrować delivery_os w istniejącym deklaratywnym `apps/mercato/src/modules.ts`, a delivery_agents pod tymi samymi flagami enterprise/agents co agent_orchestrator. To aktualizacja istniejącej konfiguracji modułów; nowa logika pozostaje w packages. Dodać workspace dependency `@open-mercato/delivery-cezar` do enterprise i uruchomić `yarn generate`. Sprawdzić oba warianty rejestru i build: OSS-only oraz enterprise. Nie aktywować automatycznie modułów w szablonie create-app.

### Success Criteria

#### Automated Verification

- Testy DTO, cykli zależności i statusu projektu przechodzą; nieznana wersja manifestu jest odrzucana.
- Testy API potwierdzają izolację tenant/org, ACL i konflikty updatedAt dla projektów/zadań/decyzji zależnych od wersji.
- Build i smoke OSS-only przechodzą bez enterprise; z enterprise pojawia się rozszerzenie bez zmiany kontraktu OSS.

#### Manual Verification

- Operator tworzy projekt, wpisuje wymagania i dwa zależne zadania, eksportuje pakiet i widzi zrozumiały stan przy braku enterprise.

**Implementation Note:** Potwierdzić ręcznie granicę OSS/enterprise przed rozpoczęciem zależnego UI wykonania.

## Phase 3: Dwa wejścia, Figma i baseline

### Overview

H6–H16. Doprowadzić oba wejścia do tego samego zatwierdzonego kontraktu implementacji.

### Changes Required

**Files:** `delivery_os/lib/{baseline,designReview}.ts`, `commands/baselines.ts`, `api/projects/[id]/baselines/route.ts`, `api/baselines/[id]/decisions/route.ts`, `components/{ProjectIntake,DesignReview,BaselineSummary}.tsx`.

**Intent:** FROM_BRIEF przyjmuje brief i propozycję wymagań; FROM_DESIGN wymaga ręcznie opisanych AC i wskazania zatwierdzonych ekranów. Wspólny formularz umożliwia review i akceptację.

**Contract:** Snapshot zawiera render bytes w attachments, file/node refs, datę pobrania, hash, wymagania/AC i podstawowe tokeny. Numer wersji Figmy zapisujemy tylko gdy jest dostępny; własny snapshot/hash jest obowiązkowy. Temporary screenshot URL nie jest trwałym baseline.

**Powstanie propozycji:** Dodać `hackathon/delivery-demo/skills/{requirements-from-brief,plan-from-baseline}.md` oraz walidowany manifest propozycji. Pierwsza sesja agenta przygotowuje 3–5 wymagań i 6–8 AC z briefu; po akceptacji wymagań i designu druga proponuje krótki opis architektury, zadania, allowedPaths, zależności i mapowanie AC do wymaganych testów. Import odbywa się przez komendy draftu i zadań OSS, z kontrolą wersji oraz referencji. Człowiek zatwierdza scalony baseline przed wykonaniem. FROM_DESIGN korzysta z ręcznych wymagań i tego samego planowania. Użyć zatwierdzonej sesji CLI/subskrypcji, bez nowego płatnego API i bez zmiany Cezara; jawny import propozycji nie jest automatycznym dispatch. A odpowiada za kontrakt, C za przejście UI. W H8–H16 B przygotowuje bridge na fixture; kod aplikacji powstaje dopiero po zatwierdzeniu baseline.

**Files:** `hackathon/delivery-demo/skills/design-from-brief.md`, `hackathon/delivery-demo/fixtures/design-manifest.v1.json`.

**Intent:** Mały prompt/skill dla oficjalnego MCP tworzy 1–2 ekrany, wariant mobile i potrzebne stany. Człowiek ocenia i zatwierdza; jedna uwaga prowadzi do nowej wersji wykonanej przez agenta.

**Contract:** Kierunek designu dotyczy aplikacji klienta; DS platformy OM pozostaje code-as-truth. Komentarz wiąże się ze snapshotem i opcjonalnym punktem x/y. Bez automatycznego re-anchoringu, OAuth backendu Figma i własnego canvasu. Generowanie i import pozostają oddzielnymi operacjami z jawnym źródłem.

### Success Criteria

#### Automated Verification

- Oba wejścia zapisują ten sam schemat baseline; bez AC, renderu lub wymaganych decyzji nie można ustawić zadania ready.
- Test zmiany baseline potwierdza niezmienność wersji zatwierdzonej i odrzucenie jej spóźnionych wyników dla nowego scope.
- Test importu odrzuca obce referencje, nadmiarowe pliki i wadliwe hashe; powtórny import tego samego snapshotu nie duplikuje danych.
- Import propozycji wymagań i planu przechodzi walidację manifestu: nieznana wersja, obce referencje baseline/AC, allowedPaths poza repo zadania i mapowanie AC na nieistniejący test są odrzucane, a powtórny import tego samego manifestu nie duplikuje wymagań ani zadań.

#### Manual Verification

- Agent tworzy i poprawia ekran Figmy podczas próby; operator komentuje wersję i zatwierdza nowy snapshot w OM.
- Operator przechodzi FROM_DESIGN z istniejącym ekranem i ręcznymi AC bez deklaracji automatycznej reverse specification.

**Implementation Note:** Implementacja aplikacji czeka na requirements approval i design approval przypisane do bieżącego baseline.

## Phase 4: React przez Cezara, review i poprawka

### Overview

H8–H24. Najpierw jedna kompletna próba task → result → evidence → review, potem dwa niezależne zadania. Integracja nie może zależeć od naprawy całego runtime OM.

### Changes Required

**Files:** `packages/delivery-cezar/{package.json,src/index.ts,src/runner.ts,src/resultManifest.ts}`, `delivery_agents/lib/{executionBridge,resultAcceptance}.ts`, `commands/executions.ts`, `workers/execute-task.ts`, `api/tasks/[id]/execute/route.ts`, `lib/attemptWorkflow.ts`, `workers/resume-attempt.ts`. Nie dodajemy publicznego callbacku HTTP.

**Intent:** Enterprise autoryzuje wykonanie, rozpoczyna istniejący workflow i przekazuje jedno ograniczone zadanie adapterowi CLI. Wynik trafia do komendy importu OSS, a następnie wznawia właściwy krok workflow.

**Contract:** Trwały workflow i istniejąca kolejka, bez trzymania HTTP przez czas wykonania. Provider nie dostaje ogólnego dostępu do DB. Przed spawn rezerwujemy attempt; niepewny restart wymaga uzgodnienia. W automatycznym demo worker działa na przygotowanym hoście z zalogowanym CLI, a nie na dowolnym zdalnym kliencie. Pełne leases/remote pull pozostają kontynuacją. Worker korzysta z wewnętrznej komendy odbioru; publiczny import ręczny pozostaje w uwierzytelnionym API OSS. Kontekst wykonania utrwala uprawnionego aktora i scope ustalone przez backend; worker ponownie sprawdza bieżące uprawnienia oraz stan próby przed efektem.

**Protokół wykonania i odzyskania (F1, decyzja użytkownika):** Jedna instancja istniejącego workflow na attempt, z krokiem oczekiwania na wynik. `workflowDefinitionAuthoring.upsertOwnedDefinition` materializuje definicję z właścicielem `delivery_agents`, stabilnym ownerId i jawnie zatwierdzonymi grants. `workflowExecutor.startWorkflow` sam nie wykonuje kroków: bridge wywołuje również `executeWorkflow`, a dopiero po potwierdzeniu zapisanego `WAIT_FOR_SIGNAL` dla właściwej próby zleca kolejkę CLI. `signalHandler.sendSignal` nie buforuje sygnału przed zaparkowaniem. Nie dodawać nowych activity types ani zmian silnika workflows.

Rejestr próby rozszerzyć o `workflowStepId`, `resultEvidenceId`, `completionDelivery: pending/delivered`, `lastDeliveryError` i znacznik zlecenia. Rezerwacja, utworzenie/powiązanie workflow, parkowanie i enqueue są osobnymi operacjami: retry uzgadnia zapisany stan i używa stabilnej korelacji attempt, nie tworzy nowej próby. Enqueue następuje przed oznaczeniem zlecenia jako wysłanego; powtórne enqueue jest bezpieczne dzięki warunkowemu claim. Awaria po claim i przed spawn oznacza niepewny start wymagający reconciliation, a nie automatyczne ponowienie CLI.

Worker po zakończeniu CLI wywołuje wewnętrzną komendę OSS, która atomowo zapisuje evidence i `completionDelivery=pending`. Dopiero potem bridge wysyła sygnał do przypiętego workflow/kroku i zapisuje delivered. Awaria między evidence a sygnałem wymaga retry samego dostarczenia; awaria po sygnale przed delivered wymaga sprawdzenia historii/kontekstu workflow z korelacją attempt/evidence. Sam terminalny status workflow nie dowodzi odebrania tego wyniku. Rozbieżność blokuje uzgodnienie zamiast ponawiać efekt. Równoczesne dostarczenia serializować dla próby. Anulowana próba nie wznawia procesu. Retry odbioru nigdy nie uruchamia CLI ponownie.

`workers/resume-attempt.ts` używa standardowej kolejki i retry platformy. Zapis pending jest trwałym źródłem prawdy: odzyskanie po restarcie i akcja reconcile skanują scoped pending i ponownie zlecają dostarczenie, również gdy awaria nastąpiła przed enqueue. Bez własnej pętli polling. Ręczny import dla automatycznej próby zapisuje ten sam pending; enterprise obsługuje `delivery_os.evidence.recorded`, a recovery pokrywa utratę zlecenia. Próba OSS-only nie ma workflowRef i nie wymaga sygnału. Określenie „callback” w zachowanych kryteriach Progress oznacza odtąd wewnętrzne dostarczenie wyniku, nie publiczny endpoint.

**Konfiguracja równoległości:** Readiness H0–H3 sprawdza Redis i `QUEUE_STRATEGY=async`. Lokalna strategia kolejki przetwarza sekwencyjnie i nie dowodzi dwóch równoległych runów. Nowy worker ma metadata `queue: delivery-execute`, własne id i `concurrency: 2`; uruchomienie: `yarn mercato queue worker delivery-execute --concurrency=2`. Zweryfikować efektywną współbieżność po ograniczeniu budżetem połączeń DB. Worker na przygotowanym hoście CLI używa tej samej bazy, kolejki i wygenerowanych rejestrów co OM; provider otrzymuje tylko pakiet i argumenty, bez dostępu do DB. Nie zmieniamy globalnych defaultów ani istniejących workerów. Standardowy worker wznowienia uruchomić osobno, aby długie CLI nie blokowało odbioru.

**Files:** `delivery_os/commands/evidence.ts`, `api/tasks/[id]/package/route.ts`, `api/tasks/[id]/results/route.ts`, `delivery_agents/lib/manualHandoff.ts`.

**Intent:** Zapewnić uzgodnioną ścieżkę awaryjną bez zmiany kontraktu wyniku. Operator eksportuje paczkę, uruchamia Cezara i importuje wynik przez uwierzytelnione UI.

**Additional files:** `delivery_os/commands/attempts.ts`, `api/tasks/[id]/attempts/route.ts`, `api/tasks/[id]/attempts/[attemptId]/{cancel,reconcile}/route.ts`, `components/AttemptActions.tsx`. Formularz pokazuje rezerwację przed eksportem oraz akcję uzgodnienia niepewnej próby. To implementacja opisanych wyżej kontraktów, również w wariancie OSS-only.

**Contract:** Ręczny tryb jest widoczny w zadaniu, timeline i raporcie. Import nie obchodzi approvalu, testów ani korelacji baseline/commit. Odbiór wyniku nie oznacza merge ani release. `/trace/ingest` i no-bypass orchestratora pozostają bez zmian.

**Files:** `hackathon/delivery-demo/workflows/`, `hackathon/delivery-demo/skills/{implement,review,verify-ac}.md`, walidacje i testy w docelowym repo React.

**Intent:** Osobne taski dla listy/filtrowania i formularza/potwierdzenia; wspólny kontrakt komponentów ustalić przed równoległością. Tester sprawdza AC, reviewer otrzymuje diff i wyniki deterministycznych kontroli.

**Contract:** Build/typecheck/test przed review. Reviewer może blokować za konkretne niespełnione AC, regresję lub security; kosmetyka jest advisory. Odrębny kontekst review, preferencyjnie drugi model. Co najmniej jeden test negatywny dowodzi, że kontrola wykrywa niespełnione AC. Poprawka dotyczy rzeczywistego findingu; kontrolowany fixture błędu jest dopuszczalny tylko z jawnym oznaczeniem na demo.

### Success Criteria

#### Automated Verification

- Testy rezerwacji i ponownego dostarczenia wywołują executor raz; duplikat wyniku nie duplikuje dowodów ani wznowienia workflow.
- Testy złego baseline/commit, obcego tenant, anulowanej próby i nieznanego stanu po restarcie blokują akceptację wyniku.
- Dwa niezależne runy mają nakładające się przedziały wykonania i odrębne worktree; zadanie zależne czeka na verified.
- React przechodzi build/typecheck/testy AC, a negatywny fixture wykazuje, że co najmniej jeden test faktycznie wykrywa błąd.
- Testy awarii przed parkowaniem, po zapisie evidence i po sygnale przed delivered potwierdzają odzyskanie bez ponownego startu CLI; równoczesny replay nie duplikuje efektu.

#### Manual Verification

- Review odrzuca konkretny wynik, agent poprawia kod, nowy commit przechodzi ponowną weryfikację; raport pokazuje oba podejścia.
- Operator widzi rzeczywisty tryb przekazania, brakujące usage i skutki pause/cancel bez obietnicy niepotwierdzonego zatrzymania procesu.

**Implementation Note:** Nie scalać niezależnych wyników przez bezwarunkowe nadpisanie. A/B sprawdzają konflikt i uruchamiają cały zestaw walidacji na commit integracyjnym.

Wyniki na commitach zadań pozostają historią; nie dziedziczą statusu PASS na commit integracyjny. D uruchamia na nim wszystkie wymagane testy AC i skany oraz zapisuje oddzielny raport integracyjny z mapowaniem do zadań. Zmiana kodu testów lub profilu wymaga review definicji testu i nowego hasha; nie wolno zastąpić testu zawsze przechodzącą atrapą. Raport odbioru wybiera dowody po finalnej rewizji, baseline i wersji profilu, a nie po ostatnim zielonym runie.

## Phase 5: Preview, raport i PoC platform

### Overview

H20–H28. Połączyć dowody z realnym URL i pokazać wymienność targetów bez wdrażania trzech nowych stosów.

### Changes Required

**Files:** `delivery_os/lib/{deliveryReport,targetProfiles}.ts`, `api/projects/[id]/report/route.ts`, `commands/decisions.ts`, `components/{EvidenceTable,DeliveryReport}.tsx`; profil publikacji w przygotowanym repo React.

**Intent:** Raport wylicza wynik każdego AC z dowodów; publikacja jest oddzielnym zatwierdzonym efektem CI/operatora, uruchamianym po review/testach. Końcowa akceptacja dotyczy zweryfikowanego preview.

**Additional files:** `delivery_os/api/projects/[id]/{evidence,deploy-decisions,release-decisions}/route.ts`, `commands/evidence.ts`. Publish permission i końcowy odbiór wskazują tę samą rewizję co raport integracyjny; zmiana rewizji unieważnia zastosowanie dawnych decyzji do nowego wydania.

**Contract:** Dowód deployment zawiera URL, środowisko, commit, identyfikator buildu, czas i status upload/verification. Release gate wymaga zgodności tego samego commit z raportem. Zewnętrzne narzędzie nie nadaje sobie approvalu. Cofnięcie wersji preview oznacza ponowne opublikowanie znanego artefaktu; nie obiecujemy rollbacku produkcyjnej bazy.

**Files:** `hackathon/delivery-demo/adapters/{open-mercato,wordpress}/`, fixture manifestów i testy ich normalizacji.

**Intent:** OM PoC eksportuje pakiet dla przygotowanego modułu/przykładu i importuje rzeczywisty wynik walidacji, pokazując brak zaszytego React w DTO. WP PoC wywołuje własny pakiet Studio z nowego orchestratora OM na nowej witrynie i odbiera świeży skorelowany manifest. Wymaga gotowych API OSS i podłączenia enterprise; niezależna próba lokalna nie zalicza tego kryterium.

**Contract:** PoC to działający export/import + walidacja schematu, nie sama karta platformy. Fixture nie zalicza AC. Własny provider mieści się w `packages/delivery-wordpress/`; nie buduje kolejki ani nie korzysta ze starego API/sesji/raportów. Przy braku zależnych modułów przekazać interfejs, testy i ograniczenia, bez deklarowania PoC.

Budżet WP: maksymalnie 6 h łącznie, z readiness, narzędziami, testami i przekazaniem. Nie jest obietnicą realizacji całego WP-M01…03. Źródła starego projektu są referencją historyczną, nie zależnością runtime. Publiczne upload/verify są osobnym zakresem; lokalna nowa witryna nie jest deploymentem.

### Success Criteria

#### Automated Verification

- Raport nie zalicza AC bez testu na właściwym commit/baseline, a brak security check lub preview verification blokuje końcową akceptację.
- React preview odpowiada i przechodzi smoke E2E; identyfikator wersji/buildu zgadza się z deployment evidence.
- OM i WP przechodzą contract test export/import; WP Partial/not_run nie jest mapowany na PASS, a nieważne preview nie jest oznaczane jako verified.

#### Manual Verification

- Operator przechodzi od wymagania do testu, commitu i URL, ogląda screenshoty oraz akceptuje albo odrzuca wydanie z uzasadnieniem.
- D pokazuje oba PoC; bonus WP E2E prezentuje wyłącznie po nowej weryfikacji działającego preview i w limicie 6 h.

**Implementation Note:** Approval wykonania/deploy i końcowy release approval są rozdzielone. Brak ręcznej akceptacji nie jest timeoutem pozwalającym na wydanie.

## Phase 6: Stabilizacja, odbiór i demonstracja

### Overview

H28–H36. Brak nowych funkcji. Naprawić błędy, przejść obie ścieżki, zebrać dowody i przećwiczyć prezentację.

### Changes Required

**Files:** `delivery_os/__integration__/TC-DELIVERY-*.spec.ts`, `delivery_agents/__integration__/TC-DELIVERY-EXEC-*.spec.ts`, testy pakietu Cezara; `hackathon/delivery-demo/{runbook,acceptance,evidence-index}.md`.

**Intent:** Dostarczyć odtwarzalny test systemu sterującego delivery oraz instrukcję demo, awarii i ręcznego importu. Fixture'y tworzone przez testy i sprzątane, bez zależności od danych demo.

**Contract:** Testy kontrolera używają deterministycznego fake executora; smoke z prawdziwym Cezarem/Figmą/preview jest osobnym dowodem. Runbook rozróżnia live, replay i fixture; nie przedstawia nagranego przebiegu jako bieżącego wykonania. Retencja na hackathon: zachować dowody do ręcznego cleanup po odbiorze, bez automatycznego kasowania; zatwierdzone snapshoty i raporty muszą pozostać osiągalne.

### Success Criteria

#### Automated Verification

- Pełny uporządkowany gate repo i nowe testy integracyjne przechodzą; wyniki, runner i commit są zapisane w evidence-index.
- Testy OSS-only, cross-tenant, stale approval, duplikat callbacku, restart oraz manual_handoff przechodzą na finalnym commit.
- Wszystkie obowiązkowe AC demo mają dowód z końcowego commitu; nieznane wyniki i błędy nie są ukryte w sumarycznym PASS.

#### Manual Verification

- Próba obu wejść kończy się zatwierdzonym baseline; główny React przebieg kończy się preview, poprawką i raportem, a agent tworzy design podczas próby.
- Cztery osoby znają swoje role, ścieżkę awaryjną i ograniczenia; odbierający zapisuje końcowy verdict oraz niewykonane elementy dalszej roadmapy.

**Implementation Note:** Wdrożenie uznać za zakończone dopiero po odbiorze manualnym. Nie zaznaczać automatycznie manualnych pozycji Progress.

## Testing Strategy

### Testy jednostkowe i kontraktowe

Zod v1 i nieznana wersja, hash baseline, traceability/AC, status agregowany, DAG, reguły approvalu, idempotencja startu/importu, redakcja logów i normalizacja zewnętrznych wyników. Nie testować kopii implementacji; testy mają wykazać różnicę między błędnym a poprawnym wynikiem.

### Integration coverage — wymagane w tej samej zmianie

Wszystkie poniższe ścieżki są planowanymi nowymi API. Identyfikatory testów zostają w nowych modułach; nazwy plików i eksport `openApi` dostosować do obecnego routera.

| API lub flow | Weryfikacja |
|---|---|
| `/api/delivery_os/projects` GET/POST, `/projects/:id` GET/PUT/DELETE | CRUD, input, tenant/org, ACL, updatedAt, stale update/delete 409; blokada archiwizacji przy active attempt i zachowanie historycznych dowodów. |
| `/projects/:id/baselines` GET/POST | Oba wejścia, niezmienność snapshotu, attachments scope, brak wymaganych AC/renderu; odrzucenie propozycji wymagań o nieznanej wersji lub obcej referencji i brak duplikacji przy powtórnym imporcie. |
| `/baselines/:id/decisions` POST | Rola zatwierdzająca przez feature, hash/version, podwójna decyzja, brak autoryzacji i stale baseline. |
| `/projects/:id/tasks` GET/POST i `/tasks/:id` GET/PUT/DELETE | Zależności, cykl, obcy projekt, optimistic lock, verified tylko z dowodami; import propozycji planu waliduje allowedPaths oraz mapowanie AC na wymagane testy. |
| `/tasks/:id/package` GET, `/tasks/:id/results` POST | Export/import, ACL, rozmiary, schemaVersion, duplicate/conflict, hash/commit/attempt, source manual. |
| `/tasks/:id/attempts` POST, `/tasks/:id/attempts/:attemptId/{cancel,reconcile}` POST | Rezerwacja przed GET package, retry klucza startu, brak mutacji GET, OSS-only, cancel/reconcile z ACL, unknown blokuje retry, completed nie omija review. |
| `/projects/:id/evidence` POST, `/projects/:id/deploy-decisions` POST | Review/test/deployment discriminator, zgodność rewizji i mapowania AC, odrzucenie fałszywych hashów; deployment wymaga właściwej zgody przed publikacją. |
| `/projects/:id/report` GET, `/projects/:id/release-decisions` POST | Traceability, niepełne dowody, deployment SHA, odmowa release na FAIL/not_run. |
| Enterprise `/api/delivery_agents/tasks/:id/execute` POST i wewnętrzny odbiór workera | Autoryzacja i scope, jedna próba, parkowanie przed enqueue, brak zaufania do tenant z manifestu, retry dostarczenia i wznowienie właściwego workflow bez publicznego callbacku. |
| Enterprise pause/cancel w workflow + projekcja | Brak nowego dispatch, spóźniony wynik odrzucony, stop_unconfirmed i recovery po restarcie. |
| UI intake → design review → baseline | FROM_BRIEF i FROM_DESIGN, komentarz do wersji, klawiatura dialogów, błędy i loading. |
| UI task → evidence → preview → release | Pochodzenie wyników, rzeczywista correction loop, konflikt akceptacji, manual handoff. |
| OSS bez enterprise | Start aplikacji i pełna ręczna domena bez importów/licencji enterprise. |

W testach izolacji tworzyć dwa tenant/org, sprawdzać list/detail/mutacje/załączniki/export/result. Nie wystarczy test filtrowania listy. Weryfikacja scenariusza React obejmuje filtrowanie, brak wyników, walidację formularza, poprawne potwierdzenie i użycie klawiatury; viewport desktop/mobile. Security minimum: skan sekretów i zależności oraz brak otwartych istotnych findingów; modelowa opinia nie zastępuje tych kontroli. Niedostępny skaner daje not_run i blokuje deklarację security PASS.

Polityka security demo: wykryty sekret oraz otwarty finding critical/high blokują publikację i akceptację. Medium/low pozostają w raporcie i wymagają jawnego rozstrzygnięcia odbierającego, bez automatycznego wyciszania. Profil walidacji przypina konkretne dostępne narzędzia i ich komendy podczas fazy 1; komunikat „skan zalecany” nie jest dowodem jego wykonania.

### Komendy i runner

Przed sekwencją wybrać raz Docker/local według `.ai/docs/agent-instructions.md`. Przy działającym compose app użyć `node scripts/docker-exec.mjs X` zamiast `yarn X`. Zanotować runner i plik compose. Nie stosować poleceń OM do repo aplikacji React/WP; każde ma własny profil walidacji.

Pełny gate OM, dokładnie według `.ai/agentic.config.json` w chwili planowania:

```bash
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```

Ponadto uruchomić lint zmienionego zakresu zgodnie z pakietem i nowe integracje: `yarn test:integration --grep 'TC-DELIVERY'` po oznaczeniu tytułów nowych testów tym prefiksem. Testy etapów uruchamiać wcześniej, aby H28 nie było pierwszym wykryciem błędu. Czas pełnego gate zmierzyć w fazie 1, rozpocząć finalną sekwencję najpóźniej H28; jeśli nie zdąży, raportować nieukończoną walidację zamiast PASS.

Po zmianach discovery uruchomić `yarn generate`. Generować migracje i przejrzeć SQL/snapshot, nie aplikować `yarn db:migrate` bez odrębnej zgody. Istniejący schemat bazy nie jest traktowany jako gotowy dla nowych tabel. Konfiguracja środowiska/migracji jest warunkiem startu prób integracyjnych.

WordPress: uruchamiać walidację własnego pakietu i testy opisane w dokumencie [plan narzędzi Studio](../wordpress-studio-tools/plan.md). Live smoke tworzy wyłącznie nową witrynę bez wywołań starego serwera; nie uruchamiać skryptów starego projektu ani publicznego uploadu jako testu jednostkowego.

## Performance Considerations

Budżet demo: jeden aktywny projekt na stanowisko wykonawcze, do dwóch runów Cezara równocześnie, do 8 AC i 6 zadań na scenariusz. API przyjmuje maksymalnie 100 elementów strony; raport jednej wersji pobiera relacje batchowo. Context package ma jawny manifest plików/AC i limit rozmiaru, bez budowy retrieval. Screenshoty są załącznikami, nie base64 w rekordzie projektu ani w każdym powtórzeniu promptu.

Live status korzysta z istniejącego SSE zdarzeń, z odświeżeniem po reconnect; prawda pozostaje w backendzie. Timeout CLI to granica operacyjna, nie gwarantowana granica kosztu subskrypcji. Żadne pomiary wydajności ani gwarancje SLA nie wynikają z samego planu.

## Migration & Backward Compatibility

Nowe moduły i tabele są addytywne. Istniejących runtime enumów, auth/HMAC, workflow activity types, DS i API nie zmieniamy. Reuse istniejących komend/aktywności/bridge przez DI, bez bezpośredniego wywoływania runnerów. Regułę braku cross-module ORM stosować także na granicy dwóch nowych modułów.

Rejestrację modułów wykonać wspieranym mechanizmem konfiguracji/generacji; nie dodawać ręcznie generowanych plików ani kodu bezpośrednio do `apps/mercato/src`. Specyfikacje implementacyjne mają zawierać checklistę aktywacji OSS i enterprise oraz odpowiednie migracje. Wyłączenie enterprise pozostawia projekty i dowody czytelne. Wycofanie demo polega na wyłączeniu rozszerzenia wykonania i zachowaniu historii, nie na usuwaniu tabel.

Jeżeli przyszły etap wymaga nowego publicznego kontraktu lub zmiany istniejącego, podlega osobnej specyfikacji i procedurze backward compatibility. Plan hackathonu nie upoważnia do migracji danych użytkownika, publikacji produkcyjnej, nowych opłat ani przenoszenia kodu enterprise do OSS.

## Dalsze etapy — bez zobowiązania terminowego

1. Produkcyjny dispatch: zgodność z istniejącą roadmapą AgentTask/binding/lease, jawny remote auth, heartbeats, reconciliation, trwałe cancellation i testy awarii. Przenieść jednorazowy bridge za docelowy kontrakt, nie dodawać konkurencyjnego scheduler’a.
2. Rozdzielić JSON baseline na osobne encje tylko przy potrzebie niezależnej edycji/skali; zachować ID AC i migrację historycznych dowodów. Rozbudować change requests, retencję, kopie i uprawnienia klientów.
3. Utrwalić automatyczne integracje Figma/WP w dedykowanych pakietach, pełne OM/WP E2E, provisioning i zarządzanie sekretami. Nie kopiować prywatnego runtime lokalnego narzędzia do usługi publicznej.
4. Produkcyjny release, rollback, odpowiedzialność operacyjna, incident response i monitoring. Osobno uzgodnić finansowanie API oraz pomiar i egzekwowanie budżetów.

## Risks & Assumptions

| Ryzyko | Zabezpieczenie | Pozostający warunek |
|---|---|---|
| 36 h nie wystarczy | 87 h planowanej pracy, 6 h WP, freeze H28, mały scenariusz | Nowy kod OM wymaga pełnych konwencji i gate; deadline nie uzasadnia ich pomijania. |
| Figma niedostępna w CLI | Rzeczywisty test MCP write/read na docelowym koncie w H0–H3 | Bez tego FROM_BRIEF nie jest wykonane; nie ma zatwierdzonego fallbacku na ręczny design. |
| Cezar inna wersja/format | Pin sprawdzonej wersji, wrapper i wspólny manifest | Manual_handoff jest zatwierdzonym fallbackiem, nie niejawnie udawaną automatyzacją. |
| Limity kont | Osobne autoryzowane sesje, ograniczone iteracje/czas | Nie zakładać ilości tokenów ani dostępności po samym nazwaniu planu. |
| AI ocenia AI | Host checks, negatywne testy AC, niezależny kontekst review, człowiek | LLM review nadal nie jest dowodem poprawności. |
| Powtórzenie efektu | Rezerwacja przed spawn, idempotentny import, jawne recovery | Zewnętrzne CLI nie zapewnia exactly-once. |
| Własne narzędzia WP przekraczają budżet | 6 h łącznie; zakończyć udokumentowanym stanem i przekazaniem | Narzędzia nie gwarantują gotowości zależnego PoC ani preview. |
| Przeciek danych/kodu | Tenant/org, scoped attachments, trusted demo repo, bez publicznego WP API | Hackathon nie udowadnia izolacji systemowej wykonywania kodu klientów. |

Nie pozostają nierozstrzygnięte wybory produktowe. Readiness środowiska jest bramką z określonym wynikiem i działaniem przy błędzie, a nie obietnicą, że integracje zostały już wykonane.

## References

- [Spec źródłowy](../../../hackathon/open-mercato-autonomous-software-delivery-spec.md), szczególnie §37, §47–50.
- [Analiza ryzyk](../../../hackathon/analiza-ryzyk-autonomous-software-delivery.md), R-01–R-41; [korekty i decyzje](research.md).
- `packages/core/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md` — obowiązkowe przed implementacją odpowiednich powierzchni.
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`, `packages/core/src/modules/workflows/AGENTS.md`, `packages/queue/AGENTS.md` — przed implementacją wykonania.
- `.ai/qa/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/agentic.config.json`, `.ai/docs/agent-instructions.md`.
- `.ai/specs/enterprise/agent-orchestrator/next/2026-06-19-agent-dispatch.md` — docelowy dispatch, nie gotowy komponent hackathonu.
- [Cezar README](https://github.com/open-mercato/cezar) — headless CLI i własne loginy, sprawdzone 2026-09-18.
- [Figma write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/), [dostęp i limity](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/) — sprawdzone 2026-09-18.
- `/var/www/html/ai-tools/ai-wordpress-orchestrator/{AGENTS.md,docs/orchestration-evidence.md,docs/studio-preview.md,src/server/app.js}` — historyczne źródła referencyjne (**superseded**: integracja z ich runtime/API).

## Progress

> Konwencja: `- [ ]` oczekuje, `- [x]` wykonane. Po wdrożeniu dopisz ` — <commit sha>`. Nie zmieniaj tytułów kroków. Manualne kryteria zaznacza się dopiero po odbiorze człowieka.

### Phase 1: Próby integracji i zamrożenie scenariusza

#### Automated

- [ ] 1.1 Readiness zawiera wersje, tryb Cezara, wybrany target preview oraz zapis exit code rzeczywistej próby CLI; dane sekretne są wykluczone.
- [ ] 1.2 Agent utworzył frame w Figmie i zwrócił jego ID; odczyt tego ID i renderu potwierdza istnienie wyniku.
- [ ] 1.3 Bazowa aplikacja React przechodzi build i test przykładowego AC na docelowym stanowisku.
- [ ] 1.6 Readiness dowodzi gotowości kolejki do dwóch równoległych wykonań: zapisany `QUEUE_STRATEGY=async`, osiągalny Redis oraz zalogowany plan budżetu połączeń z efektywną współbieżnością nie mniejszą niż 2 dla jednej kolejki; strategia lokalna jest zapisana jako blocker równoległości, nie jako wynik pozytywny.

#### Manual

- [ ] 1.4 Zespół ogląda utworzony przez agenta ekran, potwierdza login/Full seat i prawa edycji oraz rozumie automatyczny lub ręczny tryb Cezara.
- [ ] 1.5 D potwierdza wykonalność WP reuse lub zapisuje blocker i wybiera PoC importu, bez przekraczania timeboxu.

### Phase 2: Fundament OSS i kontrakt enterprise

> Współodbiór 2.3 i 2.4: OSS-02, EXEC-02, UI-02, QA-02. Dowody UI-02 — zakres dostarczony, zakres
> pominięty, luki pokrycia i dwa warunkowe kryteria — w [workstreams/ui-02/handoff.md](workstreams/ui-02/handoff.md).
> Status zaznacza jedna wyznaczona osoba po dowodach od wszystkich czterech stron; żaden strumień nie zalicza ich sam.

#### Automated

- [ ] 2.1 Testy DTO, cykli zależności i statusu projektu przechodzą; nieznana wersja manifestu jest odrzucana.
- [ ] 2.2 Testy API potwierdzają izolację tenant/org, ACL i konflikty updatedAt dla projektów/zadań/decyzji zależnych od wersji.
- [ ] 2.3 Build i smoke OSS-only przechodzą bez enterprise; z enterprise pojawia się rozszerzenie bez zmiany kontraktu OSS.

#### Manual

- [ ] 2.4 Operator tworzy projekt, wpisuje wymagania i dwa zależne zadania, eksportuje pakiet i widzi zrozumiały stan przy braku enterprise.

### Phase 3: Dwa wejścia, Figma i baseline

#### Automated

- [ ] 3.1 Oba wejścia zapisują ten sam schemat baseline; bez AC, renderu lub wymaganych decyzji nie można ustawić zadania ready.
- [ ] 3.2 Test zmiany baseline potwierdza niezmienność wersji zatwierdzonej i odrzucenie jej spóźnionych wyników dla nowego scope.
- [ ] 3.3 Test importu odrzuca obce referencje, nadmiarowe pliki i wadliwe hashe; powtórny import tego samego snapshotu nie duplikuje danych.
- [ ] 3.6 Import propozycji wymagań i planu przechodzi walidację manifestu: nieznana wersja, obce referencje baseline/AC, allowedPaths poza repo zadania i mapowanie AC na nieistniejący test są odrzucane, a powtórny import tego samego manifestu nie duplikuje wymagań ani zadań.

#### Manual

- [ ] 3.4 Agent tworzy i poprawia ekran Figmy podczas próby; operator komentuje wersję i zatwierdza nowy snapshot w OM.
- [ ] 3.5 Operator przechodzi FROM_DESIGN z istniejącym ekranem i ręcznymi AC bez deklaracji automatycznej reverse specification.

### Phase 4: React przez Cezara, review i poprawka

#### Automated

- [ ] 4.1 Testy rezerwacji i ponownego dostarczenia wywołują executor raz; duplikat wyniku nie duplikuje dowodów ani wznowienia workflow.
- [ ] 4.2 Testy złego baseline/commit, obcego tenant, anulowanej próby i nieznanego stanu po restarcie blokują akceptację wyniku.
- [ ] 4.3 Dwa niezależne runy mają nakładające się przedziały wykonania i odrębne worktree; zadanie zależne czeka na verified.
- [ ] 4.4 React przechodzi build/typecheck/testy AC, a negatywny fixture wykazuje, że co najmniej jeden test faktycznie wykrywa błąd.
- [ ] 4.7 Testy awarii przed parkowaniem, po zapisie evidence i po sygnale przed delivered potwierdzają odzyskanie bez ponownego startu CLI; równoczesny replay nie duplikuje efektu.

#### Manual

- [ ] 4.5 Review odrzuca konkretny wynik, agent poprawia kod, nowy commit przechodzi ponowną weryfikację; raport pokazuje oba podejścia.
- [ ] 4.6 Operator widzi rzeczywisty tryb przekazania, brakujące usage i skutki pause/cancel bez obietnicy niepotwierdzonego zatrzymania procesu.

### Phase 5: Preview, raport i PoC platform

#### Automated

- [ ] 5.1 Raport nie zalicza AC bez testu na właściwym commit/baseline, a brak security check lub preview verification blokuje końcową akceptację.
- [ ] 5.2 React preview odpowiada i przechodzi smoke E2E; identyfikator wersji/buildu zgadza się z deployment evidence.
- [ ] 5.3 OM i WP przechodzą contract test export/import; WP Partial/not_run nie jest mapowany na PASS, a nieważne preview nie jest oznaczane jako verified.

#### Manual

- [ ] 5.4 Operator przechodzi od wymagania do testu, commitu i URL, ogląda screenshoty oraz akceptuje albo odrzuca wydanie z uzasadnieniem.
- [ ] 5.5 D pokazuje oba PoC; bonus WP E2E prezentuje wyłącznie po nowej weryfikacji działającego preview i w limicie 6 h.

### Phase 6: Stabilizacja, odbiór i demonstracja

#### Automated

- [ ] 6.1 Pełny uporządkowany gate repo i nowe testy integracyjne przechodzą; wyniki, runner i commit są zapisane w evidence-index.
- [ ] 6.2 Testy OSS-only, cross-tenant, stale approval, duplikat callbacku, restart oraz manual_handoff przechodzą na finalnym commit.
- [ ] 6.3 Wszystkie obowiązkowe AC demo mają dowód z końcowego commitu; nieznane wyniki i błędy nie są ukryte w sumarycznym PASS.

#### Manual

- [ ] 6.4 Próba obu wejść kończy się zatwierdzonym baseline; główny React przebieg kończy się preview, poprawką i raportem, a agent tworzy design podczas próby.
- [ ] 6.5 Cztery osoby znają swoje role, ścieżkę awaryjną i ograniczenia; odbierający zapisuje końcowy verdict oraz niewykonane elementy dalszej roadmapy.
