# UI-06 — Plan Brief

> [Pełny plan](plan.md) · [README strumieni](../README.md)
> [Aktualne wymagania](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md)

## What & Why

Domykamy klienta raportu UI-05 i stabilizujemy obsługę obu wejść, aby operator mógł przeprowadzić prawdziwe demo WordPress od briefu do publikacji i odbioru. Podczas prezentacji agent tworzy cały UX → Key Visual → DS/UI od zera, z osobnymi zgodami człowieka.

## Starting Point

Istnieją ekrany baseline, wykonania i raportu v1. Źródła dowodów oraz decyzje raportu pozostają zablokowane przez D1–D3 OSS; wcześniejsze handoffy nie potwierdzają integracji przeglądarkowych ani pełnego live odbioru.

## Desired End State

Operator otwiera źródłowe dowody i screenshoty, widzi aktualne bramki procesu i finalną rewizję, osobno zatwierdza publikację i odbiera zweryfikowane wdrożenie. Pełna próba oraz nowa prezentacja live mają własne artefakty, zgody i dowody. Brak danych, replay ani nieuruchomiony test nie dają PASS.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Domknięcie UI-05 | W UI-06, po dostawie D1–D3 | Jeden plan prowadzi raport do odbioru; backend pozostaje OSS | Użytkownik |
| Projekt demo | Nowy, fikcyjny klient | Powtarzalna próba bez danych klienta | Użytkownik |
| Drugie wejście | FROM_DESIGN do zatwierdzonego baseline | Pełne WP E2E dowodzi główny FROM_BRIEF | Użytkownik |
| Design live | Cały UX → KV → DS/UI od zera | Publiczność widzi pełną sekwencję i zgody | Użytkownik |
| Blokada | Częściowy live + jawny replay | Możliwa ocena fragmentu bez fałszywego pełnego odbioru | Użytkownik |
| Główny target | WordPress E2E | Aktualny dodatek ma pierwszeństwo nad React-first | Dodatek / README |
| Odbiór | Jeden kanoniczny Progress | Lokalne dokumenty nie zaliczają pracy innych strumieni | README |

## Scope

**W zakresie:**

- Źródła raportu, załączniki, flow gates, kandydat rewizji i formularze deploy/release.
- Potwierdzone poprawki UX, regresje i pełna próba procesu.
- Scenariusz fikcyjnej Pracowni Forma: mała witryna usługowa PL/EN, desktop/mobile.
- Cały design live, osobne zgody, demonstracja WP i przekazanie dowodów.

**Poza implementacją UI-06:** backend D1–D3, brakujące funkcje F0–F4, wykonawcy, provider komentarzy, narzędzia WP i nowy builder. Pozostają wymaganymi dostawami właścicieli przed pełnym demo.

## Architecture / Approach

Rozwijamy istniejące client islands raportu. OSS dostarcza D1 — odczyt evidence, D2 — projekcję i bramki nowego flow, D3 — wskazanie rewizji odbiorowej. UI konsumuje opublikowane kontrakty, zachowuje scope/ACL/optimistic locking i nie uruchamia publikacji przyciskiem zgody. Próba i prezentacja używają oddzielnych projektów; stare wyniki nie zaliczają nowego designu.

## Phases at a Glance

| Faza | Rezultat | Główne ryzyko |
|---|---|---|
| 1. Gotowość | Brief, role, scenariusz, przyjęcie dostaw | Dostępy i niegotowe API |
| 2. Domknięcie UI-05 | Źródła, aktualny kandydat, bezpieczne decyzje | Wyścigi wersji i niepełne bramki |
| 3. Stabilizacja i próba | Poprawki, regresje, pełna próba WP i FROM_DESIGN | Niewykonane kontrole i czas generacji |
| 4. Live i przekazanie | Cały design od zera, WP, raport i verdict | Dostępność usług i oczekiwanie na zgody |

**Warunki:** realne D1–D3, gotowe F0–F4, działające środowisko, dostęp Figmy/komentarzy, uzgodniony cel WP i obecny odbierający. Brak dostawy blokuje właściwy odbiór, lecz nie niezależne przygotowanie.

**Nakład:** orientacyjnie 16–24 h aktywnej pracy UI, bez dostaw innych strumieni i oczekiwania. Dawne 4 h nie wyceniają nowego zakresu. To estymata do kalibracji, nie zobowiązanie budżetowe; długość prezentacji wynika z pomiaru pełnej próby.

## Open Risks & Assumptions

- D1–D3 są nadal brakami w sprawdzonych call sites; typ/fixture nie dowodzi gotowego API.
- Nowy design live wymaga nowych zgód, wykonania i testów; poprzedni WP może być wyłącznie replay.
- Brak Figmy, komentarzy, licencji WP albo publikacji daje jawny blocker i niepełny odbiór.
- QA prowadzi wspólny gate/indeks dowodów; UI-06 nie przejmuje cudzych plików i kryteriów.

## Success Criteria (Summary)

- Oba wejścia mają aktualny zatwierdzony baseline; FROM_BRIEF kończy się realnym WP URL i osobnym odbiorem.
- Cały UX/KV/DS/UI powstaje od zera live, a raport wskazuje właściwe dowody, wersje i braki.
- Pełny PASS wymaga FLOW-01…09 i WP-01…05 oraz końcowej walidacji; częściowy pokaz ich nie zastępuje.
