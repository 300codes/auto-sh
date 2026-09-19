# UI-06 — próba i zapis dowodów

Data przygotowania: 2026-09-19. **Próba nie została uruchomiona (`not_run`).**
Nie istnieje w tej sesji nowy projekt próby, zgoda, artefakt Figmy ani wdrożenie WP.
Materiał opisuje sposób wykonania [scenariusza](demo-scenario.md), nie wynik procesu.
Warunki rozpoczęcia i właścicieli blokad zawiera [readiness](readiness.md).
Jedynym rejestrem odbioru jest [Progress planu głównego](../../plan.md#progress).

## Rozdzielenie przebiegów

| Przebieg | Materiał wejściowy | Wynik wymagany | Stan na 2026-09-19 |
|---|---|---|---|
| Próba FROM_BRIEF | Nowy projekt Pracowni Forma, brief PL/EN | Pełny UX → KV → DS/UI → WP → QA → deploy → verify → release | `not_run`; zależności D1–D3 i F0–F4 nieprzyjęte |
| Próba FROM_DESIGN | Zatwierdzone artefakty powyższej próby, ręczne AC; oddzielny projekt | Aktualny zatwierdzony baseline, bez drugiego WP E2E | `not_run`; brak artefaktów próby |
| Prezentacja FROM_BRIEF | Kolejny nowy projekt i cały nowy design | Pełny proces live z własnymi zgodami i publikacją | `not_run`; brak gotowości próby i odbierającego |
| Replay | Wyłącznie istniejący, sprawdzony wcześniejszy przebieg | Widoczny napis „replay”, pierwotny project/run ref i czas | Nie wybrano materiału; nie zakładać, że wcześniejsze handoffy dowodzą WP |

Nie kopiować decyzji pomiędzy projektami. Snapshot z próby nie jest designem utworzonym
podczas prezentacji. FROM_DESIGN nie rekonstruuje wymagań ze screenshotu: operator
wprowadza zatwierdzone ręczne AC i importuje właściwe źródła. Jeśli projekt korzysta
z nowego flow, wymaga jego etapowych zgód, a nie obejścia decyzjami v1.

## Protokół wykonania

Operator przed startem zapisuje osoby pełniące role QA, wykonawcy WP, zatwierdzającego
Scope/UX, symulowanego klienta KV/DS/UI i końcowego odbierającego. Osoby mogą łączyć
role, ale dowód musi wskazywać rolę konkretnej decyzji. Nazwiska pozostają nieustalone;
nie wpisywać fikcyjnego podpisu klienta.

Próbę prowadzić w kolejności dziesięciu kroków [scenariusza](demo-scenario.md).
Po każdym etapie zachować rzeczywisty wynik i referencję do aktualnego przedmiotu.
Przed deploy ponownie odczytać projekt, raport i kandydata. Weryfikacja URL/build/snapshot
następuje po publikacji, release dopiero po tej weryfikacji. Nie uruchamiać publikacji
na podstawie samego kliknięcia zgody w kliencie raportu.

| Zdarzenie | Co operator zapisuje podczas rzeczywistego przebiegu |
|---|---|
| Początek/koniec | Czas ISO z offsetem, platform SHA, tryb `live` / `fixture` / `replay`, stanowisko i runner |
| Utworzenie projektu | Tenant/org refs, projectId, entry mode, template id/version/hash; bez tokenów sesji |
| Scope | Wersja/hash, wybrane WP/Figma i wykonawca, blokujące pytania, decyzja/aktor/czas |
| UX, KV, DS/UI | Stage/artifact id/version/hash, zależności upstream, Figma file/node/version, attachment refs |
| Render/poprawka | Capture manifest, ścieżka surowych bajtów, SHA-256, dimensions, capturedAt; zmiana bajtów po poprawce |
| Komentarze | File/thread/comment refs, cursor, staff task/comment refs i wynik retry; nie uznawać Done za approval |
| Zgoda klienta | Osoba, rola symulowanego klienta, dowód decyzji i dokładna wersja KV albo DS/UI |
| Wykonanie | Task/attempt/run refs, baseline/hash, `automatic` / `manual_handoff`, rzeczywiste usage albo `unknown` |
| Review/poprawka | Niezależny reviewer, finding, poprzednia i poprawiona sourceRevision, testy końcowej wersji |
| Kandydat | ID/version wskazania D3, sourceRevision, baseline/hash, aktualne evidence i gate |
| Publikacja | Zgoda deploy i jej przedmiot, uzgodniony target, URL/build/snapshot, deploymentEvidenceId, wynik verify |
| Odbiór | Oddzielny release verdict, aktor/czas/powód, niewykonane wymagania i końcowy verdict odbierającego |

Git SHA platformy i sourceRevision strony to różne dane. WP może używać
`snapshot` z contentHash i externalWorkspaceId; nie przypisywać mu fikcyjnego commitSha.
Przy każdym pliku dowodowym zapisać hash **z zachowanych bajtów**, nie z opisu lub nazwy.
Nie wpisywać hashów, URL ani identyfikatorów zanim artefakt faktycznie powstanie.

## Pomiar czasu

Pomiar nie został wykonany. Podczas próby zapisać start/koniec każdego etapu, osobno czas
generacji, poprawki, oczekiwania na API, człowieka i blokady. Całkowity czas mierzyć
od utworzenia projektu do końcowego verdictu; okresów równoległych nie sumować podwójnie.
Termin prezentacji wyznaczyć po pomiarze pełnej próby, nie na podstawie historycznych 4 h UI-06.

## Obsługa przerwania

Przy braku dostępu lub zależności zapisać ostatni potwierdzony etap, przedmiot,
czas, błąd, właściciela i warunek wznowienia. Następne etapy pozostają `blocked`/`not_run`.
Timeout POST decyzji wymaga odczytu historii i wersji; nie ponawiać append-only zapisu
w ciemno. `unknown`/`stop_unconfirmed` wymaga reconcile przed nową próbą.

Zmiana Scope/UX/KV/UI lub kandydata unieważnia przegląd zależnych przedmiotów. Zachować
historię, uzyskać nowe wymagane zgody i ponownie wykonać kontrole dotkniętej rewizji.
Stare testy nie stają się dowodem aktualnego WP. Oznaczony replay może objaśnić brakujący
fragment, ale nie zamyka live FLOW/WP ani kryterium pełnego designu od zera.

## Wyniki bieżącej sesji

| Kontrola | Wynik | Powód / dalszy właściciel |
|---|---|---|
| Testy TC-DELIVERY-UI-003/004/005 | `not_run` | Użytkownik dopuścił tylko nowe testy lub TS nowych plików; istniejące zestawy pozostają dla QA |
| Pełny gate, lint, build/bundle, hydration | `not_run` | Ograniczenie bieżącej sesji; brak deklaracji PASS |
| Live Figma write/read/render i komentarze | `not_run` | Brak aktualnego stanowiska, projektu i dowodu sesji |
| WP i zgodność wersji/licencji | `not_run` | WP/QA muszą dostarczyć cel, macierz wersji i dowody |
| Publikacja, verify, release | `blocked` | Nieprzyjęte D2/D3, brak aktualnego kandydata i uzgodnionego celu |
| Desktop/mobile, klawiatura, źródła | `not_run` | Do wykonania z QA na działającej integracji |
| FLOW-01…09 / WP-01…05 | Nieodebrane | Brak pełnej próby i potwierdzenia człowieka |

QA otrzymuje wynik do kanonicznego indeksu według [handoffu](handoff.md).
Nie utworzono drugiej checklisty ani raportu udającego wykonanie testów.
