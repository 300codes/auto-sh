# UI completeness — przekazanie rozpoczętej implementacji

Data: 2026-09-19. Stan: implementing; odbiór fazy 1 potwierdzony, bez zaliczenia live.

## Najnowsza decyzja operacyjna

Użytkownik potwierdził dostęp do Figmy po swojej stronie i brak WP Studio.
Pozostała część wymagająca Studio jest odroczona jako specyfikacja:
[zakres i procedura wznowienia](../../../../../.ai/specs/2026-09-19-wordpress-studio-tools.md#aktualny-zakres--brak-wp-studio).
Zachowujemy lokalne narzędzia WP i testy, nie zaliczamy hosta, Preview ani
WP-01…05. Pozostałe fazy są kontynuowane; wdrożenie OM pozostaje w planie.
Kolejny `figma.whoami`, ponowiony na prośbę użytkownika, zakończył się sukcesem:
konto Michała Strześniewskiego, seat Full (300.codes Pro oraz własny Starter).
Bieżąca tożsamość konektora potwierdzona; odczyt konkretnego pliku, zapis
i comments API nadal wymagają osobnych prób.

## Końcowa walidacja przed commitem

Runner: local, Node 24.13.0. Użytkownik zatwierdził commit zmian i następnie
jawnie polecił pominąć build produkcyjny (`yarn build:app`). Build aplikacji
nie został wykonany; pełny gate nie jest zaliczony. WP Studio/Preview i wdrożenie
OM pozostają odroczone zgodnie z wcześniejszymi decyzjami.

- `yarn install --immutable`, oba `yarn build:packages`, `yarn typecheck`
  (42/42 pakiety), `yarn i18n:check-sync` oraz `yarn i18n:check-usage`: exit 0.
- `yarn agents:check-budget`: exit 0 z istniejącymi ostrzeżeniami długości
  łańcuchów instrukcji.
- `yarn check:client-boundaries:fail`: exit 1; 244 istniejące client page roots
  poza allowlist. Ta zmiana nie dodaje nowych page roots.
- Pierwszy root `yarn test` przerwano po 43 minutach z powodu wolnego
  recyklingu workerów. 41 zakończonych pakietów zachowuje wynik; pozostałe
  uruchomiono osobno z większym limitem pamięci, bez zmian konfiguracji repo.
- CLI: 103 suites / 1943 tests PASS; storage-s3: 15 suites / 128 tests PASS.
- Core: 2103 suites / 20055 tests PASS, trzy audyty zgłosiły braki jawnych
  komparatorów, użycie low-level ACL i brak etykiet uprawnień. Jeden suite
  i dwa testy są pomijane przez istniejącą konfigurację/testy.
- Trzy audyty core naprawiono i sprawdzono celowanymi testami: sortowanie
  i regresje 57 PASS, scoped feature policy i Scope tools 27 PASS, katalog
  ACL 1 PASS. Tłumaczenia: sync 66 modułów / 5 języków PASS.
- Końcowy `yarn typecheck` po poprawkach: 42/42 PASS. Regresje kompilacji
  motywu WordPress: 11/11 PASS poza sandboxem (sandbox blokował child process).
- Generator OpenAPI zachowuje schematy przy importach JSON z pakietów.
  CLI 11 testów regresyjnych PASS; przebudowany CLI i końcowy `yarn generate`:
  exit 0, 615 ścieżek API, bez fallback do static regex extraction.
- create-mercato-app: 885 PASS, 2 FAIL, 3 istniejące skipped (890 tests).
  Rozjazd modules.ts naprawiono przez `yarn template:sync:fix`; celowany test
  zgodności szablonu 2/2 PASS. Drugim błędem była niespójna data wydania
  w UPGRADE_NOTES względem CHANGELOG; skorygowano jedną linię, cały
  celowany release-upgrade-skill-contract test PASS. Pełnego root `yarn test`
  nie powtarzano; naprawione błędy sprawdzono testami celowanymi.
- Migracji nie zastosowano; browser, realny crash/race na bazie, live Figma/WP
  oraz ręczny odbiór faz 2–8 nie mają wyniku PASS. Checkboksy tych wymagań
  pozostają otwarte.

## Integracja pobranego main

Na polecenie użytkownika scalono `origin/main` (`b190a37c6e`) z bieżącą pracą.
Rozwiązano dwa konflikty dokumentów przy merge oraz 24 konflikty przy
przywróceniu lokalnych zmian. Osobno porównano 31 różnych plików, które były
lokalnie untracked, a na main już istniały. Zachowano scoped idempotencję Staff,
durable intent/reconcile, bindingi, sesje importu i ochronę kandydatów; włączono
poprawki main, w tym F10 missing-link 404, sortowanie F12 po updatedAt,
typowaną rewizję publikacji oraz komplet helperów testów integracyjnych.

Wyniki po scaleniu (runner local, Node 24.13.0):

- Delivery OS i test rejestru idempotencji: 149 suites / 2392 tests PASS;
  `yarn jest --config packages/core/jest.config.cjs --runInBand packages/core/src/modules/delivery_os packages/core/src/modules/staff/commands/__tests__/createIdempotency.test.ts`.
- Delivery Agents: 5 suites / 27 tests PASS; core i enterprise typecheck PASS.
- Opcjonalne pakiety: Figma 13 tests PASS, Workflows 19 tests PASS.
- WordPress: 259 tests PASS; uruchomienie poza sandboxem potrzebne dla wyjścia
  procesów potomnych. Nie uruchomiono rzeczywistego Studio ani publikacji.
- `git ls-files -u` i lista konfliktów są puste. `git diff --check` dla
  niestage'owanych zmian jest czysty; staged check zgłasza tylko whitespace
  w historycznych logach z main, których treści dowodowej nie zmieniano.

W chwili powyższej weryfikacji merge pozostawał bez commitu. Stash `fcb0a297254e0a56e9fab72862f32358dd94e7e2`
zabezpiecza pracę sprzed scalenia i nie został usunięty. Pełny gate repo,
generacja oraz browser/live pozostają osobnymi krokami, nie wynikają z tego testu.

## Inwentarz rewizji

Punkt wejścia: `4a8839443212a1d29a3c24556eeafd7aa6caf7a6`, branch
`feature/design-ui`, jeden worktree, czysty working tree przed rozpoczęciem.
Od bazy planowania `25ee6260c263fcb69a4c30c3fc23d4edb94942b9` zmieniły się
wyłącznie cztery dokumenty planowania. D1–D3 pochodzą z
`1fd03d0c271232bb58ee15dd99bb16d0522f2675` i pozostają bazą implementacji.

Sprawdzono `git branch -avv`, `git worktree list`, logi i drzewa lokalnie
dostępnych remote-tracking refs. Nie wykonano fetch: aktualność serwera Git
pozostaje niepotwierdzona. `context/foundation/lessons.md` i roadmap nie istnieją.

| Dostawa | Rewizja dostępna lokalnie | Wynik porównania / pozostała praca |
|---|---|---|
| F1 HTTP + gate | `origin/main` `ee369f72da`; `b995312c3`, `b3d3581de`, `51e68f24c` | Poza HEAD: flowQueries, intake/proposals/flow/pin/stages routes, gate ready/reserve/deploy. Reuse zamiast odtwarzania. Nadal brak immutable binding i worker gate przed efektem. |
| F1 integracje | `e71dc11c4` | FLOW-01/02/09 i flowSpecKit istnieją poza HEAD. Wyniki z handoffu są historyczne. |
| F2 komentarze | `origin/dev-mateusz` `f8eb5651d8` | Encje, migracja, encryption, staffLink/comments/staffKanbanAdapter, loader i deferrals. Brak HTTP F10–F13, Figmy, sync UI i FLOW-03/04. |
| F3/F4 raport/publikacje | `origin/dev-mateusz-flow-b` `749b93fa2d` | F14 route/commands, encja/migracja, fake adapter i FLOW-07. Raport trzeba scalić z istniejącymi D1–D3. |
| Widget EXEC | `origin/main` `ee369f72da` | Poprawka useT już istnieje; nadal brak guarded mutations i trwałego odtworzenia próby. Niezależna poprawka fazy 2 w toku. |
| WP | `origin/main` `83a2d8c2d9` | Dostarczone poza HEAD tokeny, build/theme-update, plugins, preview journal i deployment verify wraz z testami. Wymagają reuse/review; nie dowodzą live ani pełnego WP-01…05. |
| Workflows | sprawdzone HEAD i obie lanes | Brak delivery-workflows, exact-version service, ochrony całej opublikowanej semantyki oraz settings/project workflow. |

Dokumenty dostawców dostępne przez `git show <ref>:<path>`:

- `origin/main:context/changes/delivery-os-oss-domain/handover/FLOW-F1.md`;
- `origin/dev-mateusz:context/changes/delivery-os-oss-domain/handover/FLOW-progress.md`;
- `origin/dev-mateusz-flow-b:context/changes/delivery-os-oss-domain/handover/FLOW-F3-F4-lane-b.md`.

Wspólna baza lanes: `b3d3581deab699a69617fd41e31adcf45e350ed6`.
Wspólnie zmieniane miejsca: spec OSS, FLOW-progress, routeTestKit, commands/index,
entities, validators i snapshot migracji. F4 migration `20260919152308` sortuje
przed F2 `20260919160535`. Nie wykonano merge ani migracji.

## Rozbieżność wymagająca decyzji

Oczekiwane w fazie 5: atomowa idempotencja scoped po stronie Staff oraz durable
intent/reconcile po stronie Delivery.

Znalezione w F2: proxy EntityManager z keepTransactionContext, proxy kontenera
DI oraz bufor efektów dataEngine. Testy dostawcy wykorzystują fake bus/em;
handoff opisuje możliwość pozostawienia audit log po rollback.

Znaczenie: tej dostawy nie można uznać za dowód recovery po crash ani przenieść
mechanicznie jako gotowej realizacji planu. Rekomendacja: wykorzystać encje,
reguły i komendy F1/F2/F4, zachować D1–D3, a recovery Staff dostosować do
zatwierdzonego planu. Alternatywa wymaga zmiany planu oraz sprawdzenia rzeczywistej
atomowości, audytu i side effects na bazie.

Decyzja użytkownika w tej sesji: **wykorzystać dostawy i dostosować recovery do
zatwierdzonego planu**. Rozbieżność rozstrzygnięta; nie jest zgodą na migracje,
publikację ani manualnym odbiorem faz.

## Aktualny probe readiness

Probe read-only 2026-09-19T17:21:51Z, operator: agent Codex w bieżącej sesji.
Runner: **local**. DOCKER_COMPOSE_FILE unset; dev compose `ps app` po eskalacji
exit 0 i pusty wynik, full compose nie przechodzi interpolacji JWT_SECRET.
Nie ma `.ai/qa/ephemeral-env.json` do reuse. Nie odczytywano sekretów.

| Obszar | Wynik | Właściciel / warunek odblokowania |
|---|---|---|
| Figma whoami i metadata historycznego node 3:2 | `USER_NOT_LOGGED_IN`, connector not connected | Adam: połączyć Figma w tym kliencie, następnie powtórzyć read/render i autoryzowany write |
| Figma comments | brak narzędzia comments w udostępnionym zestawie; live not_run | Adam + Mateusz: uprawnione połączenie comments API i realny thread/reply |
| Lokalny OM :3000 i WP :8884 | curl exit 7, HTTP 000; connection refused | QA + Michał: wskazać działające endpointy; wynik nie wyklucza innych portów |
| Node/Yarn | v26.5.1 / 4.17.1 | QA: pakiet WP wymaga Node 24.x; uruchomić walidację we wspieranej wersji |
| PHP CLI | 8.3.6 | Michał: potwierdzić rzeczywisty PHP hosta WP i zgodność wybranych wtyczek |
| Studio/wp CLI | brak w PATH | Michał: wskazać stanowisko i dozwolone narzędzia wykonania |
| Klienci | Codex 0.155.1; Claude 2.1.266 | Historyczne uwierzytelnienie Claude nie potwierdza sesji Codex |
| Migracje/moduły/scope | not_run | QA: autoryzowane środowisko i scope operatora; migracje tylko po osobnej zgodzie |
| WP/plugin matrix/licencje | wersje i źródła niepotwierdzone | Michał: WP/PHP/Tailwind/Yoast/ACF Pro/Polylang, prawa i zgodność ACF–Polylang |
| Target publikacji / klient / odbierający | niepotwierdzone | Właściciele: wskazać targetRef/URL i osoby przed live |

Nie wykonano write do Figmy, migracji, startu usług ani publikacji. Nie przeniesiono
historycznych PASS do bieżącej sesji. Blockery live nie zatrzymują niezależnych
poprawek kodu i kontrolowanych testów.

## Kontrakty i odbiór

F1–F15 oraz DTO v1 pozostają bez zmian. F5 nie otrzymuje publicznego HTTP.
Intake używa własnego updatedAt; stage mutation wersji projektu. F7 zachowuje
ACL zależne od source, F8 template approverFeatures i idempotency key.
Replay poprzedza lock, a legacy zachowuje działanie.

Delta results read, immutable binding, DesignImportSession, provider settings
i Staff recovery została opisana jako planned w spec OSS, a Scope/WP host
w spec enterprise. Ledger niżej określa odpowiedzialność i warunki testów;
opis kontraktu nie oznacza wykonania funkcji. Pozycja 1.2 jest sprawdzana
kontrolą spójności dokumentów przed przekazaniem.

### Ledger integracji do odbioru

Wszystkie operacje otrzymują tenant/organization z uwierzytelnionego backendu,
nigdy z payloadu klienta. Obce zasoby odpowiadają 404 bez ujawnienia ich istnienia.
Nowe mutacje używają command bus, registry guardów i aktualnej wersji właściwego
agregatu; 409 oznacza konieczność ponownego przeglądu, 428 brak wymaganego tokenu.
Poniższe dodatki są projektowane, chyba że inwentarz wyżej wskazuje dostawę.

| Seam / owner → odbiorca | Request → response | ACL / lock / replay / błędy | Wymagana weryfikacja |
|---|---|---|---|
| Results read / Mateusz → Adam | GET task results, attemptId → delivery-result-read.v1 z null albo summary checks/findings/usage/source/time/revision i refs | projects.view; odczyt bez lock; scoped task/register/resultEvidenceId i korelacja baseline/hash/attempt; bez surowych logów, 404 obce refs, fail-closed uszkodzone dane | results query/routes, UI-004 reload, view-only i unknown usage |
| F1–F9 / Mateusz → Adam, Marcin | Opublikowane intake/proposal/template/stage DTO → wersje i projekcja flow | Opublikowane ACL F1–F9; intake own token, stage project token; F7 source ACL; F8 idempotency key; F5 tylko wewnętrzne | FLOW-01/02/09, dwa scope, replay i legacy |
| Baseline materialization / Mateusz → Adam, Marcin | POST project flow/baseline → deterministyczny draft/version + pełne źródłowe refs | projects.manage; project lock; brak automatycznych technical approvals; freeze append-only binding, klucz scope/project/baseline/template/refs; 422 nieaktualny/niepełny design | Dwa bindingi tego samego contentHash, AC→tests, stale ready/reserve/worker |
| DesignImportSession / Mateusz → Adam | GET/POST project design-imports, GET/PUT detail → osobne versioned DTO/session updatedAt, expected keys/results | projects.view/manage; token sesji; manifestHash idempotency; file/node/viewport/version identity; serwer sprawdza attachment scope/bytes/hash, wylicza complete; 409 konflikt, 422 braki/hash | Partial→reload→retry, obcy attachment, freeze refusal, UI-003 |
| Staff recovery/F10–F13 / Mateusz → Adam | Opublikowane link/batch/thread/triage DTO → trwały mapping, cursor, status i updatedAt | flow/comments features ze spec; triage own token; opcjonalny Staff scoped idempotency, Delivery durable intent/reconcile; cursor po durable wyniku, bez duplikatów po crash | FLOW-03/04, realna baza przy crash/race, Done≠approval, hash-bound deferral |
| Figma provider / Adam → Mateusz | Autoryzowany fetch komentarzy → commentImportBatchV1 przez publiczną komendę | Sekrety wyłącznie provider package; brak globalnego mutable scope; bounded pages/backoff, jawny brak provider/access | Thread/reply/edit/delete/retry i live oddzielnie |
| Exact-version/publish / Marcin → Adam | Scoped id/version → dokładnie ta definicja; publikacja → nowa immutable wersja | Istniejące Workflows auth/grants/publish; Delivery policy chroni graf/config/conditions/tools/approvalPolicy, legacy bez policy bez zmiany; concurrent publish conflict | FLOW-05 restart i completed instance, v1 old/v2 new |
| Flow settings/project workflow / Marcin → Adam | Scoped default template/version settings → updatedAt; start/link project instance | flow.manage; settings own token; idempotentny start/link; project workflow osobny od attempt; brak pluginu jawny | Dwa scope, 409, OSS-only, keyboard/hydration |
| Scope agent / Marcin → Adam | Scoped intake → ScopingProposal v1 do przeglądu/importu | Istniejący AI runtime, propose-only, brak approve/dispatch; refresh bez rerun; v1 targetProfile frozen | FLOW-01/02, propozycja/replay, manual OSS |
| WP host / Michał + Marcin → QA | TaskPackage i binding → snapshot/ResultManifest/review/correction | Scope hosta, allowed paths, before-effect gate, create/run/reconcile; niepewny efekt wymaga odczytu; unknown usage jawne | FLOW-06, WP-01…05, content/Global Styles/redeploy i dwa języki |
| F14 publication / Mateusz + Michał → QA | Opublikowany publicationResultV1 + pinned candidate/target → trwały wynik i verify | Wspólny publicationGate, istniejące ACL consent, approved revision i target allowlist; timeout reconcile, brak verify blokuje release | FLOW-07, stale/foreign candidate/target, oddzielny release |

### Client boundaries

Nowe komponenty pozostają islands, bez nowych client page roots i globalnych SDK:

| Island w delivery_os | Importer | Własność |
|---|---|---|
| components/intake/BriefWizard.tsx | backend/delivery/projects/create/page.tsx (server) | Adam |
| components/intake/ScopingConversation.tsx | BriefWizard lub komponujący go widok Scope | Adam; agent Marcin |
| components/detail/ProjectOverview.tsx | backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx | Adam |
| components/stages/StageReview.tsx, StageHistory.tsx | ProjectOverview / istniejące sekcje detail | Adam |
| components/detail/ScreenImportDialog.tsx | DesignSection.tsx | Adam; sesja Mateusz |
| components/stages/FigmaSync.tsx | components/stages/StageReview.tsx | Adam |
| packages/delivery-workflows/src/modules/delivery_workflows/components/FlowSettings.tsx | packages/delivery-workflows/src/modules/delivery_workflows/backend/settings/delivery-flow/page.tsx (server) | Adam + Marcin |

Ścieżki są projektowane według zatwierdzonego planu. Nie importować Kanbana ani
grafu do globalnego bootstrapu. Reuse istniejących
route boundaries Staff i Workflows. Każdy nowy route: hydration, loading/error,
reset scope, Cmd/Ctrl+Enter, Escape i guarded retry.

Przekazanie 1.3 potwierdzone przez użytkownika: „Odbiór fazy 1 potwierdzony;
kontynuuj wszystkie fazy”. Operacyjne osoby przed live pozostają do wskazania;
potwierdzenie dotyczy readiness z nazwanymi blockerami, nie ich usunięcia.
Estymata 134–218 osobogodzin z planu nie jest
nowym pomiarem; znalezione dostawy zmniejszają pracę odtwórczą, ale wymagają
integracji i nowych testów. Nie wyznaczono pozornego terminu live.

## Weryfikacja

Inwentarz jest analizą statyczną. Historyczne wyniki F1/F2/lane B nie są PASS
bieżącej rewizji. Pełny gate, FLOW browser, migracje, Figma write/comments,
WP edit/redeploy/publish i odbiór człowieka nie zostały tutaj zaliczone.

Kontrola dokumentów w runnerze local: 24 lokalne odnośniki z planu, briefu,
decyzji, researchu uzupełniającego i handoffu istnieją; siedem wskazanych rewizji
przeszło `git cat-file -e <sha>^{commit}`. Skrypt Python pathlib/re oraz Git,
exit 0. To dowód pozycji 1.1, nie weryfikacja aplikacji.

Kontrola obecności 13 wymaganych sekcji delty/ledgeru i ręczna kontrola tabel
request/response, scope, ACL, lock, idempotencji, błędów i testów: exit 0.
Pozycje 1.1/1.2 zakończone; odbiór 1.3 potwierdzony przez użytkownika.
Użytkownik zatwierdził komunikat commitu fazy 1 i zakres dziewięciu dokumentów;
zmiany kodu pozostają poza tym commitem.

Decyzja operacyjna użytkownika: WP Studio wygeneruje URL preview podczas pracy;
nie wymagamy wcześniej podanego adresu. Wdrożenie OM jest odroczone na ten etap,
pozostaje w planie; implementacja i lokalna walidacja pozostają w zakresie.
Preview WP nadal wymaga korelacji i verify, nie stanowi automatycznego release.

### Niezależne dostawy rozpoczęte równolegle

- Widget EXEC/host: poprawny useT, guarded execute/cancel z wersją taska,
  odczyt register po odświeżeniu oraz host zachowujący widget w refetch.
  Pierwsza weryfikacja local: 5 testów realnego widgetu i 8 testów hosta PASS;
  package typechecks core i enterprise PASS. To nie zalicza browser UI-002/004.
- WP reuse z `83a2d8c2d9`: Node 24.13.0, `npm test`, `npm run typecheck`,
  `npm run build` w packages/delivery-wordpress — exit 0; 259/259 testów,
  0 skipped. Brakującą fixture tokenów przeniesiono do package-local
  `src/__tests__/fixtures/design-tokens.json`. Nadal brak host-run-result-review,
  pełnej provenance designu, rzeczywistego transportu publikacji i dwóch języków.
- F1/F2/F4 backend: scalanie z zachowaniem D1–D3, candidate guards i obu
  addytywnych migracji. Testy po integracji ujawniły historyczne fixture
  zakładające brak kandydata lub starszy report DTO; są dostosowywane bez
  osłabiania bramek produkcyjnych. Pierwszy pełny przebieg Delivery OS po reuse:
  133 suites / 2231 tests PASS; późniejsze zmiany wymagają ponownego przebiegu.
- `yarn check:client-boundaries:fail`: exit 1, 245 istniejących nieobjętych
  allowlist client page roots; zmiana widgetu nie dodaje page root. Nie zaliczono
  tego checka ani całej fazy 2. Pełny gate repo jeszcze nie wykonany.

### Recovery Staff i provider Figmy — kolejny punkt integracji

- Staff task/comment create przyjmują opcjonalny idempotencyKey. Scoped rejestr
  klucz/hash/resourceId zapisuje się atomowo z rekordem Staff; advisory transaction
  lock serializuje ten sam klucz. Callerzy bez klucza zachowują dotychczasową ścieżkę.
- Delivery zapisuje durable batch key/hash oraz pierwsze payloady tworzenia przed
  efektem. Adapter używa publicznych komend bez proxy EM/DI i buforowania efektów.
  Po utracie odpowiedzi odtwarza ID przez ten sam klucz; mapowania i cursor
  utrwala po powodzeniu. Importy jednego scope/project/file serializuje osobny
  advisory lock; re-link jest zablokowany także przy nierozstrzygniętym intent.
- Local: 6 suites / 99 tests PASS (Staff, rejestr, adapter, import i link),
  obejmujące utratę odpowiedzi oraz konflikt zmienionego payloadu po częściowej
  awarii. Core typecheck PASS. To nadal nie dowód crash/race na prawdziwej bazie.
- Nowy opcjonalny `packages/delivery-figma`: scoped credentials/state,
  stały HTTPS origin, bounded fetch/backoff, normalizacja edits/deletes/replies,
  guarded public import oraz odpowiedź 207 dla częściowej synchronizacji.
  Local: 4 suites / 13 tests PASS, package typecheck PASS.
- [API komentarzy Figmy](https://developers.figma.com/docs/rest-api/comments-endpoints/)
  zwraca pełny snapshot bez paginacji; provider ogranicza go do 8 MB / 5000
  komentarzy i dzieli na paczki Delivery po 200 wątków. Brak komentarza staje się
  tombstone tylko po pełnym, poprawnym odczycie. Źródło nie zwraca wersji designu
  ani czasu edycji: versionConfirmed pozostaje false, czas wykrytej edycji jest
  czasem obserwacji. UI i live są nadal w toku.
- Migracje wygenerowano, ale nie zastosowano. Niepowiązaną migrację/snapshot WMS
  wygenerowaną przy okazji usunięto z tej zmiany; snapshot Staff zawiera wyłącznie
  nowy scoped rejestr idempotencji.
