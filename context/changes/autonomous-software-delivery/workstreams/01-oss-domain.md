# Strumień OSS — domena, kontrakty i integracja

23 h bazowego nakładu. Można rozpocząć równocześnie ze wszystkimi strumieniami. Krytyczna odpowiedzialność: wersjonowane kontrakty i ich działająca implementacja.

**Własność plików:** `packages/core/src/modules/delivery_os/{data,lib,commands,api,migrations}/`, `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `di.ts`, `extension-points.ts`; istniejąca konfiguracja `apps/mercato/src/modules.ts`. Skoordynować generację i zależności workspace z EXEC. UI należy do UI, testy integracyjne do QA; testy jednostkowe domeny do OSS.

## OSS-01 — Przygotować środowisko i źródło kontraktów

**Okno/nakład:** H0–2, 2 h. **Warunek startu:** dostęp do OM i przygotowanego targetu preview; brak wymaga zgłoszenia w bramce H3.

Uruchomić OM, przygotować repo React Vite/TS, wykonać bazowy build i przykładowy AC. Przygotować małe specy OSS/enterprise z planu (część enterprise konsultuje EXEC) oraz listę nowych API i testów. Specy i profile doprecyzować w OSS-02; próba CLI należy do EXEC, Figma do UI. W readiness zapisać runner i rozpocząć pomiar pełnego gate OM, który może działać bez ciągłego nadzoru.

**Odbiór/przekazanie:** dostępny host i repo React, wynik build/test, specy z granicą OSS/enterprise i integration coverage; w H3 decyzja o gotowości i aktualizacja estymaty. Progress: 1.1 (część środowiska), 1.3.

## OSS-02 — Dostarczyć minimalną domenę i ręczny przebieg

**Okno/nakład:** H3–9, 6 h. **Wejście:** OSS-01; H3 readiness.

Wprowadzić pięć encji, walidatory, komendy CRUD, ACL, tenant/org, optimistic locking, DAG, zdarzenia i rejestrację. Wygenerować i przejrzeć migracje; ich lokalne zastosowanie wymaga zgody zgodnie z regułami repo. Zamrozić DTO v1: TaskPackage, ResultManifest, baseline/proposal, sourceRevision git/snapshot i kontekst widgetu.

**Przekazanie częściowe H4:** spisana wersja DTO/API i fixture, w tym attemptId, packageUrl, scope i error responses. To odblokowuje UI/EXEC/QA na fixture, a nie oznacza gotowej domeny. **H9:** działające komendy i endpointy, generator, testy i eksport w OSS-only. Minimalny ręczny baseline ze snapshotem i decyzjami requirements/design, ustawienie ready, rezerwacja próby i GET package powstają już tutaj, bo bramka H10 wymaga legalnego eksportu. To ręczne wprowadzenie wcześniej zatwierdzonych danych, nie zastępstwo obowiązkowej generacji Figmy; OSS-03 rozszerza tę ścieżkę o oba wejścia i import propozycji. Test eksportu używa rzeczywistych decyzji, nie omija ich fixture; OSS-04 uzupełnia niezawodność i pełny odbiór wyniku.

**Odbiór:** nieznany schemat/cykl/obcy scope/stale update są odrzucane; jeden klucz rezerwuje jedną próbę; GET nie mutuje danych; ręczny flow działa bez enterprise. Progress: 2.1, 2.2, współodbiór 2.3–2.4.

## OSS-03 — Utrwalić baseline i decyzje obu wejść

**Okno/nakład:** H10–14, 4 h. **Wejście:** OSS-02, kontrakt propozycji z UI-03.

Dostarczyć append-only baseline, snapshoty/attachments, decyzje requirements/design, walidowany import wymagań i planu oraz zadania z mapowaniem AC→test. Odrzucać obce referencje, zmiany zatwierdzonej wersji, niedozwolone allowedPaths i fałszywe mapowania testów. Atomowo wiązać decyzję z hashem i wersją przedmiotu.

**Przekazanie H14:** realne API dla QA i UI. **Odbiór H16:** QA-03 i UI-03 potwierdzają zatwierdzony scalony baseline obu wejść; wcześniej nie uruchamiać generowania aplikacji. Progress: 3.1–3.3, 3.6; współodbiór 3.4–3.5.

## OSS-04 — Domknąć odbiór wyników i zintegrować React

**Okna/nakład:** H16–19 i H20–22, 5 h. **Wejście do rozpoczęcia:** H16 zatwierdzony baseline i bridge EXEC-04 sprawdzony na fixture w H14. Wyniki zadań UI-04 są potrzebne dopiero do scalania H20–H22, nie do rozpoczęcia pracy.

Uzupełnić rezerwację/claim, cancel/reconcile, import i evidence/pending w jednej transakcji; API ręczne korzysta z tej samej domenowej walidacji co worker. Pierwszy krok H16–H17 dostarcza komendy dla integracji live; od H17 EXEC/UI mogą wykonać pionową próbę i uruchomić dwa zadania; EXEC wcześniej używa fixture. Przekazać QA realny scenariusz replay, obcego baseline i unknown po restarcie.

OSS nadzoruje task listy/filtrowania, UI task formularza — są to dwa zadania aplikacji demo wykonywane przez Cezara, odrębne od niniejszych planów budowy OM. Po review/poprawce połączyć wyniki bez nadpisania zmian; docelowo commit integracyjny dostępny do H21, ostatnia godzina na finalne testy QA. Opóźnienie przesuwa odbiór, nie uprawnia do użycia wyników sprzed merge.

**Odbiór:** duplikat nie dubluje evidence, ale ponawia pending delivery; nieznany proces nie uruchamia się sam ponownie; merge ma pełne wyniki finalnej rewizji. Progress: 4.1–4.5, 4.7 wraz z EXEC/QA.

## OSS-05 — Raport i bramki publikacji

**Okno/nakład:** H24–26, 2 h. **Wejście:** OSS-04, wspólny model evidence; UI-05 równolegle na DTO.

Dostarczyć report API, evidence/deploy-decisions/release-decisions oraz wyliczanie AC po baseline, finalnej rewizji i profilu. Brak testów, FAIL/skipped/not_run, brak skanów lub niezweryfikowany deployment blokują odpowiedni PASS/odbiór. Publikacja i odbiór to osobne decyzje człowieka. Przekazać QA-05 działające API przed H26.

**Odbiór:** zmiana rewizji unieważnia zastosowanie dawnej decyzji do nowego wydania; raport prowadzi do dowodu testu i deploymentu. Progress: 5.1, 5.4.

## OSS-06 — Stabilizacja i odbiór

**Okna/nakład:** H28–30 i H34–36, 4 h. **Wejście:** H28 feature freeze.

Naprawić błędy domeny/kontraktów z gate, odtworzyć OSS-only, sprawdzić migracje i historię dowodów. W H34–36 wspólnie odebrać obie ścieżki i finalną rewizję. H30–34 to bufor, a wykorzystane w nim godziny zwiększają rzeczywisty nakład.

**Odbiór:** kryteria 6.1–6.5 ze wspólnym raportem QA; manualnych pozycji nie zaznacza automat. **Dostęp WP:** niepotrzebny w całym strumieniu.

## Zasady wykonania

Źródłem architektury i kryteriów jest [plan główny](../plan.md); kolejność między strumieniami określa [harmonogram](README.md). Nazwa strumienia nie przypisuje osoby. Wybierzcie wykonawców przed H0; wyjątek stanowią wskazane zadania WP wymagające Michała. H to godziny od wspólnego startu.

Przy przekazaniu podać commit, wersję DTO/baseline, wynik testów i ograniczenia. Testy danej funkcji dostarczać wraz ze zmianą, nie odkładać całego coverage do H28. Nie zmieniać cudzych plików bez uzgodnienia; przekazać patch właścicielowi powierzchni. Postęp odbioru aktualizować wyłącznie w Progress planu głównego, po dostarczeniu dowodów. Numer zadania w komunikacie commitu pozwala odtworzyć historię.
