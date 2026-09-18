# Strumień EXEC — enterprise, Cezar i workflow

22 h bazowego nakładu. H8–H16 obejmuje przygotowanie bridge na fixture; generowanie aplikacji czeka na zatwierdzenie baseline.

**Własność plików:** `packages/delivery-cezar/`, `packages/enterprise/src/modules/delivery_agents/`, workflow/skills wykonania w `hackathon/delivery-demo/`, adapter PoC OM. Zależności enterprise uzgadniać z OSS; nie edytować komend OSS z dwóch strumieni jednocześnie.

## EXEC-01 — Sprawdzić CLI i realną współbieżność

**Okno/nakład:** H0–3, 3 h. **Start:** przygotowane, autoryzowane konta i host.

Na docelowym użytkowniku systemowym uruchomić Cezar headless, zapisać wersję, exit code, format wyniku i zasady wznowienia. Sprawdzić async/Redis oraz efektywny budżet DB dla dwóch workerów; samo concurrency=2 nie wystarcza. Nie kopiować sekretów. Uzgodnić część enterprise specy z OSS.

**Odbiór H3:** dowód CLI i kolejki; decyzja automatic/manual_handoff. Nie zmieniać Cezara. Brak Redis jest blockerem automatycznej równoległości; manual_handoff wymaga rzeczywiście dwóch lokalnych runów i dowodów ich nakładania. Progress: 1.1, 1.4, 1.6.

## EXEC-02 — Przygotować adapter i rozszerzenie enterprise

**Okno/nakład:** H3–7, 4 h. **Wejście:** EXEC-01; kontrakt roboczy OSS-02 od H4.

Przed H4 przygotować strukturę pakietu, potem DTO adaptera, mapowanie wyników, redakcję logów i szkielet modułu enterprise. Wstrzyknąć widget przez injection-table; UI dostarcza host InjectionSpot. Dodać zależność providera i bramki aktywacji uzgodnione z OSS. Provider przyjmuje pakiet/argumenty, nie DB ani dowolny shell.

**Odbiór:** adapter ma test kontraktowy, OSS nie importuje enterprise; rzeczywisty smoke obu rejestrów po OSS-02/UI-02 najpóźniej H10. Progress: 2.3, współodbiór 2.4.

## EXEC-04 — Zbudować trwałe wykonanie i odzyskanie

**Okna/nakład:** H8–14 na fixture oraz H16–19 live, 9 h. **Wejście:** EXEC-02, DTO v1; live dodatkowo zatwierdzony baseline i realna komenda odbioru OSS-04.

Jedna próba → jedna instancja workflow. Po startWorkflow wykonać kroki do utrwalonego WAIT_FOR_SIGNAL; dopiero potem enqueue i claim/spawn CLI. Worker odbiera wynik wewnętrznie, bez publicznego callbacku. Zapis evidence/pending jest atomowy po stronie OSS. Retry dostarczenia uzgadnia attempt/evidence z historią workflow i nie uruchamia CLI ponownie.

Dostarczyć execute API, execute-task i resume-attempt, obsługę zdarzenia evidence, recovery pending po restarcie oraz cancel/pause. Stan niepewny po claim wymaga reconciliation. Oddzielny worker wznowienia nie może czekać za długim CLI. Brak uprawnień/zmiana scope blokują efekt.

**Przekazanie H14:** bridge przetestowany na fake executorze i instrukcja uruchomienia. **H16–17:** przygotowanie hosta i pakietów; **H17–19:** po przekazaniu komend OSS-04 rzeczywista pionowa próba, następnie dwa runy w osobnych worktree; QA mierzy czasy. Przy manual_handoff zachować ten sam manifest i kontrole, a niesprawdzoną automatyzację oznaczyć jawnie.

**Odbiór:** testy awarii przed parkowaniem, po evidence i po sygnale przed delivered oraz concurrent replay; brak podwójnego efektu; stop_unconfirmed nie udaje zatrzymania. Progress: 4.1–4.3, 4.6–4.7.

## EXEC-05 — Pokazać działający PoC Open Mercato

**Okno/nakład:** H20–22, 2 h. **Wejście:** domenowy export/import i target profile; nie zależy od zakończenia React preview.

Wyeksportować pakiet dla przygotowanego modułu/przykładu OM, uruchomić realną walidację właściwą dla targetu i zaimportować wynik. Sprawdzić, że DTO nie wymusza React; fixture nie zalicza rzeczywistych AC. Dowód przekazać QA przed H24. To PoC wymiany, nie dodatkowe pełne OM E2E.

**Odbiór:** działający export/import, prawdziwy wynik walidacji skorelowany z próbą i baseline; część OM kryteriów 5.3 i 5.5.

## EXEC-06 — Stabilizacja wykonania

**Okna/nakład:** H28–30 i H34–36, 4 h. Odtworzyć retry/restart/cancel/manual_handoff na finalnym commicie, naprawić wykryte błędy i uczestniczyć w próbie demo. Pełny gate prowadzi QA. Progress: 6.1–6.2, 6.4–6.5.

Numer EXEC-03 celowo nie występuje: faza 3 nie ma osobnego przydziału wykonania. **Dostęp WP:** niepotrzebny w całym strumieniu; OM PoC nie wymaga orchestratora WordPressa.

## Zasady wykonania

Źródłem architektury i kryteriów jest [plan główny](../plan.md); kolejność między strumieniami określa [harmonogram](README.md). Nazwa strumienia nie przypisuje osoby. Wybierzcie wykonawców przed H0; wyjątek stanowią wskazane zadania WP wymagające Michała. H to godziny od wspólnego startu.

Przy przekazaniu podać commit, wersję DTO/baseline, wynik testów i ograniczenia. Testy danej funkcji dostarczać wraz ze zmianą, nie odkładać całego coverage do H28. Nie zmieniać cudzych plików bez uzgodnienia; przekazać patch właścicielowi powierzchni. Postęp odbioru aktualizować wyłącznie w Progress planu głównego, po dostarczeniu dowodów. Numer zadania w komunikacie commitu pozwala odtworzyć historię.
