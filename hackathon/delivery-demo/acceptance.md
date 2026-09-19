# Macierz odbioru QA delivery

Stan 2026-09-19: testy faz 1–4 zaimplementowane, wykonanie HTTP oczekuje na gotową aplikację.
Reguły recovery (44 PASS) i mapper WP (36 PASS) sprawdzone jednostkowo; nie są dowodem live.
Identyfikatory TC-DELIVERY-001…012 pochodzą ze spec OSS. Ta porcja implementuje
001…008 i 010 w granicach istniejącego R1–R19; 008 nie zalicza przyszłego R20.

## Statusy i kategorie

| Status | Znaczenie |
|---|---|
| passed | Wykonana kontrola spełniła oczekiwanie na zapisanej rewizji i poziomie dowodu |
| failed | Wykonana kontrola wykazała niezgodność; expected/actual i reprodukcja obowiązkowe |
| not_run | Kontrola znana, ale niewykonana albo narzędzie nie dostarczyło wiarygodnego pomiaru; podać reason |
| missing | Brakuje wymaganej implementacji testu, artefaktu, mapowania lub dowodu |

`blocked` jest przyczyną/zależnością, nie sukcesem ani zamiennikiem powyższych statusów.
`manual_pending` opisuje oczekujący odbiór człowieka. Awaria narzędzia to
not_run/tool_error; uruchomiony test wykrywający błąd to failed/product lub failed/test.
Oczekiwane 403/409 w teście negatywnym oznacza passed tego testu, nie awarię produktu.

## Zakres możliwy przed kolejnymi funkcjami

| ID / etap | Scenariusze i oczekiwania | Poziom docelowy | Parent Progress | Stan teraz |
|---|---|---|---|---|
| FIXTURE-001 / 1 | A/A1+A2 i B/B1; osobne ACL; częściowy setup; cleanup dwukrotny i retry; brak szkody dla obcych danych | HTTP fixture | 2.2 | HTTP PASS; dowód zbiorczy w indeksie |
| 001 / 2 | R1–R5: lista/detail/CRUD, 401/403, foreign tenant/org, pagination≤100, fresh/stale PUT/DELETE, aktywna próba blokuje archive | HTTP/DB | 2.2 | HTTP PASS; dowód zbiorczy w indeksie |
| 002 / 3 | R6–R7: oba inputMode, bytes/hash uploadu, brak AC/renderu, obce attachment, manual/requirements_proposal, replay, immutable baseline | HTTP/DB | 3.1–3.3, 3.6 | HTTP PASS; dowód zbiorczy w indeksie |
| 002 + 003 / 3 | R8 w 002: dwie decyzje, concurrent approve/reject, subjectHash/version; 003: requirements/plan proposals, replay, lock, DAG i negatywne manifesty | HTTP/DB | 2.2, 3.1–3.2 | HTTP PASS; dowód zbiorczy w indeksie |
| 003 + 004 / 2–3 | R9–R13: task CRUD/DAG/foreign refs/AC, plan_proposal, paths i AC→test, replay, stale lock, ready gate; PUT verified odrzucone | HTTP/DB | 2.1–2.2, 3.1, 3.6 | HTTP PASS; dowód zbiorczy w indeksie |
| 005 / 2 | R14–R15: 201/200/409 idempotency, concurrent reserve, single active/limit 16, automatic public odrzucone, GET nie zapisuje, unknown attempt | HTTP/DB | 2.1, 4.1 | HTTP PASS; dowód zbiorczy w indeksie |
| 006 / 2 | R16: 201/200 duplicate, inny hash 409, foreign scope/baseline/attempt/revision, schema/size/path/check failures, cancelled i concurrent import | HTTP/DB | 2.1–2.2, 4.1–4.2 | HTTP PASS; dowód zbiorczy w indeksie |
| 007 / 2 | R17–R18: feature split, stale/missing task lock, cancel, late result, unknown blocks reserve/archive, stopped/not_started/completed | HTTP/DB | 4.2, 4.6 częściowo | HTTP PASS; dowód zbiorczy w indeksie |
| 008 / 4 | R19: discriminator, hashes/revisions/test map, approved z proof, changes_requested/limit, duplicate review, manualCheck człowieka | HTTP/DB | 4.5 częściowo | HTTP PASS; dowód zbiorczy w indeksie |
| 010 / 4 | OSS-only: baseline+decisions→reserve→package→result→review→verified lub changes_requested→nowa próba; zależny task czeka | HTTP fixture | 2.3–2.4 częściowo, 6.2 częściowo | HTTP PASS; dowód zbiorczy w indeksie |
| REC-01…10 / 5 | Scenariusze awarii, liczniki i warunki live; istniejące executorFlow/reconcile/acProof tests | Dokument + unit fixture | 4.1–4.4, 4.7 częściowo | unit/mock 44 PASS; live not_run/dependency |
| WP-MAP / 6 | Snapshot/checks→OSS, korelacja, dwa snapshoty, hashe bytes, negatywne manifesty i brak fałszywego PASS | Unit fixture | 5.3 tylko część kontraktowa | unit fixture 36 PASS; live not_run/dependency |
| EVIDENCE / 7 | Raporty połączone z rewizją i przypadkiem, sanitizacja, wykaz braków i cleanup | Automaty + odbiór dokumentów | 6.1–6.3 częściowo | collector zaimplementowany; odbiór raportów HTTP oczekuje |

Dla R1–R19 obowiązuje wspólna macierz: unauthenticated, brak wymaganej feature,
uprawniony aktor, A1→A2, A1→B1 oraz odmowa bez zapisów. Oddziel test obcego record ID
(404) od niedozwolonego selected-org (422). Scope w body nie jest autorytatywny.
Przypadki rozdzielić na niezależne testy; nie kończyć pliku po pierwszej odmowie.

## Odbiory późniejsze — pozostają w mianowniku demo

| Zakres | Zależność | Stan |
|---|---|---|
| R20 deploy, R21 release, R22 report / TC-009 i reszta 008 | OSS-05 | missing implementation, not_run |
| UI obu wejść, live Figma / TC-011/012 | UI-02/03/04 i operator | not_run; UI-001 nie zastępuje tych flow |
| Prawdziwy restart, signal/retry/cancel procesu | EXEC-02/04 | missing executor, not_run |
| Nakładanie dwóch runów i odrębne worktree | Async queue/Redis, efektywna concurrency≥2, EXEC | not_run |
| Poprawka rzeczywistego kodu i pełne AC/skany finalnej rewizji | WordPress output + review + integracja; React pozostaje regresją | not_run |
| Świeży OM→WP→OM | Zatwierdzony TaskPackage, host, Studio/profile checks | not_run; standalone live report jest historyczny; cap WP zniesiony |
| Preview + publikacja/release | Osobne autoryzacje i target, aktualna verification URL/build | not_run |
| Pełny ordered gate i odbiór człowieka | Finalna rewizja i komplet implementacji | not_run |

Szczegółowy manifest wymaganych AC/test IDs zostaje przypięty do zatwierdzonego baseline
danego demo. Lista scenariuszy QA nie tworzy nowych AC aplikacji ani nie uzupełnia
automatycznie brakującej mapy requiredTests.

## Korekta odbioru: pełny flow WordPress

Obowiązuje [macierz FLOW-01…09 i zależności F0](../../context/changes/delivery-qa-readiness/flow-steering.md).
Regresje v1, fixture i lokalny snapshot nie zaliczają pełnego demo WordPress ani publikacji.
Scope/UX/KV/UI wymagają odrębnych zgód; dawny `design` ich nie zastępuje. Wszystkie
nowe FLOW pozostają w mianowniku odbioru, również przy brakujących API, hoście i celu publikacji.

## Doprecyzowania z main `5d485ae5e` — WP-01…05

Stan po synchronizacji 2026-09-19: wymagania poniżej nie są zaliczone przez wcześniejsze
49 wykonań HTTP ani mapper WP. Są obowiązkową częścią kolejnego F0/F4.

| ID | Zakres odbioru | Stan / brakujący dowód |
|---|---|---|
| WP-01 | Natywny motyw blokowy, Tailwind build z PHP/HTML/JS, małe moduły CSS/PHP, brak runtime CDN | częściowo: kompilator i enqueue zaimplementowane, gate pakietu187/187 PASS; zastosowanie CSS frontend/editor i docelowy scaffold wymagają dowodów browser |
| WP-02 | Zatwierdzony eksport tokenów Figmy → theme.json/Tailwind; deterministyczność, editor/frontend | mapper i kontrolowane zastosowanie fixture do lokalnego motywu PASS; rzeczywisty zatwierdzony eksport oraz zgodność edytora not_run/dependency |
| WP-03 | Aktywne i skonfigurowane Yoast SEO, ACF Pro, właściwa edycja Polylang; idempotencja | częściowy live PASS: ACF Pro 6.8.9, Polylang Free 3.8.9, Yoast SEO 28.5 aktywne; noindex i idempotencja PASS. Pełna konfiguracja/pola/SEO not_run |
| WP-04 | Redaktor zmienia tekst/media/CTA/sekcje/menu/header/footer/ACF/SEO bez kodu i builda | not_run/dependency: macierz ekran→blok/pole→edycja→test (jeden język) oraz świeża witryna |
| WP-05 | Treści, ACF i Global Styles przetrwają redeploy w jednym języku | redeploy not_run; tłumaczenia deferred_by_user poza demo, nie blocker ani PASS |

Brak licencji nie upoważnia do pominięcia wtyczki ani zakupu. `createSite v1` nie zmienia
po cichu kontraktu; rozszerzenie narzędzi wymaga jawnej delty. Studio Preview pozostaje
wybranym targetem. Szczegóły synchronizacji i kolejności: [main-sync](../../context/changes/delivery-qa-readiness/main-sync-2026-09-19.md).

Decyzja użytkownika: Polylang Free pozostaje, tłumaczenia są poza demo. WP-03 nie
wymaga konfiguracji drugiego języka, przełącznika ani reguł translate/copy ACF.

Aktualne lokalne dowody WP-03: [F0 manifest](../../context/changes/wordpress-demo-foundation/evidence/README.md).
Native content/post-meta replay nie zalicza ACF/SEO/browser WP-04 ani redeploy WP-05.
Preview otrzyma dopiero gotowy lokalny build/snapshot po kontrolach i wymaganej zgodzie;
nie instalujemy ani nie budujemy na zdalnym Preview.

Przygotowanie WP-01/02: [builder](../../context/changes/wordpress-local-theme-build/evidence/verification.json)
i [mapper](../../context/changes/wordpress-design-token-mapping/validation.json).
Łączny gate pakietu: 93/93 testy, typecheck/build PASS. To nie pełny build systemu OM.
