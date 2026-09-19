# UI-01 — Potwierdzić agentowy zapis w Figmie

> Zadanie ze strumienia [UI](../03-design-ui.md). Kryteria odbioru i ich status należą do [planu głównego](../../plan.md#progress) — ten plik opisuje wykonanie, nie zalicza bramek.

## Overview

H0–H3, 3 h. Usunąć niepewność, czy agent potrafi zapisać i poprawić design w Figmie na tym stanowisku i koncie, którego użyje demo. Wynikiem nie jest kod, lecz trwały dowód write/update/read plus zapis gotowości, na którym bramka H3 podejmuje decyzję o dalszej inwestycji w FROM_BRIEF.

Zadanie zalicza Progress **1.2** (dowód maszynowy) i **1.4** (odbiór zespołu). Tryb wykonania Cezara potwierdza EXEC-01 — UI-01 dostarcza wyłącznie część figmową.

## Current State Analysis

- **Figma MCP nie jest jeszcze podłączony.** `claude mcp list` zwraca tylko Claude Docs i Gmail; w repo nie ma `.mcp.json`, a `~/.codex/config.toml` nie deklaruje żadnego serwera MCP. Konfiguracja obu klientów to praca do wykonania w tym oknie, nie stan zastany.
- **Konto Figma to Starter** z możliwością przejścia na Professional ([research.md](../../research.md) → tabela decyzji). Oficjalny zapis przez MCP wymaga Full seat i prawa edycji konkretnego pliku.
- **Istniejąca warstwa Figmy w repo jest niepowiązana z tym zadaniem.** `ds:code-connect:*` i `ds:tokens:figma` w `package.json:100-102` oraz `docs/design-system/figma-audit/` dotyczą design systemu OM, dla którego obowiązuje code-as-truth (`docs/design-system/testing-designer.md:218`). UI-01 dotyczy designu aplikacji klienta i nie zmienia tamtej reguły ani tamtych plików.
- **Brak katalogu `hackathon/delivery-demo/`.** Powstaje w Phase 1 planu głównego; `readiness.md` należy do OSS-01/EXEC-01, więc UI-01 wnosi tam wyłącznie jedną linię statusu.
- **Brak zatwierdzonego zastępstwa.** Plan główny (`plan.md:514`) i [README strumieni](../README.md) stwierdzają wprost: brak Figma write oznacza niezaliczony wymóg FROM_BRIEF; ręczne narysowanie designu przez człowieka go nie realizuje.

## Desired End State

Na stanowisku demo, w sesji i profilu używanym później w demo, agent utworzył frame w pliku Figma, następnie zmodyfikował ten sam węzeł i odczytał render po zmianie. W repo leży manifest z `fileKey`, `nodeId`, znacznikami czasu i sha256 renderów oraz same rendery jako pliki. `hackathon/delivery-demo/figma-readiness.md` zawiera dwa rozdzielone statusy — `write` (utworzenie frame'a) i `update` (poprawka istniejącego węzła) — każdy `ready` albo `blocked` z przyczyną, wynik próby headless jako osobny fakt oraz wersje klientów. W `readiness.md` jest jedna linia statusu z linkiem. Zespół obejrzał ekran i potwierdził login, Full seat i prawa edycji.

Weryfikacja: `sha256sum -c SHA256SUMS` w katalogu dowodów przechodzi po ponownym uruchomieniu, `file` rozpoznaje każdy render jako niepusty PNG, a skan `git grep` po wzorcach sekretów nie trafia w `figma-readiness.md` ani w katalog dowodów.

### Key Discoveries

- Oficjalny Figma MCP udostępnia `use_figma` i tworzenie natywnych elementów przez Plugin API, ze wsparciem Codex i Claude Code; wymaga Full seat i prawa edycji pliku ([write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/), [dostęp i limity](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), sprawdzone 2026-09-18).
- Dostępność narzędzia w jednej sesji nie dowodzi dostępności w procesie uruchomionym nieinteraktywnie (`plan.md:188`). Stąd rozdzielenie: sesja interaktywna jest dowodem, headless jest zapisem faktu dla EXEC.
- Adresy renderów Figmy wygasają. Plan główny odrzuca sam URL jako dowód i wymaga trwałych bytes/hash (`plan.md:292`, UI-03). UI-01 przyjmuje ten sam format wcześniej, żeby UI-03 go nie wymyślał od nowa.
- Bramka H3 czyta `readiness.md` ([README strumieni](../README.md) → Przekazania i zależności), więc blocker figmowy musi być widoczny w tym pliku, a nie tylko w artefakcie UI.
- Okno H0–H3 jest zajęte równolegle przez OSS-01, EXEC-01 i WP-M01. UI-01 nie może liczyć na cudze ręce ani na wspólną edycję tego samego pliku.

## What We're NOT Doing

- Nie budujemy własnego serwera proxy do Figmy, integracji zapisu ani edytora canvasu.
- Nie generujemy pełnych ekranów z wariantami mobile i stanami — to praca UI-03.
- Nie zmieniamy design systemu OM, `ds:code-connect:*`, `ds:tokens:figma` ani `docs/design-system/`.
- Nie przygotowujemy ręcznego designu jako zastępstwa; plan główny takiego fallbacku nie zatwierdza.
- Nie traktujemy próby headless jako bramki i nie blokujemy nią FROM_BRIEF.
- Nie wykonujemy zakupu seata w tym oknie — decyzja zapada przed H0 (patrz Warunki startu).
- Nie commitujemy tokenów, plików sesji ani konfiguracji poświadczeń.

## Implementation Approach

Trzy krótkie fazy w jednym 3-godzinnym oknie, ustawione tak, że każda kończy się faktem nadającym się do zapisania nawet przy porażce. Kolejność wynika z zależności: seat i prawa edycji muszą być rozstrzygnięte zanim konfiguracja MCP w ogóle może cokolwiek powiedzieć — inaczej odmowa zapisu jest nieodróżnialna od błędu konfiguracji.

Dowodem 1.2 jest sekwencja create → read → update → read na **tym samym** `nodeId`. Sam create nie wystarcza, bo UI-03 wymaga później realnej poprawki designu przez agenta; wykrycie braku edycji dopiero w H12 byłoby poza oknem reakcji.

Klienta są dwa — Claude Code i Codex CLI — ale nie są równorzędne w czasie. Jeden jest wskazany jako podstawowy i tylko on bramkuje próbę zapisu; drugi przechodzi próbę po rozstrzygnięciu, a jego wynik jest zapisywany w Fazie 3. Druga ścieżka zabezpiecza przed błędem konfiguracji jednego klienta, nie przed odmową na poziomie seat — ta dotknie obu tak samo, bo API jest to samo. Dlatego nie warto płacić za nią opóźnieniem rozstrzygnięcia.

O H3 obowiązuje twardy stop niezależnie od wyniku. UI-02 startuje o H4 i nie czeka.

## Critical Implementation Details

**Kolejność: seat przed konfiguracją.** Propagacja uprawnień w Figmie nie jest natychmiastowa, a brak Full seat objawia się odmową na poziomie narzędzia, nie na poziomie połączenia MCP. Jeśli konfiguracja klientów wyprzedzi potwierdzenie seata, zespół spędzi czas na debugowaniu konfiguracji, która jest poprawna. Źródłem prawdy o uprawnieniach jest odpowiedź `whoami` z kroku 0, a nie ekran ustawień w przeglądarce: zapis wykonuje tożsamość OAuth serwera MCP, która może być innym kontem niż zalogowana sesja. Ręczne potwierdzenie roli i prawa edycji konkretnego pliku w interfejsie Figmy zostaje jako kontrola dla odbioru 1.4 planu głównego, nie jako jedyna przesłanka przejścia do Fazy 2.

**Sesja demo, nie dowolna sesja.** Spec UI-01 zabrania traktowania dostępności narzędzia w innej sesji jako wyniku próby. Próba musi odbyć się na stanowisku, koncie systemowym i profilu klienta, których użyje demo, a `figma-readiness.md` ma te trzy rzeczy nazwać.

**Render pobiera się natychmiast.** Adres renderu zwrócony przez MCP wygasa. Pobranie pliku, policzenie sha256 i zapis do manifestu wykonać w tym samym kroku co odczyt, nie po zakończeniu obu operacji.

**Update dotyczy istniejącego węzła.** Utworzenie drugiego frame'a obok pierwszego nie dowodzi zdolności edycji. Manifest ma pokazywać ten sam `nodeId` w krokach `create` i `update`, a render po zmianie ma być wizualnie odróżnialny od poprzedniego.

## Phase 1: Dostęp, seat i konfiguracja klienta podstawowego

### Overview

H0–H0:45. Doprowadzić do stanu, w którym odmowa zapisu może znaczyć tylko jedno: że agent nie potrafi zapisać. Usunąć niejednoznaczność uprawnień i konfiguracji.

### Changes Required

#### 0. Próba wstępna: tożsamość MCP i zdolność zapisu

**Pliki:** `hackathon/delivery-demo/figma-readiness.md` (sekcja próby wstępnej)

**Intent:** Zanim cokolwiek zostanie kupione i skonfigurowane w drugim kliencie, uzyskać maszynową odpowiedź na dwa pytania: jakim kontem jest agent po stronie Figmy i czy to konto w ogóle może pisać.

**Contract:** Podłączyć zdalny serwer Figma MCP w jednym kliencie i wykonać `whoami` oraz `create_new_file` na koncie demo. Oba narzędzia są zwolnione z rate limitów, więc próba nie zużywa budżetu wywołań. Zapisać zwróconą tożsamość, seat i plan jako fakt maszynowy — to on, nie ekran w przeglądarce, rozstrzyga o uprawnieniach, bo zapis idzie przez tożsamość OAuth serwera MCP, która nie musi być tym samym kontem co zalogowana sesja przeglądarki. Jeśli `whoami` pokazuje inne konto niż demo, jest to blocker konfiguracji, nie uprawnień. Wynik kroku 0 decyduje, czy upgrade planu jest w ogóle potrzebny (patrz Warunki startu).

#### 1. Plik roboczy w Figmie

**Plik:** projekt Figma zespołu (zasób zewnętrzny, nie repo)

**Intent:** Utworzyć dedykowany plik na próbę i późniejszą pracę UI-03, żeby agent nie pisał do niczego istniejącego.

**Contract:** Nazwa zawierająca identyfikator zadania. Konto użyte w demo ma na tym pliku rolę z prawem edycji. `fileKey` i adres pliku zanotowane do manifestu. Potwierdzenie Full seat wykonane w ustawieniach zespołu, nie domniemane z faktu, że plik się otwiera.

#### 2. Konfiguracja MCP: klient podstawowy, potem drugi

**Pliki:** konfiguracja klienta Claude Code na stanowisku; `~/.codex/config.toml`

**Intent:** Podłączyć oficjalny serwer Figma MCP do Claude Code i Codex CLI na stanowisku demo i potwierdzić autoryzację w obu.

**Contract:** Konfiguracja pozostaje poza repo — żadnego `.mcp.json` z danymi konta w kontrolowanym katalogu. Zapisać: wariant serwera (zdalny albo lokalny serwer aplikacji desktopowej), jego adres, wersję klienta i wynik listowania narzędzi. Bramką przejścia do Fazy 2 jest wyłącznie klient podstawowy: narzędzie zapisu widoczne na jego liście dostępnych narzędzi. Drugiego klienta konfigurować dopiero po próbie zapisu, w czasie pozostałym — obsługa zdalnego serwera MCP z OAuth w Codex CLI nie jest zweryfikowana i nie może opóźniać rozstrzygnięcia. Brak narzędzia na liście jest wynikiem konfiguracji i nie jest jeszcze blockerem write.

#### 3. Szkielet artefaktu dowodowego

**Pliki:** `hackathon/delivery-demo/figma-readiness.md`, `hackathon/delivery-demo/evidence/figma/`

**Intent:** Założyć miejsce na dowód zanim powstanie, żeby zapis wyniku nie konkurował z kończącym się timeboxem.

**Contract:** `figma-readiness.md` jest własnością strumienia UI. Pola: status `write` (`ready` / `blocked`), osobny status `update` (`ready` / `blocked`), stanowisko i konto systemowe, konto Figma i rola, wariant serwera MCP, wersje obu klientów, wynik próby interaktywnej, osobny wynik próby headless, znacznik czasu, przyczyna blokady jeśli dotyczy. Bez tokenów, ciasteczek, ścieżek do plików poświadczeń i danych osobowych spoza nazwy konta.

### Success Criteria

#### Automated Verification

- Krok 0 zapisany: `whoami` zwrócił tożsamość, seat i plan, a zwrócone konto jest kontem demo; wynik `create_new_file` zapisany jako `ok` albo odmowa z przyczyną.
- `figma-readiness.md` i `evidence/figma/` istnieją; plik statusu ma wypełnione pola stanowiska, konta i wersji klientów.
- Repo nie zawiera tokenów ani plików poświadczeń Figmy: `git grep -nIE '(figd_|figu_|Bearer |access_token|refresh_token|client_secret)' -- hackathon/delivery-demo` nie zwraca trafień.
- Klient podstawowy listuje narzędzie zapisu Figmy; wynik listowania i wskazanie, który klient jest podstawowy, zapisane w `figma-readiness.md`.

#### Manual Verification

- Osoba prowadząca potwierdza w interfejsie Figmy Full seat i prawo edycji dokładnie tego pliku, na koncie używanym w demo.

**Implementation Note:** Nie przechodzić do Fazy 2 z niepotwierdzonym seatem — odmowa zapisu byłaby wtedy nieinterpretowalna.

---

## Phase 2: Próba write/update/read na stanowisku demo

### Overview

H0:45–H2:15. Wykonać i utrwalić sekwencję, która stanowi dowód dla kryterium 1.2. To jest jedyna faza, w której zapada rozstrzygnięcie o FROM_BRIEF.

### Changes Required

#### 1. Sekwencja agentowa

**Pliki:** brak zmian w repo; operacje w pliku Figma przez klienta MCP

**Intent:** Agent tworzy frame ekranu z referencyjnego scenariusza (lista usług lub formularz zgłoszenia z Phase 1 planu głównego), zwraca jego identyfikator, następnie na polecenie modyfikuje ten sam węzeł, a render odczytywany jest po każdej z dwóch operacji.

**Contract:** Cztery kroki w kolejności: `create` → `read` → `update` → `read`. `nodeId` w kroku `update` jest identyczny z `nodeId` z kroku `create`. Frame ma być edytowalnym natywnym elementem Figmy, nie obrazem wklejonym na canvas. Polecenia wydaje człowiek w języku naturalnym; treść poleceń trafia do artefaktu, żeby UI-03 mogło je powtórzyć. Dowodem jest przejście sekwencji na kliencie podstawowym. Próbę na drugim kliencie wykonać w Fazie 3, jeśli zostaje czas; jej wynik zapisuje się jako osobny fakt i nie wpływa na status główny.

#### 2. Utrwalenie renderów i manifest

**Pliki:** `hackathon/delivery-demo/evidence/figma/manifest.json`, `hackathon/delivery-demo/evidence/figma/SHA256SUMS`, `hackathon/delivery-demo/evidence/figma/*.png`

**Intent:** Zamienić ulotny wynik sesji w dowód, który przeżyje wygaśnięcie adresów renderu i zmianę sesji.

**Contract:** Manifest w wersjonowanym kształcie:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-09-19T00:00:00Z",
  "workstation": "<etykieta stanowiska>",
  "figma": { "fileKey": "...", "fileUrl": "...", "seat": "full", "role": "editor" },
  "client": { "name": "claude-code | codex-cli", "version": "...", "mcpServer": "..." },
  "steps": [
    { "op": "create", "nodeId": "...", "prompt": "...", "render": "create-<nodeId>.png", "sha256": "...", "bytes": 0, "at": "..." },
    { "op": "update", "nodeId": "...", "prompt": "...", "render": "update-<nodeId>.png", "sha256": "...", "bytes": 0, "at": "..." }
  ]
}
```

Obok manifestu zapisać `SHA256SUMS` w formacie `sha256sum` (jedna linia na render), żeby kontrola integralności była jedną komendą, a nie ręcznym porównaniem pól JSON. Rendery zapisane jako PNG, każdy do 1 MB, maksymalnie cztery pliki. Pobranie renderu, policzenie sha256 i wpis do manifestu następują bezpośrednio po odczycie. Rendery wchodzą do repo — bez nich manifest jest samą deklaracją. Adres renderu można zapisać dodatkowo, ale sam nie jest dowodem.

### Success Criteria

#### Automated Verification

- Manifest zawiera kroki `create` i `update` z identycznym `nodeId` oraz odwołania do istniejących plików renderu.
- `sha256sum -c SHA256SUMS` przechodzi, a wartości w `SHA256SUMS` zgadzają się z polami `sha256` manifestu.
- `file evidence/figma/*.png` rozpoznaje każdy plik jako PNG, a rozmiar każdego mieści się w zadeklarowanym limicie.
- Rendery `create` i `update` różnią się hashem, co odróżnia realną zmianę od powtórnego odczytu.

#### Manual Verification

- Operator otwiera plik w Figmie i widzi frame utworzony przez agenta jako element edytowalny, z naniesioną poprawką.
- Zespół potwierdza, że polecenia wydał człowiek, a rysowanie wykonał agent — nikt nie poprawił ekranu ręcznie.

**Implementation Note:** Przy niepowodzeniu nie przedłużać fazy kosztem Fazy 3. Zapis blockera z konkretną przyczyną ma wartość dla bramki H3; brak zapisu nie ma żadnej.

---

## Phase 3: Próba headless, artefakt i odbiór

### Overview

H2:15–H3. Domknąć zadanie faktem nadającym się do decyzji: zapisem gotowości, wpisem widocznym dla bramki H3 i odbiorem zespołu. Sprawdzić przy okazji, czy ta sama sekwencja działa w procesie nieinteraktywnym — to informacja dla EXEC, nie bramka.

### Changes Required

#### 1. Próba w procesie nieinteraktywnym

**Pliki:** `hackathon/delivery-demo/figma-readiness.md` (sekcja headless)

**Intent:** Uruchomić tę samą sekwencję z procesu nieinteraktywnego, na koncie systemowym i w konfiguracji odpowiadającej temu, jak CLI odpali Cezar, i zapisać wynik.

**Contract:** Wynik zapisany jako osobny fakt: `ok` albo `failed` z przyczyną. Niepowodzenie **nie** blokuje FROM_BRIEF i nie zmienia statusu głównego — w demo rysuje agent w sesji człowieka. Zapis ma jednoznacznie ostrzegać EXEC, jeśli automatyczne rysowanie przez Cezara nie będzie możliwe. Nie kopiować plików sesji ani poświadczeń w celu obejścia braku sesji. Jeśli próba padnie na konfiguracji, a nie na braku sesji, punktem startu jest istniejący wzorzec wywołania z orchestratora WP — Claude CLI z narzędziami read Figma MCP uruchamiany z procesu serwera ([research.md](../../research.md), wiersz „Import ekranów Figmy"; `src/server/modules/figma/service.js:156,218`). Kod jest na stanowisku Michała, który w tym oknie prowadzi WP-M01: poprosić o sam wzorzec wywołania, nie planować na tym zależności.

#### 2. Domknięcie artefaktu i wpis dla bramki H3

**Pliki:** `hackathon/delivery-demo/figma-readiness.md`, `hackathon/delivery-demo/readiness.md`

**Intent:** Uzupełnić plik UI o wynik obu prób i wskazać go ze wspólnego readiness, który czyta bramka H3.

**Contract:** W `readiness.md` jedna linia: status Figma `write` i osobno `update` (`ready` / `blocked`), data i odnośnik do `figma-readiness.md`. Rozdzielenie jest istotne dla bramki H3: `write=ready, update=blocked` spełnia kryterium 1.2 planu głównego, a zagraża wyłącznie pętli poprawek w UI-03 — to inna decyzja niż brak zapisu w ogóle. Nie dopisywać do `readiness.md` niczego poza tą linią — plik należy do OSS-01/EXEC-01 i jest edytowany równolegle. Przy statusie `blocked` przyczyna nazwana konkretnie (uprawnienia, konfiguracja klienta, odmowa narzędzia, brak czasu) i wskazana osoba decyzyjna do eskalacji. Eskalacja ma przedstawić wybór, nie sam problem — warianty ustalone przed H0:

| Wariant | Kiedy ma sens | Kto decyduje |
|---|---|---|
| Inne konto lub zespół Figma z potwierdzonym Full seat | `whoami` pokazuje niewystarczający seat lub obce konto | osoba decyzyjna (koszt/dostęp) |
| Desktop serwer MCP zamiast zdalnego (albo odwrotnie) | narzędzie nieobecne na liście mimo autoryzacji | prowadzący UI-01 samodzielnie |
| Drugi klient jako podstawowy | odmowa wygląda na błąd konkretnego klienta, nie na seat | prowadzący UI-01 samodzielnie |
| FROM_BRIEF uznane za niezaliczone; okno UI-03 (H6–H15) przesunięte na FROM_DESIGN i UI-04 | brak zapisu utrzymuje się do H3 | osoba decyzyjna, wpis do planu głównego |

Ręczne narysowanie designu przez człowieka nie jest żadnym z tych wariantów.

#### 3. Odbiór zespołu

**Pliki:** `hackathon/delivery-demo/figma-readiness.md` (sekcja odbioru)

**Intent:** Przeprowadzić oglądanie ekranu przez zespół, które zalicza kryterium 1.4 planu głównego.

**Contract:** Zapisane: kto uczestniczył, że ekran powstał przez agenta, potwierdzenie loginu, Full seat i prawa edycji, oraz że zespół rozumie tryb Cezara ustalony przez EXEC-01. Status 1.2 i 1.4 zaznacza w [Progress planu głównego](../../plan.md#progress) jedna wyznaczona osoba — nie tutaj i nie w dwóch miejscach naraz.

### Success Criteria

#### Automated Verification

- `figma-readiness.md` ma wypełnione oba statusy (`write` i `update`) oraz osobną sekcję headless z wynikiem `ok` lub `failed` i przyczyną.
- `readiness.md` zawiera dokładnie jedną linię ze statusami `write` i `update` oraz działającym odnośnikiem do artefaktu UI.
- Wynik drugiego klienta zapisany jako osobny fakt: `ok`, `failed` z przyczyną albo `not_attempted` z powodu braku czasu.
- Ten sam skan `git grep` po wzorcach sekretów, uruchomiony na komplecie artefaktów, nie zwraca trafień.

#### Manual Verification

- Zespół obejrzał ekran utworzony przez agenta i potwierdził login, Full seat oraz prawa edycji na stanowisku demo.
- Zespół rozumie, czy Cezar działa w trybie automatycznym czy `manual_handoff` — na podstawie wyniku EXEC-01.
- Przy statusie `blocked`: eskalacja przekazana osobie decyzyjnej przed H3, bez proponowania ręcznego designu jako zastępstwa.

**Implementation Note:** O H3 twardy stop niezależnie od wyniku. Wyznaczona osoba zaznacza 1.2 i 1.4 w Progress planu głównego dopiero po odbiorze; sam fakt powstania artefaktów niczego nie zalicza.

---

## Aneks — Faza 2: narzędzia dostarczone poza planem

Rozstrzygnięcie findingu F4 z [przeglądu wdrożenia](reviews/impl-review.md) (wariant Fix A).

Plan wymieniał dla Fazy 2 trzy artefakty — `manifest.json`, `SHA256SUMS`, `*.png` — i dla samej
sekwencji „brak zmian w repo". Repo zawiera ponadto trzy pliki, których plan nie przewidywał:

| Plik | Rola |
|---|---|
| `evidence/figma/capture.sh` | pobranie renderu, sha256 i wpis do manifestu w jednym kroku, zanim adres wygaśnie |
| `evidence/figma/verify.sh` | 11 kontroli odpowiadających kryteriom automatycznym Faz 2–3 |
| `evidence/figma/prompts.md` | treść poleceń człowieka, wprost wymagana kontraktem Fazy 2 do powtórzenia przez UI-03 |

Powstały w oknie, w którym bloker OAuth uniemożliwiał samą sekwencję. Po jego usunięciu
planowane artefakty **zostały dostarczone i przechodzą kontrole**, więc zarzut „narzędzia zamiast
artefaktów" wygasł; zostaje sam fakt, że trzy pliki nie miały umocowania w planie.

**Decyzja:** narzędzia zostają i przechodzą do zakresu UI-03 jako gotowy format dowodu —
odnotowane w [strumieniu UI](../03-design-ui.md). Plan główny wymaga trwałych bytes/hash
(`plan.md:292`), ale nie narzuca tej implementacji; właściciel UI-03 może format zmienić,
pod warunkiem zachowania bytes/hash i powiązania komentarza.


## Warunki startu

Ustalone przed H0, poza tym planem:

- Osoba decyzyjna zatwierdziła **warunkowo** upgrade konta Figma do planu dającego Full seat, wraz ze sposobem płatności. Czy upgrade jest potrzebny, rozstrzyga krok 0 Fazy 1: dokumentacja Figmy wymienia plan Starter w wierszu Dev/Full seat, więc konto demo może już mieć prawo zapisu. W oknie H0–H3 zostaje samo wykonanie decyzji, nie negocjacja zakupu.
- Wskazane stanowisko demo z zalogowanym kontem Figma oraz zainstalowanymi Claude Code i Codex CLI.
- Wyznaczona osoba prowadząca UI-01 i osoba decyzyjna do eskalacji dostępna w oknie H0–H3, zapoznana z tabelą wariantów eskalacji z Fazy 3.
- Ustalone, kto z zespołu zaznacza wynik w Progress planu głównego.

## Weryfikacja

### Kontrole automatyczne

- Integralność manifestu: `sha256sum -c SHA256SUMS`, `file` na plikach renderu, różnica hashy między `create` i `update`, identyczny `nodeId` w obu krokach.
- Higiena artefaktów: brak sekretów, limity rozmiaru renderów, poprawne odnośniki między `readiness.md` a `figma-readiness.md`.

### Kontrola ręczna

1. Otworzyć plik w Figmie i sprawdzić, że frame jest edytowalnym elementem natywnym, nie obrazem.
2. Porównać oba rendery i potwierdzić, że poprawka jest widoczna.
3. Przeczytać `figma-readiness.md` i sprawdzić, czy da się z niego odtworzyć próbę: stanowisko, konto, klient, wersja, polecenia.
4. Sprawdzić, że wynik headless jest zapisany jako osobny fakt i nie miesza się ze statusami `write` i `update`.

## Ryzyka

| Ryzyko | Sygnał | Reakcja |
|---|---|---|
| Seat lub prawa edycji niedostępne o czasie | Odmowa narzędzia mimo poprawnej konfiguracji | Status `blocked` z przyczyną „uprawnienia", eskalacja przed H3 z tabelą wariantów z Fazy 3; nie zastępować ręcznym designem |
| Narzędzie zapisu nieobecne w kliencie podstawowym | Brak narzędzia na liście po konfiguracji | Sprawdzić drugi wariant serwera MCP (desktop zamiast remote), potem drugiego klienta; przy dalszym braku zapisać blocker konfiguracji |
| Agent tworzy obraz zamiast elementu natywnego | Frame nieedytowalny w Figmie | `write=ready`, `update=blocked` z przyczyną „element nienatywny"; blokuje poprawkę w UI-03, nie samo utworzenie ekranu |
| Próba headless nie działa | `failed` w sekcji headless | Nie blokować FROM_BRIEF; przekazać EXEC jako ograniczenie automatycznego rysowania przez Cezara |
| Timebox mija bez rozstrzygnięcia | Godzina H3 | Twardy stop, status `blocked` z przyczyną „brak czasu", decyzja o wariancie (d) — przesunięciu okna UI-03 — podjęta przez osobę decyzyjną; UI-02 startuje planowo o H4 |

## References

- Zadanie źródłowe: [UI-01 w strumieniu UI](../03-design-ui.md)
- Kryteria i Progress: [plan główny](../../plan.md#progress) — pozycje 1.2 i 1.4
- Kontekst Phase 1: [plan główny](../../plan.md) → „Phase 1: Próby integracji i zamrożenie scenariusza"
- Ustalenia o Figmie i seacie: [research.md](../../research.md) → „Figma: zapis przez oficjalny MCP jest dostępny"
- Harmonogram i przekazania: [README strumieni](../README.md)
- [Figma MCP — write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/), [dostęp i limity](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)

## Progress

> Robocza lista kroków wykonania tego zadania. **Nie jest drugą checklistą odbioru** — status kryteriów 1.2 i 1.4 prowadzi wyłącznie [Progress planu głównego](../../plan.md#progress), zgodnie z regułą z [README strumieni](../README.md). Konwencja: `- [ ]` oczekuje, `- [x]` wykonane, po wdrożeniu dopisz ` — <commit sha>`.

### Phase 1: Dostęp, seat i konfiguracja klienta podstawowego

#### Automated

- [x] 1.1 Krok 0 zapisany: `whoami` zwrócił tożsamość, seat i plan zgodne z kontem demo; wynik `create_new_file` zapisany. — 6e7e5928a3
- [x] 1.2 `figma-readiness.md` i `evidence/figma/` istnieją; pola stanowiska, konta i wersji klientów wypełnione. — d7834d82b7
- [x] 1.3 `git grep` po wzorcach sekretów w `hackathon/delivery-demo` nie zwraca trafień. — d669e82732
- [x] 1.4 Klient podstawowy listuje narzędzie zapisu Figmy; wynik i wskazanie klienta podstawowego zapisane w artefakcie. — 6e7e5928a3

#### Manual

- [ ] 1.5 Potwierdzony Full seat i prawo edycji pliku na koncie używanym w demo.

### Phase 2: Próba write/update/read na stanowisku demo

#### Automated

- [x] 2.1 Manifest zawiera `create` i `update` z identycznym `nodeId` oraz istniejące pliki renderu. — 6e7e5928a3
- [x] 2.2 `sha256sum -c SHA256SUMS` przechodzi i zgadza się z polami `sha256` manifestu. — 6e7e5928a3
- [x] 2.3 `file` rozpoznaje każdy render jako PNG, rozmiary w limicie. — 6e7e5928a3
- [x] 2.4 Hashe renderów `create` i `update` różnią się. — 6e7e5928a3

#### Manual

- [ ] 2.5 Operator widzi w Figmie edytowalny frame agenta z naniesioną poprawką.
- [ ] 2.6 Zespół potwierdza, że rysował agent, a nie człowiek.

### Phase 3: Próba headless, artefakt i odbiór

#### Automated

- [x] 3.1 `figma-readiness.md` ma statusy `write` i `update` oraz osobną sekcję headless z wynikiem i przyczyną. — d669e82732
- [x] 3.2 `readiness.md` zawiera jedną linię ze statusami `write` i `update` oraz działającym odnośnikiem. — dcadbf3e6b
- [x] 3.3 Wynik drugiego klienta zapisany jako osobny fakt (`ok` / `failed` z przyczyną / `not_attempted`). — d669e82732
- [x] 3.4 Skan `git grep` na komplecie artefaktów nie zwraca trafień. — dcadbf3e6b

#### Manual

- [ ] 3.5 Zespół obejrzał ekran i potwierdził login, Full seat oraz prawa edycji.
- [ ] 3.6 Zespół rozumie tryb Cezara ustalony przez EXEC-01.
- [ ] 3.7 Przy `blocked`: eskalacja przekazana przed H3, bez ręcznego designu jako zastępstwa.
