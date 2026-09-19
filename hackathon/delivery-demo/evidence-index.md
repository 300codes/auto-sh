# Indeks dowodów delivery

Data: 2026-09-19. **Historyczny wynik: 49/49 wymaganych wykonań HTTP**, 47 unikalnych przypadków:
4 wykonania fixture (2 testy × 2) oraz 45 przypadków API/OSS. Wynik faz 2–4 składa się
z 38 niezmienionych przypadków pełnego przebiegu i 7 przypadków celowanego retestu
TC001/TC008. Pierwszy pełny przebieg miał 43 PASS / 2 FAIL; to nie jest jeden
bezbłędny pierwszy run. Historia błędów testowych pozostaje zachowana.

**Najnowszy checkpoint integracji:** lokalny main to `68361d163` z zachowanymi
zmianami QA/WP. [Druga aktualizacja main](../../context/changes/qa-wp-delivery-sequencing/evidence/main-exec05-integration.json)
zachowała oba zestawy kolidujących testów. [Cały moduł OSS: 94 zestawy / 1800 testów PASS](../../context/changes/qa-wp-delivery-sequencing/evidence/current-main-delivery-os-unit.json)
dotyczy tej bazy, bez pominiętych testów. To unit/component/API-handler tests, nie żywy HTTP.

Poprzedni checkpoint `92bcb813d` również zachował lokalne
zmiany QA/WP. [Połączenie źródeł](../../context/changes/qa-wp-delivery-sequencing/evidence/main-integration.json),
[100/100 testów komend OSS](../../context/changes/qa-wp-delivery-sequencing/evidence/q-preparation/current-main-focused-jest.json)
oraz [11/11 regresji styku EXEC](../../context/changes/qa-wp-delivery-sequencing/evidence/exec-integration-regressions.json)
mają osobne manifesty. [Review](../../context/changes/qa-wp-delivery-sequencing/reviews/impl-review-main-integration.md)
obejmuje tylko te naprawy; pełny build i HTTP nowej bazy pozostają otwarte.
Wcześniejszy [pełny build aplikacji bez pomijania TS](../../context/changes/qa-wp-delivery-sequencing/evidence/q-preparation/current-build-and-pause.json)
przeszedł na zamrożonej bazie sprzed aktualizacji main. Jej bootstrap i sentinel także
przeszły, lecz HTTP przerwano po dwóch wykonaniach fixture:
[dokładny zakres i cleanup](../../context/changes/qa-wp-delivery-sequencing/evidence/q-preparation/bootstrap-and-interrupted-fixture.json).
Nie sumować tych wyników jako jednego odbioru nowej całości.

[Build zintegrowanego main z enterprise](../../context/changes/qa-wp-delivery-sequencing/evidence/q-preparation/final-enterprise-build-heap-blocker.json):
kompilacja webpack PASS, Next TypeScript przerwany przez wyczerpanie 6144 MiB heap.
To błąd procesu builda; nie kernel OOM ani wynik HTTP. Kontrolowane ponowienie
z większym heap ma osobne raporty i nie nadpisuje tej próby.

[Pełny browser WordPress run8](../../context/changes/qa-wp-delivery-sequencing/evidence/browser-editor-run-8.json)
przeszedł na `68361d163`: edycje natywne, rzeczywista zmiana motywu/rebuild,
niezmienione native readback przed/po, aktualny CSS we frontendzie i iframe oraz cleanup.
[Nowy snapshot i paczka](../../context/changes/qa-wp-delivery-sequencing/evidence/post-browser-local-package.json)
wiążą się z tym CSS; [ponowna weryfikacja 3725 plików](../../context/changes/qa-wp-delivery-sequencing/evidence/post-browser-package-verify.json)
przeszła. [Review fazy3](../../context/changes/qa-wp-delivery-sequencing/reviews/impl-review-phase-3.md)
zamyka techniczne 2.3/3.1/3.2, ale nie zatwierdzony design, ręczny odbiór ani publikację.

## Historyczny odbiór HTTP sprzed integracji main

[Zbiorczy wynik, hashe raportów, rewizje i cleanup](../../context/changes/delivery-qa-readiness/evidence/verification-current.json).
Runner: izolowany Docker, aplikacja 6 GiB / 2 CPU, heap 4096 MiB, baza 512 MiB / 1 CPU.
Playwright: jeden worker, retry 0, timeout 20 s; bez skipów i flaky.
[Źródła builda aplikacji](../../context/changes/delivery-qa-readiness/evidence/phase-1/app-build-source-manifest.json)
i [manifest źródeł](../../context/changes/delivery-qa-readiness/evidence/phase-1/final-source-manifest.json)
identyfikują zmiany bez commitu; sam HEAD nie opisuje testowanych bytes.

## Pokrycie siedmiu zadań

| Zadanie | Wynik i dowód | Granica |
|---|---|---|
| QA-02 | HTTP fixture 4/4; ledger unit 4/4; [manifest](../../context/changes/delivery-qa-readiness/evidence/verification-current.json) | API cleanup oraz usunięcie disposable runtime są osobnymi etapami |
| API R1–19 | ACL/scope/wersje/manifests/idempotency w końcowym HTTP PASS | Brak nowych endpointów |
| QA-03 backend | Oba inputMode, baseline/proposals/hash/paths/decyzje w HTTP PASS | Nie zalicza nowego UI Scope/UX/KV/UI |
| OSS lifecycle | verified i changes_requested w HTTP PASS; [OSS registry](../../context/changes/delivery-qa-readiness/evidence/phase-4/oss-server-module-proof.json) | Wyniki wykonawcy są syntetycznym fixture przesłanym przez HTTP |
| QA-04 przygotowanie | [44 unit/mock PASS](../../context/changes/delivery-qa-readiness/evidence/phase-5/focused-unit.json), [scenariusze](../../context/changes/delivery-qa-readiness/recovery-scenarios.md) | Live restart/retry/cancel/two-run: not_run/dependency |
| WP-M02 przygotowanie | [36 unit fixture PASS](../../context/changes/delivery-qa-readiness/evidence/phase-6/wp-mapper-unit.json), [mapowanie](../../context/changes/delivery-qa-readiness/wordpress-mapping.md) | Świeży OM→WP→OM i upload Preview: not_run/dependency |
| Runbook/dowody | [Runbook](runbook.md), [macierz](acceptance.md), collector i raporty SHA-256 | Odbiór człowieka 1.3/7.3 oczekuje |

[Discovery](../../context/changes/delivery-qa-readiness/evidence/phase-1/final-discovery.log):
47 testów / 10 plików. [Wąska kontrola typów](../../context/changes/delivery-qa-readiness/evidence/phase-1/final-qa-types.log): PASS.
W tym historycznym przebiegu kontrola typów Next wyczerpała 4096 MiB heap.
Prywatny build QA pomijał ten etap; nie zastępuje ordered gate QA-06. Późniejszy
pełny build sprzed integracji przeszedł bez tego obejścia, jak opisano w checkpointach wyżej.

## Naprawy i historia błędów

- Granica klient/serwer w message objects: regresja bundlera
  [przed](../../context/changes/delivery-qa-readiness/evidence/phase-1/boundary-regression-before.log) /
  [po](../../context/changes/delivery-qa-readiness/evidence/phase-1/boundary-regression-after.log), template sync PASS.
- Bootstrap API/full rejestrował ten sam loader dwukrotnie: [red → 15 PASS](../../context/changes/delivery-qa-readiness/evidence/phase-1/registry-regression.json).
  Identyczny obiekt jest idempotentny, różne definicje nadal odrzucane.
- Review starej próby po nowym wyniku: [red → 66 PASS](../../context/changes/delivery-qa-readiness/evidence/phase-4/stale-review-regression.json).
  Regresja obejmuje równoczesny replay; HTTP TC010 potwierdził obie ścieżki.
- Błędy nowych testów: niepełny payload przed dynamicznym ACL, oczekiwanie 404 zamiast
  istniejącego 409 przy nagłówku wersji, oczekiwanie akceptacji obcego scope zamiast
  odmowy 403 oraz niedeklarowany test w manualnym AC. Naprawiono fixture, zachowując API.
- Historyczne próby środowiska: [pierwsze OOM](../../context/changes/delivery-qa-readiness/evidence/phase-1/environment.json),
  [błąd bundlera](../../context/changes/delivery-qa-readiness/evidence/phase-1/retry-4gb-environment.json),
  [OOM pełnego TS](../../context/changes/delivery-qa-readiness/evidence/phase-1/boundary-fixed-environment.json),
  [loader](../../context/changes/delivery-qa-readiness/evidence/phase-1/qa-build-duplicate-loader.json),
  [konfiguracja JWT](../../context/changes/delivery-qa-readiness/evidence/phase-1/qa-build-jwt-startup.json).
  Ich wcześniejsze HTTP not_run nie opisuje końcowego wyniku.

## Otwarte zależności i odbiory

[FLOW-01…09 i F0](../../context/changes/delivery-qa-readiness/flow-steering.md) pozostają
w mianowniku odbioru. Kod domeny FLOW-F1 i EXEC-04/05 jest już dostępny. Brakuje
potwierdzonego powiązania kontraktów Cezar/OSS/WP oraz kompletnej integracji nowych
etapów z hostem/UI. Not_run: live recovery, dwa runy, aktualne host checks, pełny gate oraz demo
WordPress od początku do końca. Fixture i historyczne PASS nie zastępują tych kontroli.

[Studio Preview](../../context/changes/delivery-qa-readiness/studio-preview-readiness.md)
jest wybranym targetem; CLI/auth sprawdzone, wzorzec ai-wordpress-orchestrator przeanalizowany.
Nowej witryny nie opublikowano. Użytkownik zniósł cap WP; wcześniejszy pomiar
156 min i limit6h pozostają wyłącznie historią w [rejestrze](../../context/changes/delivery-qa-readiness/wp-budget.md).
OSS nadal nie wiąże workspace wynikowego snapshotu z bazowym; mapper testowy odrzuca
obcy workspace. Ta znana luka jest przekazana osobno, bez zmiany API.

Historyczne [WP standalone](adapters/wordpress/evidence/local-studio.live.json),
[fixture tools](adapters/wordpress/fixtures/tool-evidence.fixture.json) i
[Figma](evidence/figma/manifest.json) nie mają świeżej korelacji do tej próby OSS.

## Aktualizacja main po zakończeniu QA

Pobrano `5d485ae5e` (pięć commitów). Wynik 49/49 powyżej dotyczy zapisanego wcześniejszego
manifestu; **nowy HEAD nie został ponownie zweryfikowany HTTP**. Nowe WP-01…05 są
missing/not_run i pozostają w [macierzy](acceptance.md). [Analiza zmian i dalsza kolejność](../../context/changes/delivery-qa-readiness/main-sync-2026-09-19.md).

## Aktualizacja zakresu demo — Polylang Free

Decyzja użytkownika z 2026-09-19: tłumaczenia odroczone poza demo. Polylang Free
pozostaje wybraną wtyczką; nie wymagamy drugiego języka ani integracji tłumaczeń ACF
na odbiór demo. Ten zakres ma status deferred_by_user, nie PASS ani blocker.
Edycja treści/ACF/SEO w jednym języku oraz zachowanie treści i Global Styles po
redeploy nadal należą do odbioru. To doprecyzowanie zastępuje wcześniejsze wymaganie
wielojęzycznego probe przed demo.

## Lokalny F0 — zamknięta próba operatora

[Manifest dowodów F0](../../context/changes/wordpress-demo-foundation/evidence/README.md):
65/65 testów pakietu, typecheck/build oraz live siedem etapów PASS. Wtyczki aktywne,
replay bez reinstalacji, noindex/treść/meta zachowane, własny draft usunięty, snapshot
oraz HTTP PASS, własna witryna zatrzymana. Dwie wcześniejsze awarie transportu i ich
uzgodnienie stanu pozostają osobnymi dowodami. To częściowy WP-03; ACF/SEO/browser,
Tailwind, zatwierdzony design, redeploy, pełny build OM i Preview nie są tym zaliczone.

## Historyczne przygotowanie WP-01 i WP-02

[Builder i gate93/93](../../context/changes/wordpress-local-theme-build/evidence/verification.json),
[build rzeczywistej lokalnej witryny](../../context/changes/wordpress-local-theme-build/evidence/local-site-build.json),
[snapshot po buildzie](../../context/changes/wordpress-local-theme-build/evidence/built-site-snapshot.json)
oraz [mapper17/17](../../context/changes/wordpress-design-token-mapping/validation.json).
Oba etapy mają dwa niezależne review i zamknięte poprawki. CSS z lokalnej kompilacji
jest w snapshotcie, witryna pozostaje zatrzymana. Enqueue frontend/editor, zastosowanie
theme.json i prawdziwy zatwierdzony eksport Figmy nadal nie są odebrane; brak publikacji.
Wymagany pełny artefakt deploymentu obejmuje także wtyczki/media/config — obecny hash
v1 motyw+DB nie stanowi sam pełnego dowodu paczki uploadu.

## Historyczne wznowienie wspólnej ścieżki QA/WP po wyłączeniu komputera

[Aktualny gate pakietu WP](../../context/changes/qa-wp-delivery-sequencing/evidence/final-package-gate-v2.json):
187/187 testów, typecheck i build PASS na niezmienionych źródłach podczas przebiegu.
Obejmuje kontrolowane theme.json, enqueue, wspólny coordinator, lokalny update,
izolowany fixture redaktora, prywatny pakiet i odczytowe przygotowanie Preview.
[Próba compiled coordinator](../../context/changes/qa-wp-delivery-sequencing/evidence/local-prepared-theme.json)
wykonała lokalny build na własnej witrynie z tokenami fixture; nie potwierdza zatwierdzonego designu.

W tym checkpointcie browser editor/retencja oraz nowy gate OM i HTTP były w trakcie lub not_run;
187 testów pakietu nie zastępuje tych kontroli. [Opis wznowienia](../../context/changes/qa-wp-delivery-sequencing/restart-recovery.md)
oddziela naprawę przerwanej instalacji przeglądarki od wyników aplikacji.
[Bramki zespołu](../../context/changes/qa-wp-delivery-sequencing/dependency-gates.md)
i [roboczy handoff](../../context/changes/qa-wp-delivery-sequencing/merge-handoff.md)
wskazują aktualne zależności. Późniejszy Run8 zamknął browser/retencję, a main został
połączony lokalnie; szczegóły aktualnego stanu są na początku indeksu. Publikacji nie wykonano.

[Rzeczywisty prywatny pakiet](../../context/changes/qa-wp-delivery-sequencing/evidence/local-deployment-package.json)
przechwycił3725 plików i spójny backup SQLite przy zatrzymanej własnej witrynie.
To techniczne inventory po przerwanym pierwszym teście browser i poprawnym cleanup,
nie finalny release candidate. Pełne pliki oraz płatne wtyczki pozostają prywatne;
repo zawiera bezpieczne metadane i hashe. Konfiguracja hosta, zgody i transport
deploymentu pozostają niezweryfikowane; upload=not_run.

[Ponowna kontrola tej zapisanej paczki](../../context/changes/qa-wp-delivery-sequencing/evidence/local-deployment-package-verify.json)
potwierdziła pełne inventory i bajty3725 plików. Nowe helpery verify-only i trwałego
journalu/reconcile mają osobne29/29 testów oraz
[zamknięty review](../../context/changes/qa-wp-delivery-sequencing/reviews/impl-review-phase-5.md).
To walidacja lokalna; writer autoryzowanego uploadu, transport i dowód zdalnej rewizji
pozostają zależnościami hosta. Nie sumować tych testów z wcześniejszym gate jako
jednego przebiegu pełnej walidacji.

## Przygotowanie WP-M02 po integracji main

[Wewnętrzny mapper](../../context/changes/qa-wp-delivery-sequencing/evidence/wp-result-mapper.json):
35/35 testy i wąska kontrola typów PASS. Niezależny review zamknął poprawki zakresu
ścieżek i limitów artefaktów. To dodatkowy wynik po wcześniejszych 1800 testach OSS,
nie jeden wspólny przebieg. Nowy mapper nie był częścią zamrożonego builda QA.
Żywy caller/przypięcie prywatnych artefaktów i result→review→verified pozostają not_run.

## Aktualne środowisko aplikacji po buildzie

[Build, bootstrap i API/DB sentinel](../../context/changes/qa-wp-delivery-sequencing/evidence/q-preparation/final-build-bootstrap-sentinel-checkpoint.json):
Next build z pełnym TS PASS (356 s, heap7168 MiB/container9 GiB), oba moduły enterprise
aktywne, identyczne rejestry przed/po bootstrapie. Sentinel PASS i cleanup5/0 błędów;
fixture4/4 PASS. Aplikacja odpowiada pod http://localhost:5001/login; workery EXEC
nie startują automatycznie. Fizyczne usunięcie środowiska pozostaje pending, bo jest
zachowane do integracji. Testy84 API w osobnym raporcie; pierwszy przebieg ujawnił
niezgodność hardcoded loginów testowych z prywatnymi danymi inicjalizacji.
To nie jest cały ordered gate: kroki4–7 nie zostały nim wykonane.

### Aktualizacja źródeł OSS / EXEC / UI — 2026-09-19

HEAD `67aa2d1f8` scala main `d403ca1f9`, dev-mateusz `a74cfe8ff`, feature/design-ui `0b1cce284`. [Dowód jednostkowy](../../context/changes/qa-wp-delivery-sequencing/evidence/team-merge-unit.json):120 suites/2044 PASS. Generowanie, build, nowa migracja i HTTP/E2E tej wersji: **niewykonane**. Uruchomiona aplikacja nadal ma build68361; nie utożsamiać wcześniejszych dowodów z nowymi źródłami.


## Przekazanie offline — 2026-09-19

Punkt wejścia: [WP/QA handoff](../../context/changes/qa-wp-delivery-sequencing/offline-handoff.md).
Receipt-backed capture11PASS, pakiet WP244PASS i package TypeScript PASS są kontrolami
offline; [dowód](../../context/changes/qa-wp-delivery-sequencing/evidence/offline-transfer-validation.json).
Nie zaliczają nowego HTTP, REC, Preview ani końcowego gate. Błędy integracji EXEC,
braki hosta/designu i niewykonane kontrole są rozdzielone w handoffie.

Manualny WP roundtrip: [offline proof](../../context/changes/qa-wp-delivery-sequencing/evidence/wp-manual-roundtrip-offline.json)
i [zamknięty review](../../context/changes/qa-wp-delivery-sequencing/reviews/impl-review-manual-roundtrip.md).
Native discovery i narrow TS PASS; faktyczne komendy na frozen fixture przechodzą,
zły marker jest odrzucany. Pełny dwupróbny obieg HTTP/Studio pozostaje not_run.
Staging Preview:15PASS, prywatne pliki; brak uploadu i registered-site binding.
