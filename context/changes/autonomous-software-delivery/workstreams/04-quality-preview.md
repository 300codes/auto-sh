# Strumień QA — testy, preview i dowody

14 h bazowego nakładu bez prac WordPressa. Osobny [pakiet WP dla Michała](05-wordpress-michal.md) ma 6 h. Razem odpowiadają dawnemu przydziałowi QA/adapters 20 h, ale nie muszą być wykonywane przez tę samą osobę.

**Własność plików:** `delivery_os/__integration__/TC-DELIVERY-*.spec.ts`, `delivery_agents/__integration__/TC-DELIVERY-EXEC-*.spec.ts`, profil/testy React, `hackathon/delivery-demo/{runbook,acceptance,evidence-index}.md`. Testy jednostkowe providera/komend pozostają u ich implementerów. QA nie jest jedyną osobą piszącą testy.

## QA-02 — Przygotować kontraktowe fixture i testy integracyjne

**Okno/nakład:** H4–6, 2 h. **Wejście:** DTO OSS-02 w H4; przygotowanie harness może ruszyć wcześniej.

Przygotować samodzielne fixture dwóch tenant/org, fake executor, cleanup i testy kontraktów. Profile walidacji/scannerów przypiąć do rzeczywiście dostępnych komend; błędy narzędzia to not_run, nie PASS. Finalny profil AC musi zostać zatwierdzony z baseline. Testy włączyć do zmian implementacyjnych razem z autorami; po H9 uruchomią je OSS/EXEC, QA nie musi osobiście czekać przy każdym uruchomieniu.

**Odbiór:** testy wykrywają obcy scope, stale version, błędny manifest i idempotencję; efektywny smoke OSS-only wykonany przed H10. Progress: 2.1–2.4 wspólnie z implementerami.

## QA-03 — Odebrać oba wejścia i baseline

**Okno/nakład:** H14–16, 2 h. **Wejście:** realne API OSS-03 od H14, UI kończy podłączenie do H15.

H14–H15 sprawdzić backend, H15–H16 flow UI: oba wejścia, trwały snapshot, hash/version, import propozycji, negatywne allowedPaths/referencje i brak ready bez decyzji. Operator zatwierdza aktualny baseline. QA potwierdza bramkę H16 na podstawie dowodów, nie samego commitu.

**Odbiór:** kryteria 3.1–3.6; manifest testów powiązany z zatwierdzonymi AC. Niezaliczona bramka blokuje live React, pozostawia pracę na fixture.

## QA-04 — Zweryfikować React, poprawkę i awarie wykonania

**Okna/nakład:** H8–10 przygotowanie oraz H19–22 live, 5 h. **Wejście:** dla przygotowania DTO; dla live H16 baseline i pierwszy wynik EXEC/OSS/UI.

H8–H10 przygotować harness testów AC i negatywny fixture bez generowania aplikacji na niezatwierdzonym designie. H19–H22 sprawdzić nakładanie dwóch runów, review w osobnym kontekście, rzeczywistą poprawkę i powtórne kontrole. Po commit integracyjnym docelowo H21 ponownie uruchomić cały zatwierdzony zestaw AC i skany; nie przenosić PASS z commitów tasków. Testować park-before-start, retry po evidence, sygnał-przed-delivered, concurrent replay, cancel i restart.

**Odbiór:** surowe raporty z hashami, check/test/AC IDs, finalny commit i wersja profilu; brakujące testy blokują odbiór. Progress: 4.1–4.7. Jeśli poprawki/gate nie mieszczą się w oknie, uruchomić jawny bufor i przeliczyć nakład; nie pomijać ponownej walidacji.

## QA-05 — Opublikować i zweryfikować React preview

**Okno/nakład:** H26–27, 1 h aktywnej pracy przy przygotowanym hostingu. **Wejście:** finalny raport OSS-05, zielone testy/security, osobna zgoda człowieka na publikację konkretnej rewizji.

Uruchomić przygotowany profil publikacji, zweryfikować URL desktop/mobile, build ID i commit; zapisać deployment evidence, następnie zebrać release approval. Czas oczekiwania na hosting nie jest dowodem powodzenia. Przy braku celu lub opóźnieniu rejestrować blocker przed freeze H28.

Dołączyć dowód OM PoC od EXEC-05 oraz świeży, zanonimizowany raport WP od Michała. Sam import/normalizacja w OM nie wymaga dostępu do orchestratora; wykonanie świeżego runa i sprawdzanie jego preview wymagają Michała.

**Odbiór:** 5.1–5.5 z właściwymi właścicielami; React PASS tylko na aktualnym URL i finalnej rewizji.

## QA-06 — Uruchomić pełny gate i zamknąć odbiór

**Okna/nakład:** H28–30 i H34–36, 4 h. **Wejście:** feature freeze H28.

Rozpocząć pełną uporządkowaną sekwencję z `.ai/agentic.config.json` najpóźniej H28, dodać właściwy lint oraz `yarn test:integration --grep 'TC-DELIVERY'`. Runner wybrać raz według reguł repo. Czas gate zmierzony w H0–H3 musi pozwolić na wynik przed H34; monitorowanie i naprawy wymagające dodatkowego czasu ujawniają wykorzystanie bufora.

H34–H36 wspólny odbiór obu wejść, live design, correction loop, raportu i zaakceptowanego preview. Każda zmiana po zielonym gate unieważnia dowody dotkniętych kontroli — ponowić odpowiednią weryfikację finalnego commitu. Zapisać wyniki, ograniczenia i rzeczywisty czas pracy, bez fikcyjnego zaliczenia czerwonych kryteriów.

**Odbiór:** 6.1–6.5. **Dostęp WP:** brak wymogu dla QA-02…06 przy dostarczonych artefaktach; każde dodatkowe odtworzenie lokalnego WP lub jego publikacja przechodzi do WP-M03 i wymaga Michała.

## Zasady wykonania

Źródłem architektury i kryteriów jest [plan główny](../plan.md); kolejność między strumieniami określa [harmonogram](README.md). Nazwa strumienia nie przypisuje osoby. Wybierzcie wykonawców przed H0; wyjątek stanowią wskazane zadania WP wymagające Michała. H to godziny od wspólnego startu.

Przy przekazaniu podać commit, wersję DTO/baseline, wynik testów i ograniczenia. Testy danej funkcji dostarczać wraz ze zmianą, nie odkładać całego coverage do H28. Nie zmieniać cudzych plików bez uzgodnienia; przekazać patch właścicielowi powierzchni. Postęp odbioru aktualizować wyłącznie w Progress planu głównego, po dostarczeniu dowodów. Numer zadania w komunikacie commitu pozwala odtworzyć historię.
