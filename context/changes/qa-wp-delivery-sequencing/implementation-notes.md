# Implementation notes

## Phase2 — coordinator

`prepare-theme.ts` is an internal compiled operator CLI and function; no public exports
or createSite v1 changes. One operation.lock spans preflight, controlled design apply,
asset bootstrap, actual compiler and byte verification. `buildOwnedTheme` keeps its
standalone wrapper, with internal `buildThemeWithinLock` for composition.

Private per-execution journal records last step and expected hashes. Component journals
retain before-images for explicit reconciliation. Error/crash retains the operation lock;
existing snapshot/start/stop wrappers refuse. No automatic lock stealing, database restore
or retry that could publish partially prepared content. Validated negative preconditions
may conservatively require reconciliation even before writes.

Recovery: first establish that the owning operator process is no longer running. Inspect
private preparation/component journals and actual hashes. Restore only journal-owned
managed files when current hashes match recorded post-images, or finish the verified
operation deliberately; never restore DB or overwrite user-edited files. Remove only that
owned lock after confirming a consistent state, then rerun with current expected hashes.
Unknown writes/ownership remain blocked. This is an operator procedure, not an automatic
force-unlock endpoint. Snapshots are unavailable while state remains uncertain.

`not_run`, fixture provenance and design approvalVerification:not_evaluated remain visible.
A successful local preparation is not browser acceptance, actual Figma approval or release.

## Resources and validation

### Second main update and disk recovery

After the host interruption, the user recovered about 30 GB on Windows and requested
continuation plus the new EXEC work. Main was fast-forwarded again to `68361d163`.
Five upstream QA files collided with local untracked suites; upstream keeps the original
filenames and the unchanged local suites now have `.qa-regression.spec.ts` suffixes.
Both coverage sets are retained. New discovery, rather than the historical 47-case
count or a broad old grep, determines the current test set.

The new EXEC widget used `const { t } = useT('delivery_agents')`, inconsistent with
the shared zero-argument hook returning a function. It now uses `const t = useT()`;
the corresponding spec example was corrected. Existing bridge fixes remain unchanged.

The interrupted next QA clone has intact source files but an incomplete dependency
copy. It must use the verified existing cache through explicit mounts, not the partial
copy or another full duplication. Private runtime monitors now check both memory and
Windows/WSL disk space. Disk startup requires at least 20 GiB available; heavy owned
work stops below 10 GiB. WordPress run7 has no completed report and requires scoped
fixture reconciliation; no PASS or cleanup is inferred from the machine restart.

### Integration checkpoint — 2026-09-19, 14:29 UTC

At the user's request, the workspace was fast-forwarded from `5d485ae5e` to
`92bcb813dac3c464ac9114b7acb9a8c80d8b0549`. All 504 other locally changed/untracked
files retained their pre-integration bytes. The two overlapping evidence command/test
files were backed up privately and merged: upstream lock-before-read/replay ordering
is retained together with the local latest-accepted-attempt guard. A second locked
read is unnecessary with the upstream ordering. Independent static review passed;
the merged evidence/results suites are the relevant regression check.

EXEC-04, OSS reporting/deployment decisions and FLOW-F1 domain code, plus UI-02–04,
now exist locally. Earlier statements that the executor is only a skeleton describe
the previous revision. Presence of those modules does not establish a working joint
flow: command-bus envelopes, trusted result acceptance, workflow parking and the
Cezar/OSS DTO boundary need integration checks.

The user's current execution window is 14:23–15:03 UTC: finish necessary implementation
first, then targeted checks. This is a scheduling limit, not an acceptance waiver.
The completed isolated app build belongs to the previous frozen source manifest;
it must not be relabelled as a build of the newly integrated main.

Q and WP use separate runtime windows. During OM build/HTTP the retained Studio site
stays stopped; WP code/unit work can continue. Package checks use local Node24 runner. Sandbox cannot execute nested
compiler reliably; matching isolated fixture checks run through approved host execution.
No production dependencies added. Historical source evidence remains unchanged.

After the user's request to accelerate delivery, Q reuses the frozen clone whose OSS
sources were compared with the workspace. The immediate path is `build:app` with
Next TypeScript checks enabled, then owned fresh-database bootstrap, API/DB sentinel
and HTTP regression. This does not pass the full ordered gate: its remaining steps
stay `not_run` for this path. The complete ordered gate belongs to the final integrated
revision. Evidence records the three WP browser additions absent from this Q clone.

## Phase3 — local update

`theme-update.ts` accepts bounded expected-hash replacements only under templates,
parts and source CSS/JS; no PHP, theme.json, compiled output, plugins or DB writes.
Existing applied design journal requires the same validated token export before any
update. Same updateId replays only when request/files/CSS match. New updateId must
make a real file change and runs the compiler, retaining the lock on uncertainty.
Native content/ACF/SEO/Global Styles retention requires separate readback/browser proof.

The browser fixture's page-template update is an intentional retained local theme
change, distinct from its temporary native content objects. Trusted private test config
must provide the expected page-template hash (null means absent); the helper may not
adopt the current file merely by hashing it. The second update uses the first verified
update's hash. A stale config must fail, preserving user edits and the operator's
before-image journal. Evidence distinguishes native fixture cleanup from intentionally
retained theme changes. This does not add a public rollback or silently restore DB.

Review fixed UTF-8 byte bounds, trailing control characters, final CSS verification,
and omission/mismatch of design tokens. Controlled design replay refreshes the private
applied journal's complete theme.json hash after acknowledged unrelated client edits.

## Phase5 — package and Preview boundary

Private packager captures inventory, plugins/vendor/runtime dependencies, media and
consistent SQLite backup; streaming and total-size bounds prevent unbounded memory.
Runtime version strings are operator-declared. wp-config/core are not copied, required
host configuration/runtime substitutions remain explicit. No public-content, licensing
or database-secret approval is inferred from a successful capture.

Readiness/reconcile reducer implementation is complete as a narrow independent seam,
but actual publication transport is not: Studio CLI only accepts a registered site,
while release approval binds a frozen package. This requires a reviewed host contract
and authenticated approval/evidence events. No fabricated deploy endpoint or remote
installation is introduced. Criterion5.2 remains incomplete until that integration.

## 2026-09-19 — przygotowanie E2E po ponownym review

WP-M02 otrzymał wewnętrzny mapper istniejących kontraktów, bez nowego API i bez
przejmowania hosta EXEC. 35 testy jednostkowe i wąski TS przeszły; trzy ustalenia
review (inventory vs modification scope, limit 200 referencji, limity raportów przed
hashowaniem) poprawiono i ponownie sprawdzono. Dowód: evidence/wp-result-mapper.json.
Nie włączono mappera do zamrożonego runnera QA, bo żaden produkcyjny route go jeszcze
nie wywołuje. Wyniki aplikacji odnoszą się do jej osobnego source manifestu.

QA-04 zaktualizowano pod istniejące workery. Wskazano kontrolowane reprodukcje REC02
(retry claimed job może ponowić run) i REC04 (crash po signal przed mark_delivery),
bez twierdzenia, że wykonano je live. Production DI nie wybiera fake executora przez
samą flagę DELIVERY_EXECUTOR=fake; konsumenci execute pozostają zatrzymani.

Build po main z enterprise wymagał 7168 MiB heap w 9 GiB kontenerze. Próba 6144 MiB
zakończyła się V8 OOM; następna przeszła pełny Next TypeScript bez pomijania kontroli.
Obie mają osobne logi. Przejście builda nie zalicza pominiętych wcześniejszych etapów
pełnego ordered gate ani testów HTTP. Kontrolowany bootstrap dotyczy wyłącznie
nowej własnej bazy qa_final, której tożsamość i 0 tabel potwierdzono przed inicjalizacją.

Pierwszy przebieg domenowy:43 PASS/39 FAIL/2 SKIP.39 błędów dotyczy wyłącznie
logowania przez hardcoded domyślne dane upstream helpera; minimalna poprawka
OM_INIT_ADMIN/EMPLOYEE przeszła3 regresje i root review. TC010 ma2 przypadki
wymagające rzeczywistego OSS-only registry i pozostaje not_run/profile w środowisku
z enterprise. Nie ustawiono fikcyjnej flagi verified i nie pomniejszono mianownika.
Wrapper pierwszej próby zatrzymał aplikację po red suite; kolejne uruchomienie
wykorzystuje ten sam build i DB. Dostępność URL wymaga świeżego probe po restarcie.

Drugie39/39 niepowodzeń logowania po poprawce helpera ujawniło oddzielną
rozbieżność inicjalizatora: CLI footer opisywał admin@domena-superadmina, podczas
gdy setup-app bez jawnego OM_INIT_ADMIN_EMAIL utworzył admin@acme.com. Effective
DEFAULT_CREDENTIALS zgadzały się z env; źródłem problemu był adres z footer.
Runner odczytał faktyczny adres z prywatnego rekordu Created user, zachował losowe
hasło i potwierdził bezpośrednie logowanie HTTP200 przed kolejnym retestem. Nie
zmieniano kont ani produkcyjnego inicjalizatora. Historia obu nieudanych prób pozostaje.


## Integracja OSS, EXEC i UI — 2026-09-19

Na jawne polecenie użytkownika pobrano `main` (`d403ca1f9`), `dev-mateusz`
(`a74cfe8ff`; zdalne `dev/mateusz` nie istnieje) i `feature/design-ui`
(`0b1cce284`). Lokalne merge mają HEAD `67aa2d1f8`; wszystkie trzy tipy są
jego przodkami. Nie wykonano push. Lokalna praca QA/WP została przywrócona;
zachowano awaryjny stash `d9e0e32c10b3a16a4bd0adc156ad685a0ccd9fd8`.

Konflikty DI/decyzji/harnessu i specyfikacji rozwiązano z zachowaniem obu
zestawów usług i bramek FLOW oraz candidate/context. Przy przywracaniu stash
zachowano mocniejsze asercje lokalnych TC002/004 i package-before-cancel TC006/007.
Nowy kod obejmuje raport/dowody, release candidates i FLOW-F1 routes.

Pierwszy lokalny przebieg całego modułu po merge: 2012 PASS /31 FAIL,
119 suites. Błędy ujawniły starsze fixture i oczekiwania wcześniejszych etapów;
nie są zaliczeniem runtime. Aktualizacja backendowych fixture zachowuje dokładne
kody odmowy, brak zapisu, scope i append-only. Osobny regression harnessu wybiera
najnowszą nominację oraz ignoruje obcą organizację. Review zmian backendu PASS.

Aplikacja pod portem5001 nadal używa starego builda68361d163. Generowanie rejestrów,
nowy build i HTTP po scaleniu pozostają niewykonane. Nowa migracja
`Migration20260919220000_delivery_os_release_candidates` dodaje tabelę nominacji
i trzy nullable kolumny decyzji; nie została zastosowana. Wyniki wcześniejszego
HTTP (74 unikalne PASS,10 FAIL,2 not_run/profile) nie opisują nowego HEAD.

Scalenie trzech gałęzi `67aa2d1f8` i poprawki integracyjne: pełny lokalny moduł OSS **120 suites /2044 testy PASS**. Review: `reviews/impl-review-team-merge.md`; dowód: `evidence/team-merge-unit.json`. Nowy build i live E2E pozostają osobną bramką.


## Wznowienie po merge i pamięć

Przed nowym buildem, po zatrzymaniu własnej aplikacji, odczyt Windows wynosił
około9GiB dostępnej pamięci. Poprzedni próg12GiB był progiem rozpoczęcia ciężkiego
builda, nie gwarantowaną pozostałą pamięcią w trakcie. Użytkownik najpierw dopuścił
8GiB, następnie polecił wstrzymać tę zmianę i wyjaśnić pomiar. Ciężki start pozostaje
wstrzymany do doprecyzowania; lekkie kroki mają osobny budżet i monitoring.
Zgoda użytkownika na jedną migrację release_candidates we własnej qa_final pozostaje
ważna; kontrola50rejestrów wykazała dokładnie jedną nową migrację. Prywatny backup
pg_dump16198453bajtów zweryfikowano pg_restore--list; hash
cfcd3f5aaa0e31a0cc60c8a0c82736b22de7acb8d6952ec8f70b534de0fce5be.


Po wykonanym przez użytkownika czyszczeniu cache: Linux buff/cache6.1→1.4GiB,
MemFree6.3→10.6GiB, Windows available~9→12.42GiB. Ciężki build nie działał w czasie
tego pomiaru. Po wyjaśnieniu i poleceniu „To działaj” przyjęto zmierzony próg startu
WSL11GiB/Windows12GiB, kontener9GiB/2CPU, heap7168MiB, stop WSL<3GiB lub
Windows<4GiB; dysk start20GiB/stop10GiB. Jeden ciężki proces naraz.
Migracja release_candidates zakończyła się PASS4.62s; po kontroli50historii tylko
oczekiwana migracja została dodana. Nowy gate zatrzymał się na i18n: sortowanie10
plików zachowało wszystkie wartości, a EXEC otrzymał4brakujące rzeczywiste locale.
Nowy przebieg na ponownie zamrożonych źródłach29fc1a50 zaczął od kroku1.

## Kończenie offline i przeniesienie ciężkiej walidacji

Użytkownik jawnie przeniósł pełny build i live OM na drugi komputer. Ostatni lokalny
pełny gate na freeze1484504e zakończył package build potwierdzonym OOM kontenera9GiB
(max_usage9663676416, oom_kill1). Globalny heap7168 był błędnie stosowany także do
package build. Przygotowany osobno runner rozdziela budżety per krok i serializuje
workspace/testy. Jego dry-run i review przeszły; pełne wykonanie pozostaje not_run.

Nie uruchamiano kolejnego OM. Pakiet WP przeszedł244testy bez skips i package TS.
Pierwsza próba tych samych testów w sandboxie odmówiła listenerów/child compiler;
prawidłowy host runner potwierdził cały zestaw. Receipt capture ma11testów i root
review PASS. Nowy handoff rozróżnia błędy EXEC, brak hosta Preview/designu i kontrole
wymagające wyłącznie uruchomienia na nowym komputerze. Nie podnosimy Progress za
samą obecność kodu ani historyczny PASS. Aplikacja QA jest zatrzymana; własna baza
z zatwierdzoną migracją i prywatnym backupem pozostaje zachowana.
