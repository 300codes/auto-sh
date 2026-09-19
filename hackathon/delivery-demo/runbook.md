# Runbook odbioru delivery

Wersja przygotowawcza, 2026-09-19. [Plan QA](../../context/changes/delivery-qa-readiness/plan.md),
[macierz](acceptance.md), [indeks dowodów](evidence-index.md).
Dokument określa przebieg odbioru; żadna kontrola aplikacji nie została zaliczona samym jego utworzeniem.

## Aktualne przekazanie

Ciężka walidacja została przeniesiona na drugi komputer. Obowiązuje
[handoff offline](../../context/changes/qa-wp-delivery-sequencing/offline-handoff.md):
aktualny HEAD `67aa2d1f8` plus manifest niezacommitowanych źródeł. Poniższe starsze
liczby discovery są historyczne; finalny overlay wymaga ponownego listowania.

Przed testami WP na nowym komputerze zainstalować WordPress Studio/CLI i zalogować
właściwe konto WordPress.com. Zweryfikować sesję w środowisku rzeczywistego operatora
(host/WSL/kontener), nie tylko w aplikacji desktopowej. Szczegóły oraz nowe TODO
ustawień połączeń CLI/Studio/MCP Figmy są w powyższym handoffie.

## Pierwsze połączenie E2E po integracji main

Baza `68361d163` zawiera OSS, EXEC-04/05 i UI-02–04 oraz zachowane lokalne zmiany QA/WP.
Uruchomienie tej bazy wymaga nowego generation/build i własnej bazy z aktualnym
schematem; wcześniejszy udany build izolowanego QA dotyczy innego manifestu.
Nie przenosić jego `.mercato`, registries ani raportów jako dowodu nowej aplikacji.
Pięć wcześniejszych lokalnych suite ma teraz sufiks `.qa-regression.spec.ts`, ponieważ
main dostarczył inne testy pod dawnymi nazwami. Oba zestawy pozostają wymagane;
aktualne discovery identyfikuje 115 przypadków OSS/UI/EXEC (117 wykonań po powtórzeniu
dwóch testów fixture). Samo listowanie nie jest wykonaniem tych testów.

Pierwszy przebieg diagnostyczny:

1. Utworzyć przez UI własny projekt, zatwierdzony baseline i zadanie profilu
   `wordpress-theme`; zapisać rzeczywiste project/task/baseline IDs i wersje.
2. Przygotować lokalną własną witrynę WP, zbudować motyw i przechwycić bazowy snapshot.
   Rezerwacja próby musi użyć tego `contentHash` i `siteId` jako `externalWorkspaceId`.
3. W UI-04 zarezerwować próbę w `manual_handoff` i pobrać rzeczywisty pakiet OSS.
   Ten pierwszy przebieg sprawdza połączenie UI/OSS/WP; nie zalicza automatycznego EXEC.
4. Wykonać lokalną zmianę na tej samej witrynie, zbudować motyw i zebrać wynikowy
   snapshot oraz prawdziwe raporty kontroli. Powiązać wynik z pobraną próbą i baseline.
5. Importować wyłącznie poprawny `delivery.result-manifest/v1`, następnie wykonać
   review i odczytać report. `mapWordpressFixture` jest helperem testowym i nie służy
   do przedstawiania raportów fixture jako dowodów live.
6. Po działającym ręcznym obiegu podłączyć automatyczny EXEC do tego samego kontraktu,
   sprawdzić park → enqueue → wynik → signal oraz cancel/retry. Sam przycisk Execute
   ani odpowiedź 202 nie potwierdzają wykonania.

Jeżeli nie ma jeszcze produkcyjnego powiązania snapshot/checks → manifest OSS,
zatrzymać przebieg na tym konkretnym styku i zachować pakiet oraz ID próby. Nie
wypełniać braków hashem baseline, ID zadania jako workspace ani syntetycznym PASS.
Studio Preview dołączamy po działającym lokalnym obiegu i bramkach G4/G5.
Aktualne importy i braki połączeń opisuje
[mapa callsite](../../context/changes/qa-wp-delivery-sequencing/integration-call-sites.md).

## 1. Ustal odbierany zakres

Zapisz codeRevision, appRevision, środowisko, aktywne moduły, profil/version oraz
identyfikator suiteRunId. Wybierz: przygotowanie QA, HTTP OSS-only albo późniejszy
live EXEC/WP/React. Fixture nigdy nie zalicza live. Master Progress aktualizuje się
wyłącznie na podstawie właściwego poziomu dowodu i odbioru człowieka tam, gdzie wymagany.

## 2. Sprawdź readiness

Sprawdź `.ai/qa/ephemeral-env.json` i `.ai/qa/test-env.json`, gotowość schematu i modułów,
bootstrap auth do provisioning oraz prywatny storage. Brak warunku zapisuj jako
not_run/environment. Nie resetuj bazy developera ani nie aplikuj migracji bez osobnego
upoważnienia. Testy z ledgerem cleanup uruchamiaj na dedykowanym disposable środowisku.
Zapisz jego identyfikator i zasoby, których usunięcie po suite jest autoryzowane.

Przed licznikami SQL wymagaj jawnego `DATABASE_URL` odpowiadającego testowanemu
`BASE_URL`, bez fallbacku do developerskiego `.env`. Utwórz przez API losowy rekord
kontrolny z runId, potwierdź jego projectId/tenantId/organizationId w DB i dopiero wtedy
wykonuj liczniki. Nie zapisuj connection stringu w dowodach. Mismatch lub brak rekordu
oznacza not_run/environment; nie naprawiaj go przez przełączenie na przypadkową bazę.

Wybierz runner raz zgodnie z `.ai/docs/agent-instructions.md`: działający compose app
oznacza `node scripts/docker-exec.mjs`, w przeciwnym razie lokalny Yarn. Dla OSS-only
wyłącz enterprise w konfiguracji uruchamianego serwera i potwierdź registry; flaga
ustawiona jedynie w shellu testów nie dowodzi trybu aplikacji.

## 3. Przygotuj fixture

Fixture fazy 1 wymaga `BASE_URL`, `OM_DELIVERY_QA_ENVIRONMENT_ID`,
`OM_DELIVERY_QA_DISPOSAL_PLAN`, `OM_DELIVERY_QA_BOOTSTRAP_EMAIL` oraz
`OM_DELIVERY_QA_BOOTSTRAP_PASSWORD`. Dostarczaj je przez prywatną konfigurację
jednorazowego środowiska, nigdy w wersjonowanym pliku ani raporcie. Brak konfiguracji
daje jawny skip `not_run/environment`, który nie zalicza kryterium odbioru.
Bootstrap służy wyłącznie tworzeniu i sprzątaniu tożsamości. Asercje produktu korzystają
z osobnych sesji nowych użytkowników z ograniczonymi rolami.

`TC-DELIVERY-FIXTURE-001` dołącza raporty cleanup, jego powtórzenia i błędów teardown.
`retained` opisuje zachowanie rekordu zasobu; użytkownicy, role i pliki są usuwane,
projekty/zadania archiwizowane. Historia baseline/decyzji/prób ma oddzielny wykaz.
Logi audytowe i pozostałe dane środowiska wymagają jego końcowego usunięcia nawet
wtedy, gdy wszystkie pozycje ledger mają stan `cleaned`.

Tenant A: org A1/A2; tenant B: org B1. Testowi aktorzy mają minimalne osobne features,
bez superadmina podczas asercji. Utwórz projekty, AC, rzeczywiste testowe uploady
renderów i snapshoty. Zapisz ID natychmiast po creation. Używaj świeżych updatedAt
rodzica lub zadania według tabeli R1–R19; nie przekazuj project lock do mutacji task.

## 4. Uruchom istniejącą logikę i nowe integracje

Komendy runnera po dostarczeniu pełnej konfiguracji zarządzanego środowiska
(w tym DATABASE_URL i bootstrap). Samo BASE_URL jest niewystarczające.
Nowe środowisko uruchamiaj przez `yarn test:integration:ephemeral` zgodnie z deskryptorem;
poniższe komendy Playwright są etapem wykonywanym wewnątrz gotowego środowiska:

```bash
yarn workspace @open-mercato/core test delivery_os --runInBand
OM_INTEGRATION_MODULES=delivery_os yarn test:integration --list --grep 'TC-DELIVERY'
OM_INTEGRATION_MODULES=delivery_os yarn test:integration --grep 'TC-DELIVERY-(FIXTURE-001|00[1-8]|010)' --retries=0
OM_INTEGRATION_MODULES=delivery_os yarn test:integration --grep 'TC-DELIVERY-FIXTURE-001' --retries=0 --repeat-each=2
```

Porównaj discovery z macierzą przed liczeniem PASS. Wskazane specy są zaimplementowane; ich obecność nie dowodzi wykonania. Wynik zero
testów lub sama istniejąca UI-001 nie zalicza QA-02.
Sprawdź kolejno odmowy API, baseline/proposals, oba inputMode i pełny flow
reserve → package → result → review → verified oraz changes_requested → nowa próba.
Każda odmowa ma asercję braku niepożądanego zapisu; race ma odczyt trwałego stanu.

Skopiuj raporty `.ai/qa/test-results/results.json`, `html/`, `artifacts/` do
identyfikowanego archiwum tej próby przed kolejnym runem. Po sanityzacji wylicz ich
sha256. Zachowaj w prywatnym magazynie surowy raport, jeśli zawiera dane wrażliwe;
indeks publiczny wskazuje tylko bezpieczny artefakt i zakres redakcji.

## 5. Wykonaj cleanup nawet po błędzie

Zatrzymaj wyłącznie własny fake executor. Reconcile może potwierdzić tylko stan faktycznie
znany. Zarchiwizuj własne zadania w odwrotnej kolejności DAG, projekty i pozostałe zasoby;
zweryfikuj odpowiedzi oraz brak aktywnych skutków. Zapisz retained history i błędy teardown
oddzielnie, bez nadpisywania pierwotnej awarii testu. Append-only i soft delete nie oznaczają
fizycznego usunięcia. Po suite usuń własne disposable środowisko i jego DB/storage/cache;
jeśli musi pozostać do diagnostyki, cleanupStatus=pending i podaj właściciela.

## 6. Odbierz przygotowanie QA-04 i WP-M02

[Recovery](../../context/changes/delivery-qa-readiness/recovery-scenarios.md) zawiera
punkty awarii, liczniki efektów i wymagania live. Brak wykonawcy pozostawia live not_run.
[Mapowanie WP](../../context/changes/delivery-qa-readiness/wordpress-mapping.md) wiąże
pakiet z base/result snapshot i pełnymi ResultCheck. Pozytywny test fixture dowodzi
zgodności przygotowania, nie rzeczywistego wykonania profilu ani PoC.
Nowy [wewnętrzny mapper](../../context/changes/qa-wp-delivery-sequencing/evidence/wp-result-mapper.json)
ma 35 testy PASS; dla live nadal trzeba przypiąć autorytatywną próbę i prywatne bajty
artefaktów zgodnie z [mapą callsite](../../context/changes/qa-wp-delivery-sequencing/integration-call-sites.md).
Cap WP został zniesiony przez użytkownika. Wcześniejsze pomiary pozostają historyczne:
[rejestr i metoda liczenia](../../context/changes/delivery-qa-readiness/wp-budget.md).
Kontynuacja obejmuje wszystkie niezależne lokalne zakresy aż do rzeczywistej zależności
od kodu zespołu, zgodnie z [planem QA/WP](../../context/changes/qa-wp-delivery-sequencing/plan.md).

## 7. Późniejszy odbiór live i końcowy verdict

### Izolowany test natywnego edytora WordPress

`TC-DELIVERY-WP-EDITOR-001` jest osobno włączany przez `OM_WP_EDITOR_CONFIG`;
wymaga przygotowanej, uruchomionej własnej witryny Studio i skompilowanego pakietu WP.
Prywatny plik konfiguracyjny (0600) zawiera `operatorRoot`, `editorRequestFile`,
`prepareThemeRequestFile`, `toolchainRoot` i `expectedPageTemplateHash`.
Hash oznacza jawną zgodę na konkretny zastany `templates/page.html`; null oznacza brak
pliku. Nie odświeżać go automatycznie po konflikcie. Requesty opisują ten sam scope/site;
każdy test tworzy nowe obiekty i konto. Istniejących Global Styles nie przejmujemy.

Użyć istniejącego runnera i wspólnej konfiguracji. Prywatny wrapper konfiguracji
importuje ją w całości i nadpisuje wyłącznie `use.actionTimeout: 20000` oraz
`use.navigationTimeout: 60000`, zachowując pozostałe `use`. Zapobiega to oczekiwaniu
bez limitu na niedostępny element edytora. Zapisać hash wrappera i efektywną
konfigurację w dowodach. Tylko ten test ma większy budżet całkowity w komendzie,
ponieważ wykonuje wiele ograniczonych wywołań Studio:

```sh
OM_WP_EDITOR_CONFIG=/private/wp-editor-config.json \
PLAYWRIGHT_JSON_OUTPUT_FILE=/private/wp-browser/results.json \
PLAYWRIGHT_HTML_OUTPUT_DIR=/private/wp-browser/html \
yarn playwright test --config /private/playwright.wp.config.ts --grep 'TC-DELIVERY-WP-EDITOR-001' --workers=1 --retries=0 --timeout=900000 --output=/private/wp-browser/artifacts
```

Katalog dowodów przygotować jako prywatny przed wykonaniem. Test odmawia mutacji
przy domyślnym krótkim timeout lub włączonym retry. Trace/video są wyłączone dla
logowania; hasła i storageState nie należą do dowodów w repo. Logowanie kieruje
bezpośrednio do własnej strony, aby dashboard nie tworzył dodatkowego Quick Draft.
Sprzątanie zamyka przeglądarkę i czeka na operatory. Nieznane wpisy aktora pozostawiają
cleanup niezaliczony; nie wolno kasować ich kaskadowo ani zdejmować locka bez dowodów.

Raport rozdziela usunięcie natywnych obiektów fixture od celowo zachowanej aktualizacji
motywu. Nowy szablon i kompilacja pozostają w lokalnym demo z dziennikiem before-image;
nie jest to zatwierdzenie designu, publikacji ani całego WP-01…05. Rerun wymaga
świadomego wskazania zatwierdzonej bieżącej rewizji motywu, nie ślepego retry.

Po gotowości EXEC/UI: oba rzeczywiste wejścia i zatwierdzony baseline, run/review/poprawka,
dwa nakładające się runy i recovery, wszystkie zatwierdzone AC/skany na finalnej rewizji.
WP wymaga świeżego OM→WP→OM i host checks. Publikacja preview i release to osobne
decyzje człowieka związane z rewizją; ten runbook nie udziela zgody na publikację.
QA-06 obejmuje cały ordered gate `.ai/agentic.config.json`; wąskie testy powyżej go nie zastępują.

Werdykt odnotuj z mianownikiem wymaganych kontroli, listą failed/missing/not_run,
blockerów, odbiorów manualnych i cleanup. Zmiana rewizji unieważnia dotknięte dowody;
finalny zestaw AC/skanów musi dotyczyć wspólnej końcowej rewizji.

## Minimalny rekord evidence

| Grupa | Pola |
|---|---|
| Identyfikacja | suiteRunId, caseId, testId, acIds, timestamp, actor/owner bez sekretów |
| Pochodzenie | provenance: static-analysis / unit-fixture / http-fixture / live-executor / human |
| Rewizje | codeRevision, appRevision, baselineId/hash/version, sourceRevision, profileId/version |
| Korelacja | tenant/org/project/task/attempt IDs; workflow/run/toolExecutionId jeśli istnieją |
| Wykonanie | runner/compose, komenda, start/end, exitCode, status, reason |
| Artefakty | rawReportPath/hash, testDefinitionHash, attachment/evidence IDs, zakres sanitizacji |
| Sprzątanie | cleanupStatus, usunięte/archiwalne/pozostawione zasoby, błędy i właściciel |

To format dowodów QA, nie nowy publiczny ResultManifest. Nieznanych wartości nie
wypełniaj fikcyjnym 0/hash/UUID. Brak wykonania ma jawne null/not_applicable i reason.

## Korekta odbioru: pełny flow WordPress

Obowiązuje [macierz FLOW-01…09 i zależności F0](../../context/changes/delivery-qa-readiness/flow-steering.md).
Regresje v1, fixture i lokalny snapshot nie zaliczają pełnego demo WordPress ani publikacji.
Scope/UX/KV/UI wymagają odrębnych zgód; dawny `design` ich nie zastępuje. Wszystkie
nowe FLOW pozostają w mianowniku odbioru, również przy brakujących API, hoście i celu publikacji.

## Aktualizacja zakresu demo — Polylang Free

Decyzja użytkownika z 2026-09-19: tłumaczenia odroczone poza demo. Polylang Free
pozostaje wybraną wtyczką; nie wymagamy drugiego języka ani integracji tłumaczeń ACF
na odbiór demo. Ten zakres ma status deferred_by_user, nie PASS ani blocker.
Edycja treści/ACF/SEO w jednym języku oraz zachowanie treści i Global Styles po
redeploy nadal należą do odbioru. To doprecyzowanie zastępuje wcześniejsze wymaganie
wielojęzycznego probe przed demo.

## Doprecyzowanie użytkownika: build lokalny przed Preview

Cała instalacja, konfiguracja, build i testy odbywają się lokalnie. Dopiero gotowa,
zweryfikowana i zatwierdzona rewizja/snapshot trafia do Studio Preview jako deployment.
Na Preview nie instalujemy wtyczek ani zależności i nie uruchamiamy builda; wykonujemy
odczytową weryfikację wysłanej rewizji. Poprawki przygotowujemy lokalnie i wysyłamy jako
kolejny deployment po lokalnych kontrolach. Obecny probe F0 działa wyłącznie lokalnie;
nie jest dowodem pełnego builda systemu ani wykonanej publikacji Preview.

## Historyczny lokalny F0 — zamknięta próba operatora

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

## Aktualny odbiór lokalnego WP

[Run8](../../context/changes/qa-wp-delivery-sequencing/evidence/browser-editor-run-8.json)
potwierdza pełną edycję natywną, ACF/SEO, zachowanie treści po zmianie motywu i
ponownym buildzie oraz zastosowanie CSS we frontendzie i edytorze. Cleanup fixture
zakończony; witryna zatrzymana. Historyczne braki enqueue/browser opisane wyżej
nie są już bieżącymi blockerami technicznymi.

[Pakiet po teście](../../context/changes/qa-wp-delivery-sequencing/evidence/post-browser-local-package.json)
i [weryfikacja bajtów](../../context/changes/qa-wp-delivery-sequencing/evidence/post-browser-package-verify.json)
wiążą 3725 plików z lokalnym snapshotem i aktualnym CSS. Pakiet po cleanup nie jest
zatwierdzonym designem ani kandydatem zaakceptowanym do Preview. Nadal wymagane są
żywe powiązanie OM→WP→OM, odbiór manualny, pełny ordered gate oraz G4/G5.
