# UI-02 — Szkielet projektu i host rozszerzenia — Plan Brief

> Pełny plan: [`plan.md`](plan.md)
> Zadanie źródłowe: [strumień UI](../03-design-ui.md) → UI-02
> Poprzednie zadanie strumienia: [UI-01](../ui-01/plan.md)

## What & Why

Domknąć UI-02: doprowadzić `delivery_os` do stanu, w którym operator przechodzi cały ręczny flow z interfejsu — znajduje moduł w nawigacji, zakłada projekt, ogląda jego wymagania, design, zadania i to, co wiadomo o dowodach, wybiera zadanie i widzi rozszerzenie enterprise albo go nie widzi, bo nie ma aktywnego rozszerzenia lub ACL. Bez tego odbiór 2.3/2.4 nie ma czego pokazać, a UI-03 nie ma na czym budować obu wejść.

## Starting Point

Ekran szczegółów projektu już istnieje i jest poprawny — powstał podczas integracji nocnej: pobiera scoped API, waliduje odpowiedź schematem, montuje **rzeczywisty** `InjectionSpot` z walidowanym kontekstem v1 i ma guard przeciw wyścigowi żądań. Pokrywa go 7 testów komponentowych i jeden Playwright. Brakuje wszystkiego wokół: nie ma listy projektów, moduł nie ma wpisu w nawigacji (jedyny `page.meta.ts` ma `navHidden: true`), `CrudForm` nie jest użyty nigdzie, a widget enterprise zwraca `null`, bo host zawsze podaje `taskId: null`. API OSS jest realne i pokrywa trzy sekcje z czterech — dla dowodów istnieje tylko `POST`, nie ma odczytu.

## Desired End State

Operator wchodzi z sidebara na listę projektów, zakłada projekt formularzem, otwiera szczegóły i widzi cztery sekcje wypełnione danymi z API albo jawnie nazwanym brakiem. Zaznacza zadanie — przy aktywnym enterprise i `delivery_agents.execute` widget wykonania zostaje zamontowany z tym `taskId`, inaczej nie montuje się nic. Widget EXEC-02 jest pustym szkieletem, więc dowodem jest jego węzeł DOM; widoczna karta powstaje w EXEC-04. Archiwizuje projekt z listy po potwierdzeniu; przy nieaktualnej wersji dostaje konflikt, a wiersz bez wersji nie pozwala nawet wysłać żądania.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego |
|---|---|---|
| Zakres listy | DataTable + CrudForm **tylko create** + archiwizacja | Realizuje wymaganie UI-02 („CrudForm/DataTable i guarded mutations") i daje flow bez curl-a; edycja nie pada ani w `03-design-ui.md`, ani w Desired End State, więc idzie do UI-03 i zwalnia ~20 min dla Fazy 3 |
| Montowanie rozszerzenia | Dowód DOM, nie zrzut ekranu | Widget EXEC-02 renderuje pusty `<div>` — oba stany wyglądają identycznie, więc wizualny odbiór należy do EXEC-04 |
| Blokada archiwizacji | Odmówić po stronie klienta przy braku `updatedAt` | `assertOptimisticLock` zawodzi **otwarcie**: brak nagłówka daje 200 i cichą archiwizację, nie 409 |
| Kolumna statusu | Brak na liście | `deriveProjectStatus` żyje tylko w route szczegółów i czyta cztery kolekcje; liczenie po stronie klienta byłoby drugim miejscem z logiką statusu, a rozszerzenie serializera to okno OSS |
| Brak `GET evidence` | Sekcja z danych już dostępnych + jawny handoff | Zero wejścia w cudze pliki i zero fikcyjnych PASS; `progress`, `taskCounts`, `attention` i rejestr prób są realne, a brak endpointu jest nazwany jako brak endpointu |
| Wybór zadania | Zaznaczenie wiersza → `taskId` w kontekście + query param | Jedyny sposób, żeby rozszerzenie enterprise w ogóle się wyrenderowało; kontrakt `executionWidgetContextV1` już dopuszcza `taskId`, więc nie wymaga zgody OSS |
| Granica UI-02/UI-03 | UI-02 tylko czyta baseline | 2 h wystarcza, a UI-03 dostaje gotowe komponenty prezentacyjne; approve/reject to Progress 3.4/3.5 |
| Ładowanie sekcji | Projekt bramkuje stronę, sekcje ładują się osobno | Awaria listy zadań nie może zabrać operatorowi hosta `InjectionSpot`; zachowuje 7 istniejących testów |
| Puste stany | Trzy różne komunikaty zamiast jednego | „Brak baseline'u", „baseline bez zadań" i „endpoint nie istnieje" to trzy różne fakty; zlanie ich tworzy fałszywy PASS |
| Testy | Jest + jeden nowy `TC-DELIVERY-UI-002` | Odbiór „operator przechodzi ręczny flow" ma być przebiegiem, nie deklaracją |

## Scope

**W zakresie:** wpis nawigacyjny i lista projektów; formularz **tworzenia**; archiwizacja z optimistic lock i odmową przy braku wersji; `yarn generate` po dodaniu stron; cztery sekcje szczegółów na realnych API; wybór zadania zasilający `InjectionSpot`; i18n w pięciu locale; testy komponentowe i integracyjny przebieg flow; handoff dla OSS.

**Poza zakresem:** jakakolwiek zmiana w `api/`, `commands/`, `data/`, `lib/` modułu; `GET /projects/[id]/evidence` i status w serializerze listy (handoff do OSS); proposals, skills, generacja Figmy, import manifestów (UI-03); przyciski approve/reject decyzji (UI-03); **formularz edycji projektu** (UI-03); podglądy ekranów z `attachmentId` (UI-03); advanced filters, presety, bulk actions, eksport; ekran zadań i UI wykonania (UI-04); fixture w miejscu brakującego endpointu.

## Architecture / Approach

Istniejący ekran szczegółów jest rozbudowywany, nie przepisywany — jego wzorzec (walidacja odpowiedzi schematem przed użyciem, guard sekwencji żądań, rozdzielenie `notFound` od `error`) staje się regułą dla nowych pobrań. Zapytanie o projekt nadal bramkuje stronę; baseline'y i zadania ładują się obok, każde z własnym stanem i ponowieniem. Sekcje żyją w `components/detail/` jako komponenty prezentacyjne przyjmujące pobrane dane — UI-03 dokłada do nich zatwierdzanie, UI-05 buduje na tym samym modelu `EvidenceTable`. Wybór zadania trzymany w query param, weryfikowany po każdym refetchu względem zwróconej listy.

## Phases at a Glance

| Faza | Co dostarcza | Główne ryzyko |
|---|---|---|
| 1. Lista, nawigacja i formularz | Wejście do modułu z sidebara, tworzenie projektu, archiwizacja z konfliktem | Bez `yarn generate` strona nie trafia do routera, a testy Jest tego nie wykryją |
| 2. Sekcje szczegółów i wybór zadania | Cztery sekcje na realnych API, realny `taskId` w kontekście hosta | Brak projektu z baseline'em i zadaniami do zademonstrowania wyboru |
| 3. Dowód flow i przekazanie | `TC-DELIVERY-UI-002`, handoff dla OSS | Okno 2 h kończy się w Fazie 2 — dlatego edycja wycięta, a szkielet handoffu zakładany już na starcie Fazy 2 |

**Warunki startu:** OSS-02 dostarczone (jest — API realne, nie robocze); dostęp do środowiska z bazą i zalogowaną sesją do Playwrighta; ustalone, kto zaznacza wynik w Progress planu głównego; do pełnego odbioru Fazy 2 — możliwość aktywacji i dezaktywacji enterprise oraz odebrania `delivery_agents.execute`.
**Nakład:** 2 h w oknie H4–H6, trzy fazy (~35 / ~50 / ~35 min po wycięciu formularza edycji).

## Open Risks & Assumptions

- OSS prowadzi równolegle R20/R21/R22 w tym samym module — kolizja jest możliwa w `api/` i `lib/`, których UI nie dotyka, ale rebase może zmienić kształt odpowiedzi. Walidacja schematem wyłapie to jako błąd, nie jako puste dane.
- Kryteria 2.10/2.11 są **warunkowe**: wymagają projektu z aktywnym baseline i zadaniem, którego UI-02 nie tworzy. Fixture domenowy należy do OSS-02/QA-02, a zależność jest zapisywana w `handoff.md` już na starcie Fazy 2. Bez niego pokrycie zostaje na poziomie testów komponentowych.
- Odbiór „rozszerzenie pojawia się tylko z aktywnym enterprise i ACL" wymaga obu stanów, i rozpada się na dwie części: UI-02 dowodzi montowania, EXEC-04 dostarcza widoczną kartę. Musi to być zapisane przy współodbiorze 2.3/2.4.
- Sekcja dowodów pozostanie niepełna do czasu dostarczenia `GET /projects/[id]/evidence` przez OSS.

## Success Criteria (Summary)

- Operator przechodzi lista → formularz → szczegóły → archiwizacja bez wpisywania URL-a i bez curl-a, a `TC-DELIVERY-UI-002` powtarza ten przebieg automatycznie na świeżym tenancie.
- Zaznaczenie zadania realnie montuje rozszerzenie enterprise, a odebranie cechy je odmontowuje — dowodem jest węzeł DOM, bo widget EXEC-02 nic nie rysuje.
- Żadna sekcja nie przedstawia braku danych jako wyniku: trzy rozłączne komunikaty, `percent: null` jako „—", nieczytelny rejestr prób odróżniony od braku prób, deklarowane pokrycie opisane jako deklaracja.
- `git diff --stat` nie pokazuje zmian w `api/`, `commands/`, `data/` ani `lib/` modułu.
