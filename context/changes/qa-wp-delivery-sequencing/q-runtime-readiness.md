# Q — przygotowanie aktualnego QA i okna runtime

2026-09-19, aktualizacja po slocie runtime. Bieżący wynik: **izolowany `build:app` PASS, pełny ordered gate NIEZALICZONY, HTTP częściowe/przerwane, regresja NIEZALICZONA**. Pozostałe sekcje opisują przygotowanie historyczne; aktualny checkpoint poniżej ma pierwszeństwo.

## Aktualny checkpoint — zintegrowany main 68361d163, po selektywnym HTTP

Nowy klon zintegrowanego main ma rzeczywisty `build:app` PASS (webpack, pełny Next TypeScript i generowanie stron), bez `ignoreBuildErrors`. Druga, autoryzowana próba używała heap7168, kontenera9GiB/2CPU oraz monitorów pamięci i dysku. Pełny ordered gate nadal **niezaliczony**. [Manifest każdego pliku udanego builda](evidence/q-preparation/final-build-per-file-manifest.json) ma fingerprint `d8f677b4ff47ed8a153c9b2e5ee6c1df7f2a0d162928928bb13f2800daedb337`; [checkpoint artefaktu, bootstrapu i sentinela](evidence/q-preparation/final-build-bootstrap-sentinel-checkpoint.json) wiąże źródła z Build ID i rejestrami.

Bootstrap wyłącznie nowej własnej DB i API↔DB sentinel przeszły; cleanup sentinela5 zasobów,0 failures,0 unmanaged. Fixture repeat2:4 PASS. Pierwszy przebieg domenowy:43 PASS,39 FAIL auth401,2 not_run/profile. Po poprawce testowego helpera i prywatnym uzgodnieniu faktycznie utworzonych kont (direct login200) selektywne39 dało29 PASS,10 FAIL. Obecnie **76 zaliczonych wykonań /74 unikalne przypadki**,10 niezaliczonych i2 niewykonane profile. [Sanitizowany raport](evidence/q-preparation/selective-http-reconciled-checkpoint.json) zawiera dokładne pliki i nazwy błędów; ich naprawa jest w toku. Nie oznacza to zaliczenia całej regresji.

Profil obejmuje enterprise;2 testy TC010 wymagające rzeczywistego OSS-only pozostają jawnie niewykonane. Discovery115 obejmuje86 OSS HTTP,8 UI i21 EXEC; powtórzone fixture zwiększają plan do88 wykonań HTTP. [Amendment discovery](evidence/q-preparation/final-discovery-amendment.json) oraz [delta helpera testowego](evidence/q-preparation/runtime-test-helper-overlay.json) oddzielają bieżące testy od zamrożonego artefaktu produkcyjnego.

Zdrowa aplikacja pozostaje pod monitorem zasobów na `http://localhost:5001/login`, z `AUTO_SPAWN_WORKERS=false`. Nie uruchamiać konsumentów EXEC w tym profilu. Konfiguracja i losowe dane logowania pozostają wyłącznie w prywatnym `q-ops/private.env`; nie w repo. CLI wypisało w stopce bootstrapu wyprowadzony adres admina różny od faktycznego rekordu utworzonego przez auth setup — zapisano osobny handoff; nie zmieniono bazy, kont ani produkcyjnego CLI. Wcześniejsze sekcje poniżej są historyczne i nie określają aktualnego mianownika ani stanu aplikacji.

## Historyczny checkpoint — 14:27 UTC, integracja nowego main

Root pobrał upstream `92bcb813d` z nowym OSS/EXEC/UI; klon Q pozostaje historyczny. Nie przenosić jego wyników na nową rewizję.

Native initialize/seed zakończyło się kodem0. API↔DB sentinel przeszedł; jego cleanup:5 zasobów,0 failures,0 unmanaged mutations. Przy żądaniu zatrzymania po initialize wcześniej uruchomiony wrapper zdążył przejść do app i HTTP, zanim zadziałał dodany warunek pauzy. Natychmiast zatrzymano własny runner. Log natywny pokazuje2 zakończone przypadki fixture; pełny repeat2 oraz45 przypadków domenowych nie zostały zakończone/uruchomione. **Regresja niezaliczona**, exit137 jest kontrolowanym stopem. Przerwany fixture może zostawić dane; fizyczne sprzątanie pozostaje oczekujące.

Dowód: [bootstrap, sentinel i częściowy przebieg](evidence/q-preparation/bootstrap-and-interrupted-fixture.json). Runner stopped, DB/logi zachowane; fitapp pozostaje stopped zgodnie z dyspozycją użytkownika. Kolejne E2E wymagają nowego izolowanego klonu zintegrowanego workspace i świeżej DB. Bez importu danych/sekretów do repo, bez kopiowania starych generated/dist jako dowodu nowej wersji. Zachować cache pobranych zależności po weryfikacji lockfile/platformy; uruchomić właściwe generate/build dla nowego źródła oraz API sentinel przed licznikami. Aktualną liczbę przypadków ustalić ponownym discovery, bo upstream dodał nowy zakres.

## Poprzedni checkpoint — 14:23 UTC

- Build aplikacji zakończył się kodem0 po351,05s. Webpack, pełny Next TypeScript (2,3min) i6/6 stron przeszły. Nie użyto `ignoreBuildErrors`. Źródła przed/po mają identyczny SHA256 `0e1fd224b211c7b0500db6af2850e93bc98424b06eb8e1fe60259002d42cd1c3`.
- Build ID: `Fd8XNyf2yq0vcyeJ2cvM6`. Osobno zapisano hashe pięciu wygenerowanych rejestrów; `delivery_os` obecne, importy enterprise nieobecne. Generated/.mercato nie zastępują manifestu źródeł.
- Klon Q nie zawiera późniejszych zmian WP. [Porównanie242 plików](evidence/q-preparation/oss-source-equivalence.json) wykazało tylko3 dodatki WP browser; istniejące testy/backend/helpery OSS są zgodne. Nie jest to pełny gate końcowego workspace.
- Wcześniejsza próba została prawidłowo zatrzymana przez monitor przy Windows available3,53GiB; exit137 pochodził z kontrolowanego stopu, `OOMKilled=false`. Po zgodzie użytkownika zatrzymano dokładnie11 kontenerów fitapp i pozostawiono je wyłączone, bez usuwania danych i bez automatycznego restore. Ponowny build przeszedł przy tych samych limitach: runner8GiB/2CPU, heap6144, DB512MiB/1CPU.
- Po sukcesie builda wykonano offline import-smoke Node24.14.1 przez istniejące `--import tsx`. Zwykły import Node wcześniej wykazał brak import attribute JSON; nie zmieniano kodu produkcyjnego.
- Nowa dyspozycja użytkownika „implementacja teraz, testy na koniec” przerwała start bootstrapu. Schemat bazy nie powstał: read-only odczyt wykazał0 public base tables, tylko rozszerzenia `vector`, `pgcrypto`, `plpgsql`. App, sentinel i HTTP nie wystartowały. Własny runner został zatrzymany, DB i prywatne logi zachowane.
- Pełny ordered gate nadal niezaliczony: kroki1–4 są historyczne dla klonu; w skróconej ścieżce pominięto5–7. Nie nadawać im PASS na podstawie sukcesu builda.

Dowody: [build, artefakt i stop](evidence/q-preparation/current-build-and-pause.json), [zasoby udanej próby](evidence/q-preparation/successful-build-resources.jsonl), [pierwszy resource-stop](evidence/q-preparation/http-build-resource-blocker.json), [autoryzowany stop fitapp](evidence/q-preparation/fitapp-authorized-stop.json).

## Bezpieczne wznowienie HTTP

Po nowym sygnale runtime sprawdzić exact IDs/własność, limity i dostępność pamięci. Uruchomić wyłącznie własny runner, zachowując istniejącą DB. Prywatny driver wymaga zgodności fingerprintu z udanym buildem i porównuje Build ID/rejestry przed bootstrapem, po nim i po HTTP. Bootstrap wymaga0 tabel; przy częściowym schemacie zatrzymuje się do jawnego reconcile, nigdy resetu. Jawne env/losowe credentials są dostępne wyłącznie w prywatnym środowisku.

Sekwencja: offline import-smoke → native initialize własnej świeżej DB → managed app → bounded401 readiness → własny rekord API i DB sentinel →2 fixture ×repeat2 +45 domain =49 wykonań,47 unikalnych przypadków. Workers1, retries0, wymagane0 skipped/flaky/unexpected; każdy raport zachowany przed następną grupą. `finally` zatrzymuje własny runner, zostawia DB do końcowej oceny dowodów. Soft cleanup nie oznacza fizycznego usunięcia danych.

Niezależne braki implementacyjne Q: nie zidentyfikowano nowych. Istniejące testy i helpery pokrywają przygotowany zakres. Live REC/nowy FLOW pozostają zależne od właściwego executora, bridge/workflow, kontrolowanego restartu i zaakceptowanych kontraktów; nie zastępować ich atrapą ani dwoma wywołaniami HTTP.

## Wynik przygotowania

Aktualne źródła: 47 testów w 10 plikach dla fixture/TC001–008/010. Manifest obejmuje 226 plików OSS, helperów, EXEC i konfiguracji; nie jest pełnym freeze całej aplikacji. Discovery wykonano na prywatnej kopii aktualnych źródeł z istniejącymi zależnościami QA. Pierwsza próba przez NODE_PATH nie rozwiązywała importu ESM Playwright; izolowana kopia z lokalnym node_modules i mapowaniem źródeł rozwiązała problem. To naprawiony problem narzędzia discovery, nie awaria testów produktu.

Brak `.ai/qa/ephemeral-env.json`, jawnego BASE_URL oraz DATABASE_URL. Odczyt kontenerów nie wykazał działającego OM; obce usługi Supabase pozostawiono bez zmian. Discovery używa runnera local. Przed właściwym gate powtórzyć probe zgodnie z `.ai/docs/agent-instructions.md` i utrzymać wybrany runner przez całą sekwencję.

## OOM — potwierdzone przyczyny i nierozstrzygnięte kwestie

Źródła historyczne: `delivery-qa-readiness/evidence/phase-1/boundary-fixed-environment.json` oraz `boundary-fixed-typecheck-oom.log`.

1. Wcześniejsze błędy granicy klient/server zostały naprawione; po tej zmianie Webpack zakończył się po 192 s. Nie diagnozować ostatniej próby jako trwającego błędu bundlera.
2. Następnie pełny Next typecheck wyczerpał V8 heap 4096 MiB po około 92 s; log wskazuje GC przy około 4044 MiB i `Ineffective mark-compacts near heap limit`. To konkretna awaria limitu heap; nie dowód wycieku ani jednego winnego pliku TypeScript.
3. Poprzedni kontener miał 6144 MiB/2 CPU, DB 512 MiB/1 CPU. Oddzielna wcześniejsza próba miała również container OOM podczas kompilacji. Nie mieszać tych zdarzeń.
4. Prywatny stary checkout ma `typescript.ignoreBuildErrors: true`; nie może być użyty bez przywrócenia aktualnej konfiguracji jako pełny gate. Jego build/dist i manifest pochodzą sprzed synchronizacji main. Zachować historyczne raporty, nie przepinać ich na nowy HEAD.
5. Obecny app tsconfig obejmuje `**/*.ts`/`**/*.tsx`, a build generuje kod pod `.mercato`; wpływ grafu plików/generated na pamięć pozostaje do zmierzenia. Nie usuwać plików z kontroli typów bez rozpoznania realnego błędu konfiguracji. Nie używać narrow TS ani ignoreBuildErrors jako pełnego PASS.

## Propozycja slotu zasobów — wymaga koordynacji z root

Pomiar odczytowy: host 16001 MiB RAM, 9349 MiB available, około 4 GiB swap. To chwilowy pomiar, nie rezerwacja. Sandbox nie udostępnił standardowego cgroup v2 memory.max; limity procesu/kontenera sprawdzić ponownie w wybranym runnerze.

- Slot A teraz: discovery, manifest, review i małe testy natywne równolegle z W1/W2; bez nowych usług.
- Slot B: jeden pełny build/typecheck OM. Bez Studio/browser/live workers i bez równoległych buildów workspace. Nie zatrzymywać obcego Supabase. Monitorować RSS/available i udokumentować efektywny limit heap.
- Kandydat do omówienia: heap 6144 MiB z co najmniej 2 GiB dodatkowego headroom dla procesu/OS oraz osobnym budżetem DB. To proponowana zmiana poprzedniego limitu, nie wykonana ani gwarantowana naprawa. Jeżeli pomiar nie zapewnia zapasu, użyć większego izolowanego runnera; nie zużywać swap jako planowanego rozwiązania.
- Slot C po buildzie: jeden własny app+DB, Playwright workers=1. Fixture dwukrotnie bez retry, później pozostałe przypadki. WP live na tej samej maszynie dopiero po zakończeniu slotu lub nowym pomiarze bezpiecznego współistnienia.
- Zintegrowane dwa procesy wykonawcze to osobny późniejszy slot wymagający działającego EXEC-04; nie odtwarzać tego przez dwa testy HTTP.

## Polecenia po przygotowaniu własnego środowiska

Zamrozić aktualne źródła/config/lockfile w pełnym izolowanym checkout, zachowując niezacommitowane zmiany. Prywatny cache zależności sprawdzić pod kątem aktualnego lockfile i platformy natywnych modułów. Przed HTTP wstrzyknąć prywatnie jawne `BASE_URL`, `DATABASE_URL`, `OM_DELIVERY_QA_ENVIRONMENT_ID`, `OM_DELIVERY_QA_DISPOSAL_PLAN`, `OM_DELIVERY_QA_BOOTSTRAP_EMAIL`, `OM_DELIVERY_QA_BOOTSTRAP_PASSWORD`. Nie wypisywać wartości ani nie commitować descriptorów z sekretami.

```bash
OM_INTEGRATION_MODULES=delivery_os yarn playwright test --config .ai/qa/tests/playwright.config.ts --list --grep 'TC-DELIVERY-(FIXTURE-001|00[1-8]|010)'
OM_INTEGRATION_MODULES=delivery_os yarn test:integration --grep 'TC-DELIVERY-FIXTURE-001' --workers=1 --repeat-each=2 --retries=0
OM_INTEGRATION_MODULES=delivery_os yarn test:integration --grep 'TC-DELIVERY-(00[1-8]|010)' --workers=1 --retries=0
```

Najpierw helper tworzy rekord kontrolny przez testowane API. `readDeliveryDbCounts` wymaga jawnego DATABASE_URL i zgodności projectId/tenantId/organizationId/runId/projectName z rekordem API przed scoped SELECT. Brak lub mismatch oznacza not_run/environment, nie PASS. Nie wykonywać żadnego samodzielnego odczytu liczników wcześniej. Każde zakończenie obejmuje sanitizowane cleanup evidence; nie sprzątać obcych runów.

Pełny ordered gate pozostaje dokładnie zgodny z `.ai/agentic.config.json` (w trybie Docker każde `yarn X` zastępuje `node scripts/docker-exec.mjs X`):

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

Uruchamiać sekwencyjnie, zapisując kod zakończenia i log każdego kroku; nie kontynuować przez nieobsłużony błąd i nie uznawać zredukowanego polecenia za pełny gate. Runtime/memory overrides zapisać oddzielnie. Dane do runtime muszą pochodzić z własnego środowiska — brak zgody na migracje wspólnej bazy.

## Blockery a problemy środowiska

| Warunek | Klasyfikacja | Następny krok |
|---|---|---|
| Brak lokalnego root node_modules | Naprawiony dla discovery; full gate nadal wymaga kompletnego toolchain | Przygotować zgodny izolowany checkout/dependencies |
| Brak descriptor/BASE_URL/DATABASE_URL/sentinel | Not_run/environment, brak testowanej aplikacji | Własny app/DB w uzgodnionym slocie, API sentinel przed DB |
| Historyczny heap OOM | Problem zasobów, możliwy do zbadania/naprawienia | Pomiar pełnego TS i uzgodniony limit/większy runner; bez wyłączania kontroli |
| EXEC zintegrowany z main, live recovery niewykonane | Brak dowodu wykonania kontrolowanego executora/restartu | Osobny przegląd ownership, workflow/job cleanup i rzeczywistego executora; bez uruchamiania produkcyjnego Cezara w obecnym HTTP smoke |
| Cancel spec przyjmuje cancelled result, OSS odrzuca late result | Nierozstrzygnięty kontrakt właściciela | Uzgodnić przed live mid-run cancel |
| G1/G2 design/aktor | Osobny tor root/design | Nie blokuje istniejącego OSS HTTP; blokuje właściwy odbiór UI/WP |

49/49 historycznych wykonań pozostaje dowodem wcześniejszych hashy. Nowy mianownik wynika z discovery i rzeczywistych wykonań; ówczesna liczba wykonanych HTTP wynosiła zero; aktualizację częściowego przebiegu14:27UTC opisano na początku dokumentu.
