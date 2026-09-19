# Autonomous Software Delivery — Plan Brief

> [Pełny plan](plan.md) · [Decyzje i research](research.md)
> 4 developerów · 36 godzin · zakres i etapy zatwierdzone
> Wykonanie: [równoległe plany i harmonogram](workstreams/README.md); [WP — Michał](workstreams/05-wordpress-michal.md).

## What & Why

Budujemy demonstrację kontrolowanego delivery: brief albo zatwierdzone ekrany trafiają do OM, agent wykonuje pracę przez Cezara, a człowiek otrzymuje działający preview i dowody realizacji wymagań. Głównym produktem jest wiarygodny proces od wymagania do wdrożenia.

## Starting Point

OM ma już workflow, ACL, komendy, audit, załączniki i UI. Cezar ma headless CLI; Figma ma zapis przez oficjalny MCP. Własny pakiet `delivery-wordpress` korzysta bezpośrednio ze Studio CLI i tworzy nową witrynę; stary orchestrator jest wyłącznie źródłem referencyjnym.

## Desired End State

Dwa wejścia prowadzą do wspólnego zatwierdzonego baseline. Agent tworzy design w Figmie podczas demo. React przechodzi implementację, review, rzeczywistą poprawkę, testy i preview; raport łączy AC z commitem, testem i wdrożeniem. OM i WordPress pokazują działające PoC wymiany pakietów i dowodów.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Produkt | Domena/planowanie OSS, wykonanie enterprise | Planowanie użyteczne bez licencji enterprise | Użytkownik |
| Wejścia | FROM_BRIEF + uproszczone FROM_DESIGN | Dwie historie bez budowy reverse specification | Użytkownik |
| Design | Agent pisze do Figmy, człowiek zatwierdza | Zachowanie wymogu demonstracji | Użytkownik |
| Cezar | Bez zmian kodu; wrapper lub manual_handoff | Ograniczenie kosztu integracji | Użytkownik |
| Targety | React E2E, OM/WP PoC | Domknięcie głównego przebiegu w 36 h | Użytkownik |
| WordPress | Własne narzędzia Studio + nowa witryna, max 6 h łącznie | Samodzielne wykonanie; podłączenie OSS/enterprise później | Korekta użytkownika 2026-09-19 |
| Koszty | Posiadane subskrypcje, limit czasu i iteracji | Bez nieuzgodnionego budżetu API | Użytkownik + plan |
| Model | 5 encji OSS; wymagania/AC w wersjonowanym baseline | Mniej CRUD-ów przy zachowaniu traceability | Plan |
| Odbiór | Dowody hosta i człowiek; LLM review pomocniczy | Deklaracja modelu nie jest wynikiem testu | Research + plan |

## Scope

Szczegóły WP-M01 i niezależnych prac: [plan narzędzi Studio](../wordpress-studio-tools/plan.md). Limit 6 h jest budżetem, nie zapewnieniem wykonania całego pakietu WP.

**W zakresie:** projekty, wymagania/AC, agentowy design, komentarz do snapshotu, akceptacja wymagań, designu, publikacji i odbioru, dwa równoległe zadania, correction loop, traceability, preview i raport.

**Poza zakresem:** pełny pull/A2A dispatch, zmiany Cezara, automatyczna rekonstrukcja spec/DS, pixel diff Figma–browser jako bramka, produkcja i utrzymanie. WP E2E jest bonusem wyłącznie po świeżej weryfikacji.

## Architecture / Approach

`delivery_os` w core przechowuje domenę, baseline i dowody. `delivery_agents` w enterprise zarządza wykonaniem przez istniejący workflow. Dedykowany pakiet `delivery-cezar` wywołuje CLI. OSS nie zależy od enterprise. Figma działa przez sesję MCP; własne narzędzia Studio zwracają manifest; odbiór przez domenę wymaga późniejszego podłączenia OSS/enterprise. Każda próba jest przypięta do konkretnego baseline i rewizji: commitu dla React/OM, hasha snapshotu dla WP PoC.

Automatyczna próba ma osobny workflow: najpierw trwałe oczekiwanie na wynik, potem kolejka i CLI. Worker zapisuje wynik wewnętrznie; rejestr próby umożliwia ponawialne wznowienie po awarii. Bez publicznego callbacku. OSS-only rezerwuje próbę przez API przed eksportem, a wynik importuje przez uwierzytelniony endpoint. Dwa równoległe runy wymagają kolejki async/Redis sprawdzonej już w H0–H3 i workera o efektywnej współbieżności 2 po zaciśnięciu budżetem połączeń DB.

PASS wymaga zatwierdzonego mapowania AC do testów oraz dowodów na finalnej rewizji integracyjnej. Historyczny raport WP nie jest ścieżką integracji. Lokalny smoke narzędzi nie zalicza PoC OM→WP ani Progress. Agentowe propozycje wymagań i planu mają jawny, walidowany import i akceptację przed implementacją. Osobne features pokrywają uzgodnienie próby, publikację i końcowy odbiór.

## Phases at a Glance

| Etap | Okno | Rezultat | Główne ryzyko |
|---|---|---|---|
| 1. Próby | H0–3 | Cezar, Figma write, host OM, kolejka async, WP readiness | Sesje, uprawnienia i strategia kolejki |
| 2. Fundament | H3–10 | OSS + DTO v1 + rozszerzenie enterprise | Nadmiar encji/integracji |
| 3. Wejścia/design | H6–16 | Dwa wejścia, snapshot i approvals | Figma i niekompletne AC |
| 4. React | H8–24 | Kod, testy, review i poprawka | Wynik bez wiarygodnych dowodów |
| 5. Preview/PoC | H20–28 | URL, raport, OM/WP adapter PoC | Scope creep WordPressa |
| 6. Stabilizacja | H28–36 | Gate, próba i odbiór demo | Zbyt późna integracja |

**Zespół:** A — OSS i integracja kodu; B — Cezar/enterprise; C — Figma i UI; D — QA, preview i PoC.
**Nakład:** około 87 osobogodzin planowanej pracy z nominalnych 144; reszta to odpoczynek, oczekiwanie, komunikacja i bufor. Okna nakładają się między różnymi właścicielami. To estymata wymagająca aktualizacji po H3, nie wynik pomiaru; poprawki review mieszczą się w odpowiednich etapach, a ich koszt trzeba wtedy ponownie oszacować. Korekta tej liczby jest obowiązkowym wynikiem H3, nie kolejnym szacunkiem przy biurku.
**Warunki startu:** działający host OM i repo React, konta CLI, Figma Full seat/prawa edycji i sprawdzony MCP, gotowy cel preview, kolejka async z osiągalnym Redis. H0–3 potwierdza warunki, nie zakłada ich spełnienia.

## Open Risks & Assumptions

- Figma write musi działać na stanowisku używanym w demo; brak tej możliwości blokuje wymaganie FROM_BRIEF. Professional bez właściwego seat/klienta nie wystarcza.
- Nieudana automatyczna integracja Cezara uruchamia zatwierdzony tryb ręczny, jawnie oznaczony w raporcie.
- Nowa witryna i własne narzędzia wymagają świeżego smoke. Publiczna publikacja jest osobnym zakresem; limit WP to 6 osobogodzin łącznie, bez gwarancji całego PoC.
- Subskrypcje nie gwarantują nieograniczonej dostępności. Nieznane usage nie jest kosztem 0; Extra Credits nie uruchamiają się automatycznie.
- To plan hackathonowy dla kontrolowanych repo; produkcyjne izolowanie obcego kodu i pełny dispatch mają osobną kontynuację bez dat.

## Success Criteria (Summary)

- Oba wejścia dają zatwierdzony baseline; agent tworzy i poprawia design w Figmie.
- React ma dwa równoległe runy, rzeczywistą poprawkę, zaliczone AC, aktualny preview i raport powiązany z commitem.
- OSS działa bez enterprise; OM/WP PoC mają dowody; testy izolacji, idempotencji i pełny gate przechodzą, a człowiek akceptuje wynik.
