# Pakiet WP — Michał, wymagany dostęp do ai-wordpress-orchestrator

**Wykonawca: Michał.** Wszystkie poniższe zadania oznaczone `WP-ACCESS` wymagają dostępu do `/var/www/html/ai-tools/ai-wordpress-orchestrator`, jego lokalnej sesji lub witryny Studio. Nie delegować ich osobie posiadającej tylko checkout OM.

**Łączny limit: 6 osobogodzin wszystkich osób**, obejmujący readiness, debug, eksport, import/normalizację, testy i ewentualny bonus. Dwie godziny H0–2 i do czterech H22–26 są rezerwacją zespołu, nie dodatkowym piątym etatem. Michał może przejąć cały strumień QA albo tylko pakiet WP. Przy wyborze innego strumienia zastosować zamianę opisaną w harmonogramie.

## WP-M01 — Sprawdzić dostępność i kontrakt raportu [WP-ACCESS]

**Okno/nakład:** H0–2, maks. 2 h. **Zależności:** przygotowana lokalna witryna i istniejąca sesja Michała; równolegle do OSS-01, EXEC-01 i UI-01.

Sprawdzić aktualne API startu/reportu i Studio preview, bez modyfikowania kodu orchestratora, odczytu plików sekretów i otwierania prywatnego serwera na sieć. Zapisać wersję/stan oraz świeżość dostępnych dowodów. Historyczne wygasłe preview nie jest aktualnym sukcesem.

Przygotować zanonimizowany przykład raportu z polami potrzebnymi importerowi: run ID, rewizja/snapshot, host checks, statusy, hashe artefaktów i sposób korelacji. Usunąć tokeny, cookies, prywatne dane i podpisane URL; sekretów nie commitować. Fixture oznaczyć jako fixture, nie dowód zaliczenia nowego AC.

**Przekazanie H3:** `hackathon/delivery-demo/wordpress-reuse.md`, bezpieczny fixture w `adapters/wordpress/fixtures/`, stan ready/blocked i dokładny warunek nowego runa. Pozostałe osoby mogą na tym budować normalizację bez dostępu WP. Progress: 1.5.

## WP-M02 — Wykonać świeży PoC export/import [WP-ACCESS]

**Okno/nakład:** H22–26, do 4 h łącznie z WP-M03 i pracą nad importerem. **Wejście:** gotowe API prób/evidence OSS, zatwierdzony baseline/pakiet targetu WP i WP-M01. Nie zależy od React preview, ale nie może zabrać zasobów krytycznemu odbiorowi Reacta.

Wyeksportować pakiet z OM, wykonać dozwolony run w istniejącym narzędziu i pobrać świeży raport. Zachować korelację task/attempt/baseline/externalRunId. Dla repo bez commitów użyć rzeczywistego hasha snapshotu motywu i danych; nie wymyślać SHA. Znormalizować/importować wynik do OM, przejść contract test. Partial/not_run/expired preview nie mogą stać się PASS/verified. Historyczny raport bez korelacji jest tylko referencją.

**Część bez WP-ACCESS:** implementację mapowania z fixture, testy schematu i sam import w OM może zrobić dowolna osoba. Jej czas również odejmuje się od limitu 6 h. Michał odpowiada za pozyskanie i autentyczność świeżego raportu; nie trzeba przyznawać innym dostępu do jego sesji.

**Odbiór H26:** działający export/import i świeży skorelowany dowód, jawny stan preview; QA może sprawdzić manifest bez prywatnego środowiska. Progress: część WP 5.3 i 5.5. Blocker po limicie oznacza niezaliczony PoC, nie zaliczenie fixture.

## WP-M03 — Opcjonalne pełne E2E lub odtworzenie awarii [WP-ACCESS]

**Okno:** tylko pozostały czas rezerwacji WP-M02, bez dodatkowej estymaty. **Warunek:** obowiązkowy PoC gotowy, główny React niezagrożony i niewyczerpany limit 6 h.

Michał wykonuje świeże Apply → upload → verify desktop/mobile na zatwierdzonym target preview, zapisuje dowody wersji i URL. Sam run w kopii Studio nie dowodzi wdrożenia. Ten sam wymóg dostępu obejmuje dodatkowy live retest WP podczas stabilizacji; jeśli nie ma już budżetu, raportować ograniczenie i uzgodnić zmianę zakresu zamiast obiecywać nowe godziny.

**Odbiór:** bonus jawnie nazwany i udokumentowany. Brak bonusu nie blokuje odbioru obowiązkowego PoC; nie jest to osobne wymagane kryterium.

## Rejestr czasu i bezpieczne przekazanie

W `wordpress-reuse.md` zapisywać zadanie, wykonawcę, czas aktywnej pracy, pozostały limit, hash raportu i wynik. Inna osoba nie przejmuje loginów/sekretów Michała. Pliki źródłowe orchestratora pozostają poza zmianami tego repo. Commitować wyłącznie bezpieczne adaptery/fixture i dokumentację w OM.

## Zasady wykonania

Źródłem architektury i kryteriów jest [plan główny](../plan.md); kolejność między strumieniami określa [harmonogram](README.md). Nazwa strumienia nie przypisuje osoby. Wybierzcie wykonawców przed H0; wyjątek stanowią wskazane zadania WP wymagające Michała. H to godziny od wspólnego startu.

Przy przekazaniu podać commit, wersję DTO/baseline, wynik testów i ograniczenia. Testy danej funkcji dostarczać wraz ze zmianą, nie odkładać całego coverage do H28. Nie zmieniać cudzych plików bez uzgodnienia; przekazać patch właścicielowi powierzchni. Postęp odbioru aktualizować wyłącznie w Progress planu głównego, po dostarczeniu dowodów. Numer zadania w komunikacie commitu pozwala odtworzyć historię.
