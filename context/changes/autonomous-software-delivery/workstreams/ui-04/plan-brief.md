# UI-04 — Zadania, wykonanie i ręczne przekazanie — brief

> **Korekta kierunku — 2026-09-19:** [dodatek produktowy](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) i [pakiet dla Adama](../../flow-handoff/03-adam-ui-figma.md) mają **pierwszeństwo**. Ten plan powstał na ramowaniu sprzed korekty: wykonanie prowadzi task React, a dodatek czyni WordPress obowiązkowym E2E. Mechanika próby (rezerwacja → pakiet → wynik → cancel/reconcile) przenosi się na WP bez zmian, ale plan **nie zamyka żadnego FLOW** — wnosi wkład cząstkowy do FLOW-06, 09 i 04. Poza planem zostają: probe komentarzy Figmy, osobne bramki UX/KV/DS-UI, provider komentarzy i staff Kanban, ustawienia procesu, handoff tokenów do WP. Rozliczenie: sekcja „Pozycja wobec korekty kierunku" w [`plan.md`](plan.md).

> Pełny plan: [`plan.md`](plan.md)
> Strumień: [`../03-design-ui.md`](../03-design-ui.md) · Plan główny: [`../../plan.md`](../../plan.md) (Faza 4, Progress 4.3–4.6)
> Poprzednik: [`../ui-03/handoff.md`](../ui-03/handoff.md) · Harmonogram: [`../README.md`](../README.md)

## What & Why

Dać operatorowi w Open Mercato pełną ścieżkę ręcznego wykonania zadania: rezerwację próby, eksport pakietu dla Cezara, import wyniku z manifestu, anulowanie i uzgodnienie niepewnej próby. Bez tego zatwierdzony baseline nie ma jak stać się wykonanym zadaniem — Faza 4 planu głównego zakłada, że człowiek prowadzi run i widzi jego stan, a dziś `TasksSection` pokazuje wyłącznie liczbę prób.

Plan buduje **tylko platformę**. README mówi wprost, że „dwa taski generowane przez Cezara to demonstracja produktu. Cztery strumienie z tego katalogu budują samą platformę delivery. Ich zależności nie są tym samym grafem" — UI-04 jako jedyne zadanie Fazy 4 tego nie rozdzielało.

## Starting Point

UI-03 zostawiło detal projektu z baseline'ami, decyzjami i importem propozycji. **API OSS-04 jest już na tej gałęzi** (`47ca5acbf0`, `3d93b6af19`, `3a23d593bd`, `f735d5a154` i trzy inne): rezerwacja z `Idempotency-Key`, pakiet, import wyniku, cancel, reconcile — wraz z kompletem komend i 11 fixture'ami z katalogiem negatywnym. Zapis strumienia „realne komendy OSS-04 od H17" jest nieaktualny, dokładnie jak było z OSS-03 przy UI-03.

Po stronie UI nie ma nic: żadnego route'u zadania, żadnej akcji, żadnej prezentacji stanów próby, usage ani źródła `manual`/`adapter`. ACL **ma już** oba feature'y wykonania — brakuje wyłącznie gatingu. `DeliveryProjectDetailClient.tsx` ma 335 LOC i już łamie limit 300.

## Desired End State

Operator otwiera zadanie, widzi rejestr prób ze znacznikami czasu, rezerwuje próbę i kopiuje pakiet albo pobiera go jako plik. Uruchamia Cezara poza systemem, wraca i wkleja `ResultManifest v1` — widzi kontrole w trzech stanach, zmienione ścieżki, findingi, źródło i usage albo jawny brak danych. Na drugim zadaniu anuluje próbę: UI mówi, że **zażądano zatrzymania, a zatrzymanie nie jest potwierdzone**, i wskazuje uzgodnienie. Operator wybiera jedno z czterech rozstrzygnięć. Dwa zadania mają jednocześnie aktywne próby o nakładających się przedziałach — widać to w obu rejestrach. Żaden błąd nie kończy się cichym sukcesem, żaden brak danych nie udaje wyniku.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Granica zakresu | Tylko platforma OM; nadzór nad taskiem React to czynność operacyjna | README rozdziela dwa grafy, UI-04 jako jedyne zadanie Fazy 4 tego nie robiło; 4 h idzie w graf z mierzalnymi kryteriami i plikami pod własnością UI | Audyt README |
| Kryterium 4.4 | Dopisane jako współodbiór (4.3–4.6) | Mapa pokrycia przypisuje UI-04 cztery kryteria, opis deklarował trzy — jedyna niezgodność w całej Fazie 4 | README |
| Korekta kierunku | Sekcja rozliczenia jak w UI-03, mapowanie na FLOW-06/09/04 | `03-design-ui.md` (`add868171a`, 09:52) jest sprzed noty korekty (`00907224f1`, 11:34); mechanika próby przenosi się na WP bez zmian | Dodatek + git |
| Umiejscowienie UI | Nowy **server** page root `/…/tasks/[taskId]` z nazwanymi client islands | Host detalu ma 335 LOC i już łamie limit; akcje wykonania mają własne stany | Frontend Architecture Contract |
| Źródło usage | Echo z importu + formalna prośba do OSS o `GET evidence` | `api/` należy do OSS; czekanie na cudzy commit w oknie to niepokryte ryzyko — to samo rozstrzygnięcie co UI-03 dla importu designu | Plan |
| Klucz idempotencji | Pochodna `(taskId, baseRevision, attemptNumber)` | Powtórne kliknięcie trafia w istniejącą próbę i zwraca `200`, zamiast tworzyć drugą albo dawać mylący `409` | Plan |
| Reconcile | Wszystkie cztery rozstrzygnięcia, `completed` reużywa pola manifestu | Próba w `reconciliation_required` nie przyjmuje zwykłego importu — bez `completed` operator utyka bez wyjścia | Kod OSS |
| Import wyniku | Wklejenie JSON wzorem `ProposalImportDialog` | Wzorzec z UI-03 przeszedł wraz z testami; jedna konwencja dla wszystkich manifestów | Plan |
| Cancel | Nazwać `stop_unconfirmed`, wskazać reconcile, **nie** otwierać dialogu automatycznie | 4.6 zabrania obietnicy niepotwierdzonego zatrzymania; operator zwykle nie wie jeszcze, czy proces stanął | Plan |
| Dług LOC | Minimalna dekompozycja hosta poniżej 300 | Plan i tak musi ten plik dotknąć (link, gating) — pogłębianie naruszenia to słaba pozycja przy review | Plan |
| Poziom dowodu | Komponentowe + napisany, nieuruchomiony `TC-DELIVERY-UI-004` | Baza bez tabel `delivery_*`, `users` pusta, `db:migrate` wymaga zgody — stan identyczny jak przy UI-03 | Środowisko |
| Bramka | Jak w UI-03: `yarn test`, `lint`, `build:app` **pominięte** | Decyzja użytkownika; zapisana jako jawna luka, bo faza 1 rusza kod UI-02/03 | Użytkownik |

## Scope

**W zakresie:** server route detalu zadania z client islands; rejestr prób ze znacznikami czasu i sześcioma stanami; znacznik aktywnej próby i link na liście zadań; dekompozycja hosta poniżej 300 LOC; rezerwacja z pochodnym kluczem idempotencji; panel pakietu z kopiowaniem i pobraniem; import `ResultManifest v1` z podglądem i `details[]` jako listą; kontrole w trzech stanach, usage i źródło `manual`/`adapter`; anulowanie ze `stop_unconfirmed`; uzgodnienie z czterema rozstrzygnięciami; fixture stanów granicznych; klucze i18n w pięciu locale; `TC-DELIVERY-UI-004`.

**Poza zakresem:** nadzór nad taskiem React jako faza planu; endpointy `GET` dla evidence, manifestu i rejestru prób; filtrowanie i paginacja listy zadań; tryb `automatic`; osobny widok przebiegu obu runów; `EvidenceTable` i raport (UI-05); osobne bramki UX/KV/DS-UI, sync komentarzy Figma → Kanban, ustawienia procesu; wykonanie na realnym WordPressie; migracje i inicjalizacja bazy; przepisanie detalu projektu na server component.

## Architecture / Approach

Wszystko żyje w `delivery_os/backend/`, `components/`, `i18n/`, `lib/fixtures/` i `__integration__/` — granica wobec `api/`, `commands/` i `data/` pozostaje nietknięta i jest sprawdzana `git status` w każdej fazie.

Nowy server page root `/backend/delivery/projects/[id]/tasks/[taskId]` (bez `use client`) składa dziewięć nazwanych client islandów. Logika parsowania i decyzji żyje w czystych modułach — `attemptRegister.ts`, `attemptKey.ts`, `resultImport.ts` — nie w komponentach; ten sam zabieg trzymał `ProposalImportDialog` przy 293 LOC.

Przepływ: `GET /tasks/[id]` → rejestr z `TaskDto.executionAttempts` → `POST /tasks/[id]/attempts` z `Idempotency-Key` → `GET …/package?attemptId=` → `POST …/results` albo `…/cancel` → `…/reconcile`. `taskUpdatedAt` z odpowiedzi **każdego** endpointu idzie jako nagłówek następnej mutacji — sekwencja demo to kilka mutacji pod rząd, a refetch między nimi otwierałby okno na nieaktualną wersję.

Kolejność jest wymuszona przez domenę, nie wybrana: pakiet i wynik wymagają `attemptId`, a próba w `reconciliation_required` domyka się wyłącznie przez uzgodnienie.

## Phases at a Glance

| Faza | Co dostarcza | Główne ryzyko |
|---|---|---|
| 1. Route, rejestr prób, dekompozycja (~2 h) | Miejsce, w którym mieszka wykonanie; host schodzi poniżej 300 LOC | Dekompozycja rusza zatwierdzony kod UI-02/03, a pełna bramka jest pominięta — testy regresji są jedynym zabezpieczeniem |
| 2. Rezerwacja i eksport (~1,5 h) | Próba ma tożsamość, pakiet opuszcza system w obu układach | Zlanie `409 attempt_active` z `409 idempotency_conflict` w jeden komunikat |
| 3. Import wyniku, kontrole, usage (~2 h) | Wynik wraca z pełnym rozbiciem kontroli i zużycia | Pokazanie `not_run` jako przechodzącego albo `usage: 'unknown'` jako zera |
| 4. Cancel, reconcile, spec (~2,5 h) | Niepewna próba ma domknięcie; wykonywalny scenariusz całej ścieżki | Komunikat po cancel obiecujący zatrzymanie, którego system nie potwierdził |

**Warunki startu:** host OM z cechami `delivery_os.projects.view`, `.attempts.manage`, `.attempts.reconcile`, `.results.import`; projekt z aktywnym baseline i zadaniami w statusie `ready`.
**Nakład:** **~8 h** wobec nominalnych 4 h ze strumienia. To nowa estymata wymagana przez dodatek („dotychczasowe harmonogramy nie są estymatą nowego zakresu"), dotycząca **wyłącznie tego planu** — nie całego pakietu UI.

## Open Risks & Assumptions

- **Usage nie przeżywa reloadu.** Konsekwencja wyboru „echo z importu". UI mówi to wprost; milczenie czytałoby się jako „wynik nie podaje zużycia", co jest innym faktem. Kryterium 4.6 jest w tej części pokryte dla świeżego importu, nie dla historii.
- **4.4 i 4.5 powstają poza tym planem** — w repo React i w oknie QA-04 (H19–22) oraz przy merge OSS-04 (H20–22), podczas gdy okno UI-04 kończy się **H20**. Kto zbiera ten dowód po H20, wymaga uzgodnienia przed startem.
- **Pełna bramka pominięta na polecenie użytkownika.** Faza 1 modyfikuje `DeliveryProjectDetailClient.tsx` — regresji w sekcjach baseline nie wykryje ani test modułu, ani `typecheck`.
- **`TC-DELIVERY-UI-004` nie zostanie uruchomiony** — środowisko nie ma tabel `delivery_*` ani konta operatora.
- **Nakładanie się dwóch runów jest dowodem obserwacyjnym**; twardy dowód 4.3 leży w testach OSS-04/EXEC-04.
- **`allowedPaths` pochodzą z zatwierdzonego task DAG bramki H16**, nie z ad-hoc uzgodnienia przed spawn — UI je tylko pokazuje.

## Success Criteria (Summary)

- Operator przechodzi całą ścieżkę ręcznego przekazania w OM: rezerwacja → pakiet → wynik → poprawka → nowa próba, i widzi ją w rejestrze ze znacznikami czasu.
- Anulowanie nazywa `stop_unconfirmed` i nie obiecuje zatrzymania, którego system nie potwierdził; niepewna próba ma cztery drogi domknięcia.
- Nieaktualna wersja, wadliwy manifest, obcy `attemptId`, wyczerpany limit prób i trwająca próba dają pięć różnych komunikatów — żaden nie kończy się cichym sukcesem, a `not_run` i `usage: 'unknown'` nigdy nie stają się PASS ani zerem.
