<!-- IMPL-REVIEW-REPORT -->
# Implementation Review — faza 4

- Plan: ../plan.md
- Scope: OSS result → review → verified/poprawka
- Date: 2026-09-19
- Verdict: APPROVED

## Ustalenia i decyzje

- F1 FIXED: zależności blokują reserve, nie samo przejście draft→ready; test poprawiony zgodnie z istniejącym kontraktem.
- F2 FIXED: stare review wskazujące historyczny attempt mogło zmienić status po przyjęciu nowszego wyniku. Dodano kontrolę najnowszego wyniku i próby oraz ponowny odczyt po blokadzie; regresja obejmuje jednakową rewizję obu prób. Poprawny red: 4 odmowy nie zachodziły; green po kontroli replay pod blokadą: 66/66 PASS command+route. Bez zmian DTO/API. Dowód: ../evidence/phase-4/stale-review-regression.json.
- MATCH: failed/not_run/missing/wrong revision nie daje approved; manualCheck agenta odrzucony; limit korekt blokuje wykonanie.
- PENDING: runner ma udokumentować rzeczywisty rejestr modułów OSS-only, następnie HTTP ścieżek obu zakończeń i cleanup.

## Granica dowodów

Nie wykonano commitu. Testy HTTP/DB muszą przejść w dedykowanym środowisku bez retry;
kompilacja i testy z atrapami nie zaliczają live ani FLOW-01…09. Wyniki operacyjne
i cleanup są odrębnymi dowodami. Niezależne analizy obejmują zgodność z planem
oraz bezpieczeństwo i istniejące wzorce.

Naprawa usuwa wcześniejsze jawne oczekiwanie unit pozwalające na review historycznej
próby po nowszym wyniku. Jest to autoryzowana korekta zachowania, nie zmiana schematu
v1. Odmowa używa istniejącego `422 missing_required_tests`, detail `attempt_mismatch`.
Natychmiastowy identyczny replay nadal zwraca ten sam dowód. Ponowny odczyt replay
pod blokadą obsługuje też równoczesne identyczne review bez dodatkowego dowodu
lub zdarzenia; końcowy niezależny review nie wykrył blockerów.

Pierwszy HTTP: oba TC010 PASS. TC008 `manual_agent` błędnie używał domyślnego
buildera checks dla AC-003, które ma wyłącznie ręczny check; importer poprawnie odmówił
`unknown_test_id`. Fixture otrzymał pustą listę automatycznych checks, aby dojść do
właściwej asercji zakazu potwierdzania manualCheck przez agenta. Retest dotkniętego
pliku wymagany, produkt bez zmiany.

## Końcowa weryfikacja HTTP

Automatyczne kryteria tej fazy zaliczone: końcowa wersja fixture 4/4, fazy 2–4
łącznie 45/45 unikalnych przypadków z pokryciem aktualnych źródeł (38 z pełnego
przebiegu + 7 z celowanego retestu zmienionych plików). To nie jest jeden bezbłędny
pierwszy przebieg: wcześniejsze błędy fixture zachowano w historii. Brak retry
Playwright, skip i flaky. [Aktualny manifest](../evidence/verification-current.json)
wiąże raporty, źródła i wynik cleanup. Nie jest to pełny gate repo ani live WordPress.
