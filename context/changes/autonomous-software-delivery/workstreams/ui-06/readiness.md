# UI-06 — fakty i warunki uruchomienia

## Najnowsze ustalenia — 2026-09-19

Figma: ponowione `whoami` potwierdziło tożsamość i seat Full; wcześniejszy
USER_NOT_LOGGED_IN nie jest już aktualnym stanem konektora. Read/write/comments
wymagają osobnych prób. WP Studio niedostępne: na polecenie użytkownika host,
Preview i odbiór live WP pozostają odroczone jako
[specyfikacja](../../../../../.ai/specs/2026-09-19-wordpress-studio-tools.md#aktualny-zakres--brak-wp-studio),
bez zaliczenia kryteriów WP. Pozostałe prace kontynuujemy.

## Aktualizacja z implementacji UI completeness — 2026-09-19

Probe 17:21–17:25 UTC w aktualnej sesji Codex: runner **local**, brak app w dev
compose, full compose wymaga JWT_SECRET; `.ai/qa/ephemeral-env.json` absent.
OM `127.0.0.1:3000` i WP `127.0.0.1:8884`: curl exit 7 / HTTP 000. To nie
wyklucza innych endpointów. Figma whoami i metadata historycznego node 3:2:
`USER_NOT_LOGGED_IN` / connector not connected; write/render/comments not_run.
Migracje, aktywne moduły i scoped login niepotwierdzone; niczego nie migrowano.

Node shell 26.5.1, Yarn 4.17.1, PHP CLI 8.3.6; Studio/wp brak w PATH. Dostępny
Node 24.13.0 jest używany do weryfikacji pakietu WP. Wersje hosta/wtyczek/licencje,
target publikacji i osoby odbierające nadal wymagają przekazania.

Nowy plan dopuszcza testy fazowe i pełny gate końcowy; historyczne ograniczenie
„tylko nowe testy” poniżej dotyczy wyłącznie poprzedniej sesji UI-06. Inwentarz
znalazł F1/F2/F4 i WP na innych refs; są integrowane zamiast odtwarzania.
Aktualne fakty i wyniki prowadzi [handoff UI completeness](../ui-completeness/handoff.md).
Nie zmienia to manualnych verdictów ani statusu próby live.

Data: 2026-09-19. To zestawienie dostaw i blockerów, bez zaliczania kryteriów. [Scenariusz](demo-scenario.md), [plan](plan.md), [D1–D3 właściciela potrzeb](../ui-05/oss-dependencies.md), [pakiet zespołu](../../flow-handoff/README.md). Stan odbioru pozostaje w [Progress planu głównego](../../plan.md#progress) oraz przyszłym indeksie QA.

## Podstawa i granice weryfikacji

Pierwszy audyt na HEAD `42d14310679a9cc843eceae76497e06b22bddff7` wykazał luki D1–D3. Po poleceniu użytkownika zaimplementowano ich backend i integrację raportu w tym checkoutcie. Dowód kodu i nowych testów nie stanowi próby działającego API ani odbioru live. Nie sprawdzono bazy, sesji operatora, rzeczywistego celu WP ani usług Figmy. Historyczne readiness nie potwierdza ich bieżącego działania i nie dowodzi również ich niedostępności.

Zgodnie z instrukcją użytkownika w tym zadaniu pominięto kompleksowe uruchamianie testów. Pełny gate, integracje, build, smoke przeglądarkowy oraz live są **not_run**, a nie PASS. Dopuszczony zakres obejmuje tylko bezpośrednio nowe testy lub kontrolę TS nowych plików; konkretne wykonane polecenia i wyniki zapisuje [handoff](handoff.md). Uruchomiono bezpośrednio nowe testy; wyniki i polecenia zawiera handoff.

Runner wybrany przez audyt główny: **local**. `DOCKER_COMPOSE_FILE` nieustawiony, brak override; probe dev compose `ps app` zakończył się 0 z pustym wynikiem, full compose zakończył się 1 z brakującym `JWT_SECRET`. To wynik wykrywania runnera, nie diagnoza bazy. `.ai/qa/ephemeral-env.json` nie istnieje; nie ma potwierdzonego środowiska do reuse. Nie uruchamiano nowej instancji i nie aplikowano migracji.

## Dostawy do przyjęcia

W kolumnie commit wpisujemy wyłącznie rzeczywiście ustaloną rewizję. „Brak przekazania” oznacza brak dowodu w tym zadaniu; nie dowodzi nieistnienia pracy w innym branchu. Wersja schema/profile/fixture, endpoint, wyniki dostawcy i ograniczenia muszą zostać dostarczone razem.

| Dostawa / owner | Commit; schema/profile/fixture | Wynik testów i dowód | Ograniczenie / stan | Warunek odblokowania |
|---|---|---|---|---|
| D1 — OSS / UI | Bieżący commit dostawy; `lib/evidenceReadContracts.ts` | Scoped GET list/detail/attachments i konsumpcja przez źródła/dialog raportu; nowe testy dostawcy | **implemented**, runtime/live nieodebrane | QA uruchamia nową integrację na działającej instancji i potwierdza dostęp do rzeczywistych bytes |
| D2 — OSS / UI | Bieżący commit dostawy; `lib/reportContracts.ts` | Projekcja `mode`/`flow`, bramki etapowe komendy deploy/release i ich prezentacja | **implemented**, pełny FLOW/WP nadal nieodebrany | QA potwierdza realny flow i komplet pozostałych dostaw F0–F4 |
| D3 — OSS / UI + QA | Bieżący commit dostawy; `releaseCandidateSchema` | Jawna nominacja i odczyt kandydata; raport przypięty do wersji; preflight oraz kontrola hash/id/version decyzji | **implemented**, test integracyjny live nieuruchomiony | QA nominuje rzeczywistą rewizję i przechodzi kandydat → consent → publish → verify → release |
| F0 — Mateusz + pozostali właściciele | Brak kompletnego handoffu SHA/schema/fixture | [Podział F0](../../flow-handoff/README.md); testy dostawcy nieprzekazane | **blocked do współodbioru**, nie samym istnieniem typów | Przyjęte kontrakty, fixture, dokładne endpointy, BC review, rzeczywiste probe, estymaty i nazwy właścicieli |
| F1 — Mateusz / Adam / Marcin | Brak przyjętego kompletu wersji | FLOW-01/02/09 nie wykonywano w UI-06 | **blocked do próby** | API/UI portfolio i resume brief, agent scoping, wybór WP/Figma oraz osobne wersjonowane Scope/UX/KV/UI approvals, test obejścia starym API |
| F2 — Adam / Mateusz | Brak aktualnych artifact refs i wersji providera | FLOW-03/04 i WP-02 not_run | **blocked do próby** | Nowy design, realny komentarz/odpowiedź → staff, idempotencja retry, Done bez approval, token mapping i macierz edycji |
| F3 — Marcin / Adam | Brak przyjętego template/version handoffu | FLOW-05/08 not_run | **blocked do próby** | Działający istniejący Workflows Studio z ustawień; zmiana grafu i warunku, v2 dla nowego projektu, v1 dla starego po restarcie |
| F4 — Marcin / Michał / QA | Brak przyjętego snapshotu strony i profilu pełnego odbioru | FLOW-06/07 i WP-01…05 not_run | **blocked do próby** | Nowa witryna, review i rzeczywista poprawka, testy końcowej rewizji, aktualne zgody, publikacja i verify URL, osobny release |

Pierwszy audyt rozpoznawał częściowe dostawy F1. Aktualna dostawa D2 integruje `buildDeliveryReportFlowSection` z raportem i komendami decyzji. Nie zalicza to automatycznie kompletnego F1/F2, komentarzy Figmy, Workflows Studio ani WP. Historyczne braki raportu zostały usunięte; pozostałe strumienie nadal wymagają własnych dowodów.

D1–D3 są już rzeczywistymi call sites, a nie klientowymi atrapami. Brak kandydata, brakujące zgody i nieaktualne dane pozostawiają decyzję niedostępną. Nominację wykonuje jawny kontrakt backendu, nie selektor dowolnej rewizji w UI. Podgląd latest-result nie staje się automatycznie kandydatem.

## Stanowisko i usługi

| Obszar / owner | Commit / wersja / dowód | Wynik i ograniczenia | Warunek przed uruchomieniem |
|---|---|---|---|
| Figma write / Adam | [Historyczne UI-01](../../../../../hackathon/delivery-demo/figma-readiness.md), 2026-09-19T07:44:17Z; nie bieżąca sesja UI-06 | historyczny ready; aktualny probe **not_run** | Potwierdzić tożsamość, seat, prawo edycji nowego pliku i rzeczywiste write na stanowisku próby |
| Figma read/render / Adam | Historyczny manifest UI-01; capture schemaVersion 1 | historyczne rendery istnieją; aktualny read/render **not_run** | Wykonać odczyt właściwego nowego node/version, natychmiast utrwalić PNG/bytes/hash w osobnym katalogu; sprawdzić aktualne limity na stanowisku |
| Figma real comments / Adam + Mateusz | Brak probe aktualnego połączenia/providera | **blocked do potwierdzenia**; write MCP nie dowodzi comments API | Realny thread i odpowiedź, poprawna tożsamość źródła, jedna karta staff, retry bez duplikacji i czytelny błąd/cursor |
| Sesja operatora / Adam | Nieprzekazana bezpieczna informacja o sesji | **not_run**; nie odczytywano poświadczeń | Logowanie do właściwego tenant/org; uprawnienia view/decisions/execution zgodne z rolą, wygaszenie i ponowne logowanie bez utraty scope |
| Symulowany klient i odbierający / zespół | Brak imienia osoby i potwierdzonej obecności | **blocked dla manualnych decyzji** | Wskazać osoby; zapisywać symulację, autora/czas/dowód każdej decyzji; bez pozorowania rzeczywistego klienta |
| Środowisko QA / QA + EXEC | `.ai/qa/ephemeral-env.json` absent; runner local | Probe compose opisany wyżej; baza i serwer **niebadane** | Wskazać istniejącą instancję, bezpieczne endpoint refs, SHA i wynik health/login; brak migracji zgłosić właścicielowi, nie aplikować bez osobnej zgody |
| Moduły i ACL / OSS + EXEC + QA | Brak potwierdzonej listy aktywnych modułów na runtime | **not_run** | Potwierdzić delivery_os, potrzebne staff/workflows/integracje i wykonawcę; test izolacji dwóch tenant/org, oddzielne/wildcard ACL, OSS-only |
| Cel publikacji WP / Michał | URL/targetRef nieuzgodnione w UI-06 | **blocked dla publikacji**; brak wymyślonego URL | Uzgodniony cel, dostęp i bezpieczny targetRef; osobna decyzja publikacji konkretnej rewizji dopiero po gate |
| WP/PHP / Michał | Wersje nieprzekazane | **blocked do potwierdzenia zgodności** | Rzeczywiste wersje hosta, WP i PHP oraz wspierana macierz pluginów/narzędzi i wynik próby instalacji |
| Tailwind/theme.json / Michał + Adam | Wersje compiler/schema nieprzekazane | WP-01/02 **not_run** | Build lokalnych stylów bez runtime CDN; schema theme.json, deterministyczny mapping tokenów, małe CSS/PHP i review natywnych API |
| Yoast SEO / Michał | Wersja/edycja nieprzekazana | WP-03 **not_run** | Potwierdzić zgodną aktywną wersję/edycję i konfigurację, retry bez resetu |
| ACF Pro / Michał | Wersja i uprawnienie licencyjne niepotwierdzone | **blocked do potwierdzenia** | Potwierdzić dostęp do wymaganej licencji i zgodną aktywną wersję bez zapisu klucza; brak licencji blokuje wymaganie |
| Polylang / Michał | Wersja/edycja i zgodność ACF nieprzekazane | WP-03/05 **not_run** | Potwierdzić wymaganą edycję, prawa do niej i zgodność z ACF; tłumaczenia stron/pól/menu i zachowanie po redeploy |
| Media demonstracyjne / Adam | Brak plików i hashów | **blocked do dostawy** | Obrazy o znanym pochodzeniu z warunkami wykorzystania, alt PL/EN, bytes/hash; szczegóły w scenariuszu |
| QA runbook i indeks / Michał + autorzy | Oczekiwane `hackathon/delivery-demo/{runbook,acceptance,evidence-index}.md`; obecnie nie istnieją | Brak kanonicznego zapisu wyników live | QA tworzy/uzupełnia wspólne dokumenty z dostarczonej propozycji scenariusza; jedna wskazana osoba aktualizuje Progress |

## Warunki pełnej próby i demonstracji

Pełna próba wymaga przyjętych D1–D3, F0–F4, aktualnych dostępów, odbierającego oraz zgodnego celu WP. Przed startem zapisać SHA platformy, wersje kontraktów/profili/fixture i rzeczywiste project/run/artifact refs. Projekt próby, nowy projekt live i FROM_DESIGN muszą mieć rozdzielone identyfikatory. Zatwierdzenia historyczne nie przechodzą na nowy design.

Wynik pełnego gate w tej sesji pozostaje **not_run na polecenie użytkownika**. To nie zmienia kryteriów późniejszego odbioru przez QA. QA dostarcza wynik końcowej rewizji i odpowiada za pełny gate, tenant/org/ACL, stale approvals, duplicate/restart/manual_handoff, brak skanu, niezweryfikowany deployment oraz FLOW/WP. Nie deklarować PASS przed dostawą tych wyników; stary wynik po poprawce pozostaje historyczny.

Podczas próby mierzyć generowanie UX/KV/DS/UI, oczekiwanie na człowieka, wykonanie WP, poprawkę, QA i publikację osobno. Po próbie dopiero ustalić czas prezentacji. Jeśli bramka nie przechodzi, zapisać właściciela, stan blocked/not_run i aktualny etap; dostępny fragment live oraz jawny replay nie zamykają pełnego odbioru.

## Źródła i przekazanie

Przeczytano pełny [plan UI-06](plan.md), [plan-brief](plan-brief.md), [README strumieni](../README.md), [dodatek produktu](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md), [README zespołu](../../flow-handoff/README.md), [pakiet UI/Figma](../../flow-handoff/03-adam-ui-figma.md), [D1–D3](../ui-05/oss-dependencies.md), [historyczny handoff UI-01](../../../../../hackathon/delivery-demo/figma-readiness.md) oraz bieżące skrypty [capture](../../../../../hackathon/delivery-demo/evidence/figma/capture.sh) i [verify](../../../../../hackathon/delivery-demo/evidence/figma/verify.sh). Handoff UI-01 znajduje się w `hackathon/delivery-demo/figma-readiness.md`; `workstreams/ui-01/handoff.md` nie istnieje.

Bieżąca dostawa obejmuje kod D1–D3, integrację UI, nowe testy i aktualizację materiałów. Nie zapisano decyzji człowieka ani nie wykonano publikacji; implementacja nie zmienia stanu manualnego odbioru pozostałych faz.
