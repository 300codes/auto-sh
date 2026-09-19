# UI-01 — Potwierdzić agentowy zapis w Figmie — Plan Brief

> Pełny plan: [plan.md](plan.md)
> Zadanie źródłowe: [strumień UI](../03-design-ui.md) · Kryteria i Progress: [plan główny](../../plan.md#progress)
> Ustalenia wejściowe: [research.md](../../research.md)

## What & Why

Sprawdzamy w oknie H0–H3, czy agent potrafi zapisać i poprawić design w Figmie na tym stanowisku i koncie, którego użyje demo. To jedyna bramka, za którą stoi wymaganie FROM_BRIEF — plan główny nie przewiduje zastępstwa ręcznym rysowaniem, więc brak zapisu jest twardym blockerem, a nie niedogodnością.

## Starting Point

Figma MCP nie jest jeszcze podłączony na stanowisku: `claude mcp list` pokazuje tylko Claude Docs i Gmail, w repo nie ma `.mcp.json`, a `~/.codex/config.toml` nie deklaruje serwerów MCP. Konto Figma to Starter, a oficjalny zapis wymaga Full seat i prawa edycji pliku. Istniejąca w repo warstwa Figmy (`ds:code-connect:*`, `docs/design-system/figma-audit/`) dotyczy design systemu OM, gdzie obowiązuje code-as-truth — z tym zadaniem nie ma wspólnego zakresu.

## Desired End State

Agent utworzył frame w pliku Figma, następnie zmodyfikował ten sam węzeł, a render odczytano po obu operacjach. W repo leży manifest z `fileKey`, `nodeId`, sha256 i znacznikami czasu oraz same rendery jako pliki PNG. `figma-readiness.md` mówi `ready` albo `blocked` z konkretną przyczyną osobno dla `write` i dla `update`, i zawiera osobny zapis próby headless. `readiness.md` ma jedną linię statusu z odnośnikiem. Zespół obejrzał ekran i potwierdził login, seat i prawa edycji.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Klient MCP | Podstawowy bramkuje próbę, drugi po rozstrzygnięciu | Druga ścieżka chroni przed błędem konfiguracji klienta, nie przed odmową seat — nie warto jej płacić opóźnieniem | Plan |
| Format dowodu | `fileKey`/`nodeId` + trwały PNG + sha256 | Adresy renderu wygasają; plan główny odrzuca sam URL i wymaga bytes/hash | Plan + `plan.md:292` |
| Lokalizacja artefaktu | Własny `figma-readiness.md` + jedna linia w `readiness.md` | Trzy strumienie edytują `readiness.md` w H0–H3; bramka H3 i tak czyta tamten plik | Plan |
| Seat/uprawnienia | Zgoda warunkowa przed H0; potrzebę rozstrzyga `whoami` w kroku 0 | Zapis idzie przez tożsamość OAuth MCP, nie przez sesję przeglądarki; Starter bywa w tabeli Full seat | Plan + dokumentacja Figmy |
| Zakres próby | create + update + read na tym samym węźle | UI-03 wymaga realnej poprawki designu; wykrycie braku edycji w H12 byłoby poza oknem reakcji | Plan |
| Tryb uruchomienia | Interaktywny jako dowód, headless jako zapis faktu | W demo rysuje agent w sesji człowieka; headless ostrzega EXEC o granicach Cezara | Plan + `plan.md:188` |
| Timebox | Twardy stop o H3, blocker i eskalacja | UI-02 startuje o H4; bramka H3 potrzebuje uczciwego sygnału na czas | Plan |

## Scope

**W zakresie:** seat i prawa edycji, konfiguracja Figma MCP w obu klientach, sekwencja create → read → update → read, utrwalenie renderów z hashami, próba headless, zapis gotowości, odbiór zespołu.

**Poza zakresem:** własny serwer proxy lub edytor Figmy, pełne ekrany z wariantami mobile i stanami (UI-03), zmiany w design systemie OM, ręczny design jako zastępstwo, zakup seata w oknie, traktowanie próby headless jako bramki.

## Architecture / Approach

Trzy fazy w jednym oknie, każda kończąca się faktem nadającym się do zapisania także przy porażce. Kolejność wymuszona zależnością: seat i prawa edycji muszą być potwierdzone **przed** pełną konfiguracją, bo inaczej odmowa zapisu jest nieodróżnialna od błędu konfiguracji — a potwierdza je maszynowo `whoami` w kroku 0, nie ekran w przeglądarce. Dowodem jest sekwencja na tym samym `nodeId` — utworzenie drugiego frame'a obok pierwszego niczego nie dowodzi. Rendery pobierane są natychmiast po odczycie, razem z policzeniem hasha, bo adresy wygasają.

## Phases at a Glance

| Faza | Okno | Co dostarcza | Główne ryzyko |
|---|---|---|---|
| 1. Dostęp i konfiguracja | H0–H0:45 | Krok 0 (`whoami`/`create_new_file`), potwierdzony seat, MCP w kliencie podstawowym, szkielet artefaktu | Inne konto po stronie MCP niż w przeglądarce |
| 2. Próba write/update/read | H0:45–H2:15 | Manifest, rendery z hashami — dowód dla 1.2 | Agent tworzy obraz zamiast elementu natywnego |
| 3. Headless, artefakt, odbiór | H2:15–H3 | Zapis gotowości (`write` i `update` osobno), drugi klient, linia w `readiness.md`, odbiór 1.4 | Brak czasu na zapis wyniku po przeciągniętej próbie |

**Warunki startu:** zatwierdzona przed H0 warunkowa zgoda na upgrade konta Figma wraz ze sposobem płatności (potrzebę rozstrzyga krok 0); wskazane stanowisko demo z zalogowanym kontem i oboma klientami; dostępna osoba decyzyjna do eskalacji; wyznaczona osoba zaznaczająca wynik w Progress planu głównego.
**Nakład:** 3 h w jednym oknie H0–H3, jedna osoba ze strumienia UI.

## Open Risks & Assumptions

- Brak Figma write nie ma zatwierdzonego zastępstwa — status `blocked` oznacza otwartą blokadę FROM_BRIEF wchodzącą w H4, nie przejście na ręczny design. Eskalacja o H3 idzie z gotową tabelą wariantów (inne konto, wariant serwera, drugi klient, przesunięcie okna UI-03).
- Frame utworzony jako obraz zamiast elementu natywnego wygląda jak sukces, a uniemożliwia poprawkę wymaganą w UI-03 — stąd osobna kontrola edytowalności.
- Nieudana próba headless jest ograniczeniem dla EXEC, nie porażką UI-01; mieszanie tych dwóch statusów zafałszowałoby bramkę H3.
- Okno H0–H3 jest zajęte równolegle przez OSS-01, EXEC-01 i WP-M01 — zadanie nie może liczyć na cudze ręce.

## Success Criteria (Summary)

- Zespół widzi w Figmie ekran utworzony i poprawiony przez agenta, jako element edytowalny.
- W repo leży dowód, który przeżyje wygaśnięcie sesji: identyfikatory, rendery i zgodne hashe, z różnicą między stanem przed i po poprawce.
- Bramka H3 dostaje jednoznaczny status `ready` albo `blocked` z przyczyną, a wynik próby headless jest zapisany osobno.
