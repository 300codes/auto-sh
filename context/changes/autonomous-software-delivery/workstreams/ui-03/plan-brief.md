# UI-03 — Dwa wejścia do zatwierdzonego baseline — brief

> **Korekta kierunku — 2026-09-19:** [dodatek produktowy](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) i [pakiet dla Adama](../../flow-handoff/03-adam-ui-figma.md) mają **pierwszeństwo**. Ten plan powstał na wcześniejszym ramowaniu i pokrywa **część** nowego zakresu UI: mechanika designu, wersje i wzorce zostają, dwie zgody `requirements`/`design` są ścieżką v1, a nie docelowym modelem osobnych bramek UX/KV/DS/UI. Poza tym planem zostają: probe odczytu komentarzy Figmy, Brief Wizard i scoping, osobne artefakty UX/KV/DS-UI, provider komentarzy i staff Kanban, ustawienia procesu oraz handoff tokenów do WP. Odbiór liczy się w FLOW-01…09 / WP-01…05 — ten plan **nie zamyka żadnego z nich**, wnosi wkład cząstkowy do FLOW-02, 08 i 09. Nie dostarcza też obowiązków F0 Adama: probe komentarzy, listy operacji API i estymaty pakietu. Rozliczenie: sekcja „Pozycja wobec korekty kierunku" w [`plan.md`](plan.md).

> Pełny plan: [`plan.md`](plan.md)
> Strumień: [`../03-design-ui.md`](../03-design-ui.md) · Plan główny: [`../../plan.md`](../../plan.md) (Faza 3, Progress 3.1–3.6)
> Poprzednik: [`../ui-02/handoff.md`](../ui-02/handoff.md) · Dowody Figmy: `hackathon/delivery-demo/evidence/figma/`

## What & Why

Doprowadzić oba wejścia do jednego zatwierdzonego baseline'u: agent proponuje wymagania i AC, tworzy i poprawia ekrany w Figmie, człowiek komentuje snapshot i zatwierdza wymagania oraz design, agent proponuje architekturę i plan, człowiek zatwierdza scalony baseline. FROM_DESIGN przechodzi tym samym torem od zatwierdzonych ekranów i ręcznie napisanych wymagań — bez rekonstrukcji specyfikacji z obrazów. Bez tego kroku nie ma czego implementować: Faza 4 planu głównego startuje z zatwierdzonego baseline'u, nie z briefu.

## Starting Point

UI-02 dostarczyło nawigację, listę projektów, formularz tworzenia, ekran szczegółów z czterema prezentacyjnymi sekcjami i działającym `InjectionSpot`, oraz archiwizację z kontrolą wersji. OSS-03 ma **wdrożone i żywe** API baseline'ów, decyzji i obu importów propozycji — zapis strumienia „realne baseline API od H14" jest nieaktualny. Brakuje trzech rzeczy: instrukcji dla agenta, drogi ekranu z Figmy do baseline'u i jakiegokolwiek przycisku zatwierdzania. UI-01 zostawiło działającą sekwencję Figmy i skrypty utrwalające render z bytes/hash.

## Desired End State

Operator wkleja manifest z sesji agenta i widzi baseline v1. Wgrywa render, widzi miniaturę, zostawia uwagę przypiętą do ekranu, zamraża v2 z designem. Przełącza się na v2, zatwierdza wymagania i design — v2 staje się aktywna. Wkleja manifest planu, dostaje scalony baseline v3 z zadaniami i informację, że v3 wymaga ponownych dwóch decyzji. Każde odrzucenie ma powód, każdy nieudany import wskazuje pole, a render niezgodny z deklarowanym hashem nie wchodzi do baseline'u.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Import designu | Klient składa `screens[]` sam: upload → sha256 w przeglądarce → `PUT draftSpec` | Komenda OSS wymagałaby `commands/` i `data/`, których UI nie wolno dotykać; czekanie na cudzy commit w 7-godzinnym oknie to niepokryte ryzyko | Plan |
| Wejście manifestów | Wklejenie JSON z walidacją klientową przed wysłaniem | Skraca pętlę przy literówce agenta i działa na każdym stanowisku; podwójna walidacja, nie zastępcza | Plan |
| Miejsce zatwierdzania | Akcje w istniejących sekcjach wymagań i designu, z wyborem oglądanej wersji | Decyzja stoi obok treści, którą ocenia; sekcje są już prezentacyjne i gotowe | Plan |
| Komentarz do snapshotu | Uwaga przypięta do ekranu, `anchor: null` | Spełnia wymóg powiązania komentarza ze snapshotem bez canvasu wykluczonego przez plan główny | Plan |
| Kolejność faz | Decyzje **przed** importem planu | `import_plan` żąda aktywnego baseline'u z obiema zgodami dla jego hasha — domena, nie UX | Kod OSS |
| Ręczne wymagania FROM_DESIGN | Ten sam dialog, manifest pisany przez człowieka, `producedBy` w podglądzie | Brak edytora wymagań w zakresie; kontrakt manifestu już to obsługuje | Plan |
| Przejęte po UI-02 | Naprawa F1 + miniatury ekranów | F1 to ten sam warunek, który i tak otwiera wybór wersji; bez miniatury zatwierdzanie designu ocenia metadane | Plan |
| Poziom dowodu | Komponentowe + napisany, nieuruchomiony `TC-DELIVERY-UI-003` | Środowisko nie jest zainicjalizowane, a `db:migrate`/`initialize` wymagają zgody | Plan |

## Scope

**W zakresie:** trzy skille agentowe i fixture demo; import `RequirementsProposal v1` i `PlanProposal v1`; upload renderu z sha256 liczonym w przeglądarce; ekrany i uwagi w draftcie; miniatury; ręczne zamrożenie baseline'u; wybór oglądanej wersji; decyzje requirements/design z odrzuceniem; naprawa F1; spec integracyjny obu wejść.

**Poza zakresem:** komenda importu designu po stronie OSS; edytor wymagań i formularz edycji projektu; kotwice x/y na renderze; reverse specification; pixel diff; `GET /projects/:id/evidence` i `EvidenceTable` (UI-05); paginacja baseline'ów po stronie klienta; ekran zadań i manual handoff (UI-04); migracje i inicjalizacja bazy.

## Architecture / Approach

Wszystko żyje w `delivery_os/backend/`, `delivery_os/components/` i `delivery_os/i18n/` oraz w `hackathon/delivery-demo/` — granica własności wobec `api/`, `commands/`, `data/` i `lib/` pozostaje nietknięta i jest sprawdzana `git status` w każdej fazie.

Przepływ danych: manifest agenta → walidacja klientowa schematem z `lib/contracts` → `POST /projects/:id/baselines` albo `/tasks` → `projectUpdatedAt` z odpowiedzi jako nagłówek następnej mutacji. Render: plik → `POST /api/attachments` → `crypto.subtle` liczy sha256 → wpis w `draftSpec.screens` → `PUT /api/delivery_os/projects` → `POST /baselines {source:'manual'}`, gdzie serwer weryfikuje bajty. Decyzje: `POST /baselines/:id/decisions` z hashem i wersją oglądanej wersji; aktywacja następuje po obu zgodach.

Sekwencja domenowa jest wymuszona, nie wybrana: v1 wymagania → v2 design → dwie zgody → v3 plan → dwie zgody → zadania gotowe.

## Phases at a Glance

| Faza | Co dostarcza | Główne ryzyko |
|---|---|---|
| 1. Skills i import wymagań (H6–H7:30) | Agent ma instrukcję, operator zamienia jej wynik w baseline v1 | Zlanie `200 duplicate` z `409 idempotency_conflict` w jeden komunikat |
| 2. Design: render → sha256 → zamrożenie (H7:30–H10) | Render z Figmy wchodzi do baseline'u z miniaturą i uwagą | Sha256 jako deklaracja klienta; błąd niezgodności pokazany jako „błąd zapisu" zamienia weryfikację w dekorację |
| 3. Wersje, decyzje, odrzucenie (H12–H13:30) | Człowiek zatwierdza konkretną wersję; baseline staje się aktywny | Sekcje patrzą dziś tylko na `isActive` — bez wyboru wersji nie ma czego zatwierdzać |
| 4. Import planu, FROM_DESIGN, spec (H13:30–H15) | Scalony baseline z zadaniami, drugie wejście, wykonywalny scenariusz | Operator uzna zadania za gotowe, nie widząc, że scalony baseline jest nieaktywny |

**Warunki startu:** zalogowana sesja Figma MCP na stanowisku demo (tier `starter`: 10 odczytów/min), działający host OM z cechami `delivery_os.projects.manage`, `delivery_os.results.import`, `delivery_os.baselines.approve` oraz `attachments.manage`/`attachments.view`, aplikacja pod `https` albo `localhost` (wymóg `crypto.subtle`).
**Nakład:** 7 h w dwóch oknach — H6–H10 (Fazy 1–2) i H12–H15 (Fazy 3–4).

## Open Risks & Assumptions

- **Sha256 liczy klient.** Jedynym miejscem, w którym deklaracja staje się prawdą, jest serwerowa weryfikacja bajtów przy zamrożeniu. Zatarcie tego błędu w ogólnym komunikacie usuwa całą kontrolę.
- **Pochodzenie propozycji nie przeżywa w danych.** `importedManifests` zapisuje tylko `manifestId`/`manifestHash`; `producedBy` widać w podglądzie przed importem i w audycie. Jeśli ma zostać w baseline, to prośba do OSS.
- **`TC-DELIVERY-UI-003` nie zostanie uruchomiony w tym oknie** — środowisko nie ma tabel `delivery_*` ani konta admina. Kryteria 3.1–3.3 i 3.6 pozostają niezaznaczone do wspólnego odbioru z OSS-03 i QA-03.
- **3.4 i 3.5 wymagają obecnego człowieka zatwierdzającego.** Brak tej osoby to kryterium niezaliczone, nie automatyczny upływ czasu.
- **Limity Figmy są realne przy pętli poprawek** na kilku ekranach; sekwencja z UI-01 jest sprawdzona i ma być powtórzona, nie wymyślona pod presją okna.

## Success Criteria (Summary)

- Oba wejścia zapisują ten sam schemat baseline'u, a człowiek zatwierdza konkretną wersję po jej hashu.
- Agent tworzy i poprawia ekran w Figmie; operator komentuje wersję i zamraża nowy snapshot z trwałymi bytes/hash.
- Nieaktualna wersja, obca referencja, zły hash renderu i wadliwy manifest są odrzucane z komunikatem wskazującym powód — żaden z nich nie kończy się cichym sukcesem.
