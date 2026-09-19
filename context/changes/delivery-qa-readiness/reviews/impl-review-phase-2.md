<!-- IMPL-REVIEW-REPORT -->
# Implementation Review — faza 2

- Plan: ../plan.md
- Scope: API ACL, scope, wersje, manifesty, wyścigi
- Date: 2026-09-19
- Verdict: APPROVED

## Ustalenia i decyzje

- F1 FIXED: nieoczekiwane udane mutacje i transport o niepewnym wyniku są rejestrowane przed parsowaniem body; cleanup nie może zgłosić sukcesu mimo nieznanych zapisów.
- F2 FIXED: równoległe rezerwacje używają allSettled i rejestrują udane efekty przed asercjami.
- F3 FIXED: not_started nie jest wartością stopConfirmation; test respektuje rzeczywisty model reconciliation.
- F4 FIXED: dodano limit 16 prób, stopped/replay cancel/nową próbę, malformed/oversized manifest, nieznany envelope attempt, selected-org i feature split.
- F5 FIXED: body/counts negatywnych wyników oraz odpowiedzi błędów są zapisywane przed asercjami.
- F6 PENDING: rzeczywisty wynik HTTP i liczników SQL. Unit helpera DB 17 PASS i TS7 nie zastępują SQL na bazie aplikacji.

## Granica dowodów

Nie wykonano commitu. Testy HTTP/DB muszą przejść w dedykowanym środowisku bez retry;
kompilacja i testy z atrapami nie zaliczają live ani FLOW-01…09. Wyniki operacyjne
i cleanup są odrębnymi dowodami. Niezależne analizy obejmują zgodność z planem
oraz bezpieczeństwo i istniejące wzorce.

## Korekta po pierwszym HTTP

TC001 ujawnił dwa błędne założenia testu, bez zmiany API:

- `lockProjectForWrite` / `lockTaskForWrite` używa `enforceRecordGoneIsConflict`:
  obcy lub brakujący rekord z poprawnym nagłówkiem wersji daje 409 i odbija tylko
  przekazany token w obu polach wersji. Bez nagłówka pozostaje 404. Macierz sprawdza
  teraz obie odpowiedzi oraz brak ujawnienia rzeczywistej wersji rekordu.
- Payload z obcym tenant/org jest odrzucany 403. Osobne pozytywne PUT z wildcard
  potwierdza dozwoloną mutację własnego projektu. Oba projekty są sprawdzane po odmowie.

To zachowanie istniejących guardów, nie odstępstwo bezpieczeństwa. Pierwszy raport
FAIL pozostaje zachowany; retest wymaga nowego dowodu dla poprawionego źródła.

## Końcowa weryfikacja HTTP

Automatyczne kryteria tej fazy zaliczone: końcowa wersja fixture 4/4, fazy 2–4
łącznie 45/45 unikalnych przypadków z pokryciem aktualnych źródeł (38 z pełnego
przebiegu + 7 z celowanego retestu zmienionych plików). To nie jest jeden bezbłędny
pierwszy przebieg: wcześniejsze błędy fixture zachowano w historii. Brak retry
Playwright, skip i flaky. [Aktualny manifest](../evidence/verification-current.json)
wiąże raporty, źródła i wynik cleanup. Nie jest to pełny gate repo ani live WordPress.
