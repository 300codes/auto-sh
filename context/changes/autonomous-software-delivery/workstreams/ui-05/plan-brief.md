# UI-05 — Raport dowodów i decyzje wydania — Plan Brief

> [Pełny plan](plan.md) · [Zależności OSS](oss-dependencies.md) · [Opis UI-05](../03-design-ui.md)
> Kierunek: [dodatek produktowy](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md), WordPress E2E jako obowiązkowe demo.

## What & Why

Operator potrzebuje raportu, który łączy wymaganie, AC, zadanie, rewizję, test i deployment oraz pozwala sprawdzić źródło dowodu. UI-05 daje osobne miejsce do oceny wyników, zgody na publikację i końcowego odbioru, z jawnymi brakami i konfliktami wersji.

## Starting Point

GET raportu i POST deploy/release już działają; sekcja projektu pokazuje obecnie agregaty i niedostępność listy evidence. Brakuje API odczytu źródeł oraz podłączenia nowych etapowych bramek do raportu/decyzji — typ `report.flow` istnieje, lecz nie jest zwracany przez obecny endpoint.

## Desired End State

Operator otwiera osobną stronę raportu z projektu, sprawdza konkretny baseline i rewizję git/snapshot WP, przechodzi do dowodów i ogląda dostępne załączniki. Wydaje dwie oddzielne decyzje; podczas oczekiwania ekran sam odbiera dane publikacji/weryfikacji. Historyczny link jest oznaczony i tylko do odczytu.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Miejsce raportu | Osobna strona, podsumowanie/link w projekcie | Czytelne miejsce na dowody i decyzje | Użytkownik |
| Odczyt evidence | Zależność D1 od OSS | Zachowuje własność API/DTO | Użytkownik |
| Historia | Link z baseline i rewizją, bez mutacji | Stary wynik nie staje się bieżącą decyzją | Użytkownik |
| Źródłowy dowód | Rekord + dostępne pliki, jawny brak pliku | Raw report nie zawsze istnieje | Użytkownik |
| Odświeżanie | Polling podczas oczekiwania, tylko widoczna karta | Wynik zewnętrznej publikacji pojawia się sam | Użytkownik |
| Nowe flow | D2: projekcja i backendowe stage gates | Zielony v1 nie dowodzi pełnego WP odbioru | Kod + dodatek |
| Rewizja odbiorowa | D3: zaufany kandydat OSS/QA | Najnowszy wynik taska nie zastępuje finalnej integracji | Review + plan główny |
| Rejestr odbioru | Tylko główny Progress | README zabrania drugiej checklisty | README |

## Scope

**W zakresie:** nowy server route, małe client islands, traceability, szczegóły dowodów/screenshoty, statusy i blokery, polling, deploy/release, i18n, testy i handoff.

**Poza implementacją UI-05:** API/komendy OSS, wykonanie/publikacja WP, ingest/storage raw reports, etapowe approvals, Figma sync, Kanban i builder. Pozostają obowiązkowymi częściami szerszego procesu, nie są usunięte z zakresu demo.

## Architecture / Approach

`/backend/delivery/projects/[id]/report` konsumuje publiczny raport i projektowe updatedAt. `DataTable` pokazuje powiązania, dialog pobiera źródło na żądanie, dwa formularze zapisują decyzje przez guarded mutations i optimistic lock. Backend wylicza gotowość; frontend jej nie odtwarza. Polling co 5 s bez nakładających się requestów, z pauzą w ukrytej karcie i backoff przy błędach. Zmiana przedmiotu unieważnia otwartą decyzję.

## Phases at a Glance

| Faza | Rezultat | Główne ryzyko |
|---|---|---|
| 1. Strona i dane | Route, link, raport bieżący/historyczny, polling | Spóźniona odpowiedź lub zmiana scope |
| 2. Dowody | Traceability, źródłowe rekordy i załączniki | Brak D1 uniemożliwia pełny odbiór |
| 3. Decyzje | Oddzielne consent i release, blokery i konflikty | Zmiana wersji podczas otwartego formularza |
| 4. Weryfikacja | Integracja, build/hydration i przekazanie | Fixture nie zalicza rzeczywistego WP demo |

**Warunki:** istniejące API umożliwia start fazy 1; D1 wymagane do odbioru dowodów, D2 do nowych projektów flow, D3 do aprobaty rewizji odbiorowej. Testy funkcji powstają w ich fazach; faza 4 zbiera wyniki i sprawdza pełną ścieżkę.

**Szacunek:** 10–14 h pracy UI, bez backendu D1/D2/D3, oczekiwania i live demo. Historyczne 2 h nie jest aktualną wyceną; estymata nie upoważnia do przekroczenia budżetu zespołu.

## Open Risks & Assumptions

- D1 musi pozwolić również znaleźć screenshoty/review spoza report rows; sam GET po znanym ID nie wystarcza.
- D2 wymaga działającej projekcji i odmowy API przy starej/brakującej zgodzie. Brak pola `flow` nie dowodzi, że projekt jest legacy.
- D3 wskazuje finalną rewizję; brak wskazania blokuje aprobatę zamiast przyjmować „najnowszy wynik”. Preflight przy submit sprawdza też zmiany evidence bez zmiany updatedAt.
- Nie sprawdzano readiness bazy ani nie uruchamiano aplikacji podczas planowania. Brak środowiska pozostaje blockerem integracji.

## Success Criteria (Summary)

- Operator dociera od wymagania do właściwego testu, rewizji, URL i screenshotu; brak danych pozostaje widoczny.
- Publikacja i odbiór są osobnymi decyzjami; stary przedmiot, niezweryfikowany deployment lub brak wymaganych zgód nie przechodzą.
- Dowody UI wspierają 5.1/5.4 i FLOW-07. Pełny odbiór WordPress wymaga realnej publikacji oraz wszystkich FLOW-01…09/WP-01…05, nie samego UI.
