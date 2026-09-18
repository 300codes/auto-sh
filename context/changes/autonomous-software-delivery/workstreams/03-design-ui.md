# Strumień UI — Figma, oba wejścia i interfejs delivery

22 h bazowego nakładu. Dostęp do Figmy wymagany; nie wymaga dostępu do orchestratora WordPressa.

**Własność plików:** `delivery_os/backend/`, `delivery_os/components/`, `delivery_os/i18n/`, skills `requirements-from-brief`, `plan-from-baseline`, `design-from-brief` i fixture design-manifest. UI enterprise należy do EXEC, host InjectionSpot do tego strumienia. Kod i18n/DS według istniejących konwencji OM.

## UI-01 — Potwierdzić agentowy zapis w Figmie

**Okno/nakład:** H0–3, 3 h. Na stanowisku demo agent tworzy edytowalny frame, odczytuje ID i render. Potwierdzić sesję, odpowiedni seat i prawa edycji. Nie traktować dostępności narzędzia w innej sesji jako wyniku próby.

**Odbiór H3:** zespół widzi realny ekran i dowód write/read. Brak write blokuje FROM_BRIEF; człowiek nie zastępuje agenta w rysowaniu. Progress: 1.2, 1.4.

## UI-02 — Dostarczyć szkielet projektu i host rozszerzenia

**Okno/nakład:** H4–6, 2 h. **Wejście:** roboczy DTO OSS-02 w H4; do H9 dozwolone fixture.

Lista i szczegóły projektu, sekcje wymagań/designu/zadań/dowodów, właściwe Loading/Error, tłumaczenia, CrudForm/DataTable i guarded mutations. Rzeczywiście renderować InjectionSpot z typowanym context i odświeżeniem po mutacji. Na H9–H10 podłączyć realne API w ramach UI-03; bez enterprise pozostaje import/export.

**Odbiór:** operator przechodzi ręczny flow; rozszerzenie pojawia się tylko z aktywnym enterprise i ACL. Progress: 2.3–2.4 wraz z OSS/EXEC.

## UI-03 — Doprowadzić dwa wejścia do zatwierdzonego baseline

**Okna/nakład:** H6–10 i H12–15, 7 h. **Wejście:** UI-01/UI-02 oraz kontrakt OSS; realne baseline API od H14.

FROM_BRIEF: agent proponuje wymagania/AC, tworzy i poprawia 1–2 ekrany z mobile/stanami w Figmie; człowiek komentuje snapshot i zatwierdza wymagania/design. Agent proponuje architekturę i zadania; walidowany import i akceptacja scalonego baseline w OM. FROM_DESIGN: zatwierdzone ekrany i ręczne wymagania prowadzą do tego samego schematu, bez reverse specification.

H6–H10 przygotować skills, fixture, generację oraz formularze. H12–H14 dokończyć klienta na kontrakcie, H14–H15 podłączyć realne API. Do H16 QA odbiera oba wejścia; obecność człowieka zatwierdzającego jest warunkiem bramki, nie automatycznym timeoutem. Snapshot zawiera trwałe bytes/hash i powiązanie komentarza; sam URL renderu nie wystarcza.

**Odbiór:** aktualny baseline, zatwierdzone requirements/design/plan, odrzucanie starej wersji i niepoprawnego importu; realna poprawka Figmy. Progress: 3.1–3.6 z OSS/QA.

## UI-04 — Obsłużyć zadania, review i ręczne przekazanie

**Okno/nakład:** H16–20, 4 h. **Wejście:** H16 zatwierdzony baseline, domenowe komendy OSS-04 i bridge EXEC-04 dla live.

H16–H17 kończyć integrację UI na fixture; od H17 po przekazaniu komend OSS-04 podłączyć realne wykonanie. Pokazać rezerwację przed eksportem, import wyników, błędy/wyniki kontroli, cancel/reconcile, stan unknown/stop_unconfirmed, źródło manual/adapter i nieznane usage. Bez fikcyjnego PASS i procentu. Callback to wewnętrzne dostarczenie, nie endpoint klienta.

Nadzorować task formularza/potwierdzenia w osobnym worktree równolegle do tasku listy OSS. Agent implementuje na zatwierdzonym designie; osobny review i rzeczywista poprawka mają znaleźć odzwierciedlenie w UI. Wspólne pliki aplikacji/scaffold pozostają pod kontrolą OSS, a podział allowedPaths ustalony przed spawn.

**Odbiór:** użytkownik widzi dwa runy, konkretne findingi i nową rewizję po poprawce; manual_handoff jasno nazwany. Progress: 4.3, 4.5–4.6.

## UI-05 — Pokazać raport i decyzję wydania

**Okno/nakład:** H24–26, 2 h. **Wejście:** model evidence; endpoint OSS-05 rozwijany równolegle na zamrożonym DTO.

EvidenceTable i DeliveryReport łączą wymaganie→AC→task→rewizję→test→deployment. Odróżnić missing/not_run/failed/unverified. Pokazać zgodę na publikację i osobny odbiór po preview. UI ma obsłużyć również snapshot WP na zanonimizowanym fixture dostarczonym przez Michała; nie wymaga połączenia do jego orchestratora.

**Odbiór:** operator przechodzi do źródłowego dowodu, konflikt wersji jest widoczny, niepełne dane nie stają się PASS. Progress: 5.1, 5.4.

## UI-06 — Próba obu wejść i demonstracja

**Okna/nakład:** H30–32 i H34–36, 4 h. W H30–32 poprawić błędy UX po gate QA; H34–36 agent ponownie tworzy design podczas próby/demo, operator przechodzi akceptację i końcowy raport. Nie przedstawiać replay jako live. Progress: 6.2, 6.4–6.5.

## Zasady wykonania

Źródłem architektury i kryteriów jest [plan główny](../plan.md); kolejność między strumieniami określa [harmonogram](README.md). Nazwa strumienia nie przypisuje osoby. Wybierzcie wykonawców przed H0; wyjątek stanowią wskazane zadania WP wymagające Michała. H to godziny od wspólnego startu.

Przy przekazaniu podać commit, wersję DTO/baseline, wynik testów i ograniczenia. Testy danej funkcji dostarczać wraz ze zmianą, nie odkładać całego coverage do H28. Nie zmieniać cudzych plików bez uzgodnienia; przekazać patch właścicielowi powierzchni. Postęp odbioru aktualizować wyłącznie w Progress planu głównego, po dostarczeniu dowodów. Numer zadania w komunikacie commitu pozwala odtworzyć historię.
