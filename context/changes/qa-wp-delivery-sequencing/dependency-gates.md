# Zależności integracji — 2026-09-19

Cap WP zniesiony. Poniższe zależności nie zatrzymują niezależnej implementacji.

Aktualizacja po merge: HEAD `67aa2d1f8` obejmuje OSS `dev-mateusz` (`a74cfe8ff`),
EXEC/main (`d403ca1f9`) oraz UI `feature/design-ui` (`0b1cce284`). Pełny lokalny
moduł OSS ma120suites/2044testy PASS; nie jest to odbiór nowego runtime.
Nowe UI dotyczy backoffice OM, nie zatwierdzonego designu witryny WP.
Rzeczywisty probe styku EXEC/Cezar odrzuca poprawny OSS TaskPackage w15polach;
mapper workera rzuca błąd baselineHash przed importem wyniku. Szczegóły i komenda:
[evidence/exec-merged-seam-probe.json](evidence/exec-merged-seam-probe.json).

| Gate | Stan | Właściciel / wymagany artefakt | Warunek odblokowania |
|---|---|---|---|
| G0 źródła/QA | Historyczny683build i HTTP:74unikalne PASS/10FAIL/2not_run-profile. Nowe67aa źródła mają2044unit PASS; nowy build/migracja/HTTP w toku | QA: izolowane źródła, descriptor, API sentinel i jawny DATABASE_URL | Własność i zgodność API/DB potwierdzona, raporty z aktualnym manifestem |
| G1 DS/UI | missing | Strumień designu: rzeczywisty eksport tokenów, font assets, revision i zatwierdzona decyzja UI | Spójny pakiet wejściowy; fixture nie stanowi akceptacji |
| G2 redaktor | native capability i browser run8 PASS; odbiór człowieka pending | WP: proponowany dedykowany actor z prawami treści, mediów i edit_theme_options; właściciel produktu odbiera zakres | Pełne testy zapisu edycji + odmowa administracji; brak automatycznego administratora |
| G3 EXEC | kod dostępny, integracja nieodebrana | EXEC-04: execute API, worker/bridge, park/signal/recovery; poprawki styku command bus, trusted acceptance i park gate mają 11 regresji PASS | Prawidłowe DTO OSS/Cezar, rzeczywisty workspace WP, potwierdzony park i pojedyncze wykonanie |
| G3 OSS stages | domena i komendy FLOW-F1 dostępne | OSS: intake, pin flow, create_artifact, decide; report i decyzje deploy/release istnieją | Trasy FLOW-F1 i raport/kandydaci UI-06 są scalone; wymagane nowe kontrole HTTP po migracji i generowaniu |
| G3 cancel | nowa ścieżka kodowa wymaga sprawdzenia | Worker EXEC próbuje reconcile stopped zamiast importu cancelled; istniejący TC007 zachowany | Zgodność payloadu reconcile z OSS i rzeczywisty stop procesu, bez traktowania żądania jako potwierdzenia |
| G4 RC | not_run | Integrator: pełny ordered gate + komplet AC, pakiet i source hashes | Wszystkie wymagane kontrole finalnej rewizji i brak niepewnych mutacji |
| G5 Preview | awaiting RC | Człowiek/backend: dokładny target i revision approval | Konkretny gotowy kandydat do zgody; brak uploadu w fazie przygotowania |

REC01–10 live i OM→WP→OM pozostają niezaliczone do sprawdzenia G3. Brak sprawdzenia wynikowego
workspace w obecnym OSS pozostaje oddzielnym przekazaniem do właściciela. Mapper WP
musi odrzucić obcy workspace już teraz. Brak designu nie blokuje bezpiecznego kodu
na fixture; brak EXEC nie blokuje lokalnego pakietu i wewnętrznego adaptera Preview.
