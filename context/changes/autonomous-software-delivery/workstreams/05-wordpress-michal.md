# Pakiet WP — własne narzędzia Studio i nowa witryna

**Decyzja użytkownika 2026-09-19:** własny pakiet `@open-mercato/delivery-wordpress` w OM, bez runtime, API, DB, kolejki, sesji i projektów starego ai-wordpress-orchestrator. Dawny wariant importu jego raportów jest **superseded**; źródła mogą pozostać referencją historyczną.

**Wykonawca dostępu:** Michał lub upoważniony agent. `WP-ACCESS` oznacza dostęp do Studio CLI i nowego dedykowanego katalogu witryny. Nie wymaga dostępu do starej sesji. Kod i testy z atrapami można wykonywać bez tego dostępu.

**Łączny limit: 6 osobogodzin wszystkich osób**, obejmujący readiness, narzędzia, debug, testy, wykonanie i dokumentację. Jest budżetem, nie zapewnieniem ukończenia WP-M01…03. Rezerwacje H0–2 i H22–26 nie tworzą dodatkowego etatu. Niezależne prace można wykonać wcześniej; zależne podłączenie nie blokuje ich wykonania. Po wyczerpaniu limitu przekazać faktyczny stan i braki.

## WP-M01 — Sprawdzić dostępność i kontrakt raportu [WP-ACCESS]

**Okno/nakład:** H0–2, maks. 2 h readiness w ramach wspólnego limitu. **Zależności:** Studio CLI, uprawnienie do utworzenia nowej witryny i własny katalog roboczy; bez przygotowanej starej witryny.

Szczegółowy plan WP-M01 oraz dalszych niezależnych prac znajduje się w [wordpress-studio-tools/plan.md](../../wordpress-studio-tools/plan.md). Kolejność: plan → review → implement → impl-review. Sprawdzić wersje i gotowość, opisać własny kontrakt narzędzi oraz manifestu. W pozostałym budżecie wdrożyć pakiet, realny lokalny caller, nową witrynę i motyw, baseline/snapshot, testy i przekazanie. Nie używać starego serwera, jego sekretów ani workerów; nie przerywać wcześniej autoryzowanych runów wyłącznie na potrzeby testu.

Manifest rozróżnia wykonanie narzędzia, host checks, rzeczywiste hashe plików i danych oraz nieprzeprowadzone kontrole. Fixture oznaczyć jako fixture; nie jest dowodem nowego AC. Lokalny smoke nowej witryny dowodzi samodzielności narzędzi, nie OM→WP E2E.

**Przekazanie:** `hackathon/delivery-demo/wordpress-reuse.md`, kontrakt pakietu, bezpieczne fixture i autentyczne dowody lokalnej próby, stan ready/blocked oraz warunek podłączenia OSS/enterprise. Progress 1.5 pozostaje historycznym identyfikatorem; nie zaliczać go samą aktualizacją planu.

## WP-M02 — Wykonać świeży PoC export/import [WP-ACCESS]

**Okno:** pierwotnie H22–26; wyłącznie w pozostałym budżecie 6 h. **Wejście:** gotowe API prób/evidence OSS, zatwierdzony baseline/pakiet targetu WP oraz podłączenie własnych narzędzi do wykonania enterprise. Jeśli zależności nie istnieją, przekazać gotowy interfejs i testy; PoC pozostaje niezaliczony.

Wyeksportować pakiet z OM, wykonać świeżą próbę przez własny adapter Studio i odebrać wynik w OM. Zachować korelację task/attempt/baseline/identyfikator operacji. Używać rzeczywistego commitu lub hasha snapshotu motywu i danych; nie wymyślać SHA. Partial/not_run/expired preview nie mogą stać się PASS/verified. Nie importować starych raportów jako ścieżki wykonania.

**Odbiór:** contract test i rzeczywista wymiana OM→WP→OM ze świeżym skorelowanym dowodem; część WP Progress 5.3 i 5.5. Samodzielne narzędzia, fixture i lokalna witryna nie zaliczają tego odbioru. Mapowanie i testy OSS nie wymagają prywatnej sesji Studio; cały nakład pozostaje w limicie WP.

## WP-M03 — Opcjonalne pełne E2E lub odtworzenie awarii [WP-ACCESS]

Tylko po działającym PoC, z dostępnym budżetem i bez zagrożenia Reacta. Publikacja jest odrębnym zakresem wymagającym autoryzowanego targetu. Świeży upload i verify desktop/mobile muszą dotyczyć zatwierdzonej rewizji; lokalna witryna nie dowodzi deploymentu. Brak bonusu nie blokuje odbioru PoC.

## Rejestr czasu i bezpieczne przekazanie

W `wordpress-reuse.md` zapisać zadanie, wykonawcę, czas aktywnej pracy, pozostały limit, hashe i wynik. Sekretów nie przenosić. Kod starego orchestratora pozostaje bez zmian; w OM commitować własny pakiet, bezpieczne fixture i dokumentację. Podłączenie domeny i enterprise jest jawnym kolejnym krokiem, zależnym od właścicieli tych powierzchni.

Źródłem kryteriów jest [plan główny](../plan.md), harmonogram zespołu opisuje [README](README.md). Przy przekazaniu podać commit, wersję kontraktu, testy i ograniczenia. Zachować istniejące tytuły Progress; zaznaczać odbiór dopiero po rzeczywistych dowodach.
