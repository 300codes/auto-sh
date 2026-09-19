# QA-04 — przygotowane scenariusze recovery

Status: scenariusze określone; historyczne testy reguł unit/mock wykonane, live recovery niewykonane. Przegląd bieżących źródeł z 2026-09-19 potwierdza execute/cancel API, `executionBridge`, workery execute/resume/pending-scan/uncertain-reconciliation i rejestrację harmonogramów w `delivery_agents`. Ich obecność nie dowodzi poprawnego restartu. Historyczne dowody dotyczą zapisanych w nich rewizji; poniższy przegląd nie uruchamiał usług ani testów live.

## Wspólna paczka dowodów

Każda próba: caseId, suiteRunId, code/app revision, taskPackage hash, scope,
project/task/attempt/baseline/hash, workflow/step/run references jeśli istnieją,
sourceRevision, tryb fixture/live, checkpoint przed awarią i po recovery,
liczniki spawn/result-evidence/effective-resume, surowe logi i ich sha256,
znaczniki czasu oraz rezultat cleanup. Nie utożsamiać liczby prób dostarczenia
sygnału z liczbą skutecznych wznowień/efektów.

| ID | Przygotowanie i trigger | Oczekiwanie / asercja | Dowód live wymagany później |
|---|---|---|---|
| REC-01 | Rezerwacja, przerwanie przed potwierdzonym WAIT_FOR_SIGNAL | Brak enqueue i spawn przed parkowaniem | Trwały stan workflow i kolejki, spawn count=0 |
| REC-02 | Claim zapisany, proces przerwany w nieznanym momencie spawn | Reconciliation required; retry nie startuje CLI ponownie; unknown blokuje nowy attempt | Stan DB po restarcie, proces/run probe, log odmowy spawn |
| REC-03 | Evidence i pending utrwalone, błąd przed signal | Ten sam evidenceId; ponowienie delivery, nie pracy wykonawcy | Restart workera, evidence count=1, spawn count=1, final delivered |
| REC-04 | Signal dostarczony, crash przed delivered | Ponowny signal nie powiela efektu downstream; final delivered | Trace workflow + licznik skutecznego resume=1 |
| REC-05 | Dwa równoczesne replay tego samego wyniku | Jedno evidence, spójne odpowiedzi; brak drugiego wykonania | Obie odpowiedzi, scoped SELECT/count; live resume osobno |
| REC-06 | Cancel przed claim oraz po claim | Brak nowych dispatchy, stop_unconfirmed do potwierdzenia; late result odrzucony | Probe procesu, cancel/reconcile evidence; nie zabijać obcych runów |
| REC-07 | Reconcile unknown/stopped/not_started/completed | Unknown blokuje start/archive, potwierdzone zakończenie umożliwia właściwy dalszy krok, completed nie daje verified | Każda gałąź i faktyczne źródło potwierdzenia |
| REC-08 | Dwa niezależne ready tasks, osobne worktree | Rzeczywiste nakładanie przedziałów; brak współdzielenia worktree; zależny task czeka | Async/Redis, efektywna concurrency≥2, start/end obu runów, ścieżki worktree bez sekretów |
| REC-09 | Dwa starty jednego task w tym samym czasie | Jedna aktywna próba i jeden spawn | Dwie odpowiedzi, attempt registry, spawn count |
| REC-10 | Po review poprawka i nowa finalna rewizja | Ponowny pełny zatwierdzony zestaw AC; stary PASS nie przenosi się | Hash definicji/raportów, final revision, negatywny fixture wykryty |

## Wykonalne bez Cezara na bieżących źródłach

Komendy wykonać z katalogu repo przygotowanego runnera QA, z jego zainstalowanymi zależnościami, po ustawieniu `BASE_URL` na istniejącą aplikację i `DATABASE_URL` na jej bazę. Nie inicjalizują środowiska ani migracji. Sufiks `.qa-regression.spec.ts` jest celowy: discovery rozpoznaje wszystkie pliki kończące się `.spec.ts`.

```bash
yarn test:integration 'TC-DELIVERY-006.qa-regression.spec.ts' --grep 'concurrent identical results' --retries=0
yarn test:integration 'TC-DELIVERY-007.qa-regression.spec.ts' --retries=0
yarn test:integration 'TC-DELIVERY-008.qa-regression.spec.ts' 'TC-DELIVERY-010.spec.ts' --retries=0
```

| Zakres | Rzeczywisty test | Co udowadnia, a czego nie |
|---|---|---|
| REC-05 | `concurrent identical results create one evidence; a changed replay conflicts` (006.qa-regression) | Równoczesny import HTTP i licznik evidence; bez sygnału workflow ani spawn |
| REC-06/07 | `cancel`, `unknown`, `stopped`, `completed preserves the execution and review gates` (007.qa-regression) | Cztery warianty HTTP; cancel/unknown kończą również przez `not_started`; unknown blokuje reserve/archive, completed daje awaiting_review; fixture nigdy nie była dispatchowana |
| REC-10 / phase 4 | `cannot approve ${scenario} evidence`, `exhausted correction budget blocks another execution` (008.qa-regression); `keeps correction history and reviews the new result`, `only reviewed proof unlocks the dependent task` (010) | Reguły dowodów i nowej próby, zależności i historia review; nie wykonuje testów finalnej aplikacji ani negatywnej zmiany jej kodu |

Phase 4 ma historyczny manifest [verification-current.json](evidence/verification-current.json) oraz [review](reviews/impl-review-phase-4.md). Nie przypisywać jego PASS nowym plikom o tych samych numerach: zachowane suite przeniesiono pod `.qa-regression.spec.ts`. Dla bieżącego runtime wymagany jest ponowny wynik i zgodność manifestu źródeł. 007.qa-regression nadal ma jawny `not_run/environment` przy niedostępnych licznikach DB; skip nie zalicza recovery.

Możliwy jest również test enterprise bez uruchamiania wykonawcy, ale tylko na dedykowanym środowisku z aktywnymi `delivery_agents`, `delivery_os`, przygotowanym workflow i zatrzymanym konsumentem kolejki `delivery-execute`:

```bash
OM_ENABLE_ENTERPRISE_MODULES=1 yarn test:integration 'TC-DELIVERY-EXEC-006.spec.ts' --retries=0
```

Samo ustawienie zmiennej na procesie Playwright nie aktywuje modułów serwera. EXEC006 ma trzy rzeczywiste przypadki: `two simultaneous execute calls with different idempotency keys: exactly one wins`, `re-execution after cancel: two concurrent execute calls again produce one winner`, `same idempotencyKey replays the existing attempt`. Sprawdza 202/409 i trwały rejestr prób (REC-09), cancel/reconcile oraz replay. Nie sprawdza spawn count; cleanup usuwa projekt bez własnego cleanup workflow i zakolejkowanych jobów, więc wymaga odrębnego teardown środowiska. Nie uruchamiać później jego pozostawionych jobów przeciw usuniętym fixtures.

Testy bez HTTP, z atrapami:

```bash
yarn workspace @open-mercato/core test --runInBand --runTestsByPath src/modules/delivery_os/commands/__tests__/executorFlow.test.ts src/modules/delivery_os/commands/__tests__/reconcile.test.ts src/modules/delivery_os/lib/__tests__/acProof.test.ts
yarn workspace @open-mercato/enterprise test --runInBand --runTestsByPath src/modules/delivery_agents/lib/__tests__/executionIntegration.test.ts
```

`executionIntegration.test.ts` pokrywa `unwraps reservation and enqueues only the correctly scoped parked workflow`, `reuses the domain reservation without creating another workflow or job`, `does not enqueue when initial workflow execution fails` i `does not enqueue when the scoped park lookup fails` (REC-01, wyłącznie mock). `executorFlow.test.ts` pokrywa replay, failed delivery i brak ponownego wykonania w modelu OSS. Żaden z tych testów nie uruchamia prawdziwego handlera workera po restarcie.

## Konkretne luki i warunki live

| Case | Istniejący mechanizm | Bloker / ryzyko z odczytu kodu, do odtworzenia |
|---|---|---|
| REC-01 | Bridge sprawdza PAUSED + `wait_for_evidence` przed enqueue | Brak kontrolowanego failpoint/restart testu. Rezerwacja pozostaje po błędzie parkowania, a replay rezerwacji wraca bez ponownego tworzenia workflow/enqueue; trzeba wykazać drogę odzyskania tej próby |
| REC-02 | Scanner oznacza jako unknown próby claimed starsze niż 30 min; harmonogram co 10 min | `execute-task.ts` ignoruje wynik claim. `claimAttempt` dopuszcza ten sam workerRef jako `alreadyClaimed`; retry tego samego job.id może ponownie dojść do `taskExecutor.run`. Potrzebna reprodukcja z licznikiem spawn i kontrolowanym przerwaniem; sam model OSS tego nie wyklucza |
| REC-03 | Persistent subscriber enqueue resume; pending scanner co 5 min | Brak testu crash między evidence i sygnałem na rzeczywistym workerze, trwałej kolejce oraz liczników. Harmonogramy są rejestrowane tylko przy dostępnej usłudze scheduler podczas seedDefaults |
| REC-04 | Resume worker próbuje sygnał trzykrotnie, potem mark_delivery | `sendSignalByCorrelationKey` szuka wyłącznie workflow PAUSED; po wcześniejszym skutecznym resume kolejny sygnał może zwrócić 0. Worker traktuje 0 jako niepowodzenie, bez potwierdzenia już ukończonego wznowienia. Crash przed mark_delivery wymaga testu i właściwego potwierdzenia stanu |
| REC-06 | Cancel zapisuje żądanie; execute worker sprawdza stan dopiero po `executor.run` | Nie ma tu przerwania procesu w trakcie run ani testu kontrolowanego stopu. Potrzebny probe własnego procesu; odpowiedź cancel nie jest dowodem zakończenia |
| REC-08 | Concurrency execute domyślnie 2 | Brak testu mierzącego dwa rzeczywiste nakładające się runy i osobne worktree. Wymagane trwała kolejka, własny kontrolowany executor, pomiary start/end i zależny task |
| REC-10 | HTTP reguły i proof checks z phase 4 | Brakuje uruchomienia pełnego zestawu AC na finalnej aplikacji oraz rzeczywistego negatywnego fixture na tej rewizji |

Punkty do kontrolowanej reprodukcji (numery linii z przeglądu, bez dowodu live):

- **REC-02:** `packages/enterprise/src/modules/delivery_agents/workers/execute-task.ts:67–89` wywołuje claim z workerRef opartym o job.id, a następnie run; `packages/core/src/modules/delivery_os/lib/attempts.ts:239` zwraca sukces dla tego samego workerRef. W izolowanej kolejce przerwać własny worker po pierwszym spawn, przed acceptResult, pozostawiając próbę claimed. Wznowić ten sam job.id, rejestrując rzeczywiste wywołania spawn oraz stan próby. Wymaganie: delta-spawn=0 i skierowanie niepewnego wykonania do reconcile; obecna ścieżka źródłowa tego nie gwarantuje. Nie dopisywać claimed w DB i nie nazywać tego restartem.
- **REC-04:** `packages/enterprise/src/modules/delivery_agents/workers/resume-attempt.ts:65,117,143` wymaga count>0 przed oznaczeniem delivered; `packages/core/src/modules/workflows/lib/signal-handler.ts:471` filtruje PAUSED. W izolowanym workerze zatrzymać wykonanie po skutecznym sygnale (workflow wyszedł z oczekiwania), przed mark_delivery. Odtworzyć ten sam resume job; zebrać status workflow, completionDelivery i licznik skutecznych wznowień. Wymaganie: delivered i effective-resume=1, także gdy ponowny signal odpowiada 0. Obecne testy metadanych/retry nie sprawdzają tej granicy.

`TC-DELIVERY-EXEC-001/003/004` nie zastępują tych dowodów: używają stałych nieutworzonych task IDs, dopuszczają odpowiedzi błędów lub pomijają ścieżkę. EXEC002 testuje fake executor/eksporty, EXEC005 metadane i enqueue, bez awarii rzeczywistego handlera. EXEC006 zaostrza HTTP, ale nie jest recovery procesu.

Fake executor nie jest automatycznie dostępny w produkcyjnym runtime: `di.ts` wybiera go tylko gdy `NODE_ENV !== 'production'` i `DELIVERY_EXECUTOR !== 'cezar'`. `DELIVERY_EXECUTOR=fake` w produkcyjnym buildzie nadal wybiera Cezara. Uruchomienie fake workerów wymaga jawnie odpowiedniego środowiska testowego; nie drenować `delivery-execute` w produkcyjnym trybie licząc na fake.

## Bezpieczeństwo wykonania

Awarię wstrzykiwać wyłącznie we własny testowy worker/workflow, po zapewnieniu
kontrolowanego shutdown i identyfikacji procesu. Nie emulować live przez edycję DB.
Brak adaptera, Redis lub możliwości kontrolowanego restartu oznacza not_run/dependency.
Cała paczka musi pozostać w macierzy odbioru; skip nie usuwa obowiązku dostarczenia dowodu.

## Weryfikacja reguł i pomiary live

[Focused unit gate](evidence/phase-5/focused-unit.json): 3 suites, 44/44 PASS
w izolowanym Dockerze z bieżącymi zależnościami. To testy z atrapami; nie wykonano
restartu workera, sygnału do realnego workflow ani dwóch procesów. Live: not_run/dependency.

| Case | Trwały checkpoint po wznowieniu | Liczniki wymagane w trace live | Warunek uruchomienia |
|---|---|---|---|
| REC-01 | Brak enqueue przed zapisanym park | spawn=0, evidence=0, effective-resume=0 | EXEC + trwały WAIT_FOR_SIGNAL |
| REC-02 | Claim zachowany, uncertainty/reconcile bez nowego startu | spawn nieznany do probe, przy retry delta-spawn=0; evidence/resume według odczytu | EXEC + bezpieczny probe procesu |
| REC-03 | To samo evidence, pending→delivered | evidence=1, delta-spawn=0, effective-resume=1 | Worker i trwały signal |
| REC-04 | Delivered lub bezpieczne ponowienie tego samego sygnału | evidence=1, effective-resume=1, delta-spawn=0 | Workflow z deduplikacją sygnałów |
| REC-05 | Jedno evidence tego samego attempt/hash | evidence=1, effective-resume≤1, delta-spawn=0 | HTTP/DB dostępne; resume wymaga EXEC |
| REC-06 | Cancel request zachowany do potwierdzonego reconcile | evidence late-result=0, nowe spawn po cancel=0; istniejący proces wymaga probe | Własny wykonawca i cancel hook |
| REC-07 | Unknown blokuje; closed lub result_received po dowodzie | delta-spawn=0; evidence=1 tylko completed; resume wymaga trace | HTTP dla domeny; live źródło external evidence |
| REC-08 | Dwa osobne run/attempt/worktree | dwa spawn, dwa evidence, jedno effective-resume na run; przecięcie przedziałów >0 | Async/Redis i concurrency≥2 |
| REC-09 | Jeden aktywny attempt na task | attempt=1, spawn=1, evidence≤1, effective-resume≤1 | HTTP reserve; spawn wymaga EXEC |
| REC-10 | Nowy wynik na final revision, stare dowody nie przeniesione | evidence per revision, aktualny komplet AC i negatywny fixture failed; spawn/resume mierzone osobno | Gotowy wynik aplikacji i realne profile checks |

Wartości powyżej są oczekiwaniami, nie zebranymi pomiarami. `unknown` nigdy nie
jest zamieniane na zero. Dla każdego case utrwalać checkpoint przed i po awarii,
request IDs, korelację i hashe surowych raportów według wspólnej paczki dowodów.
Nowe oczekiwanie procesu FLOW-05/09 rozszerza live o restart podczas oczekiwania
na zgodę i unieważnianie downstream; wymagane kontrakty F0 są w [flow-steering.md](flow-steering.md).
