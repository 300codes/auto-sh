# UI-01 — gotowość agentowego zapisu w Figmie

> Artefakt dowodowy zadania [UI-01](../../context/changes/autonomous-software-delivery/workstreams/ui-01/plan.md).
> Statusy kryteriów 1.2 i 1.4 **planu głównego** prowadzi wyłącznie
> [Progress planu głównego](../../context/changes/autonomous-software-delivery/plan.md#progress) — ten plik dostarcza fakty, nie zalicza bramek.
>
> Bez tokenów, ciasteczek i ścieżek do plików poświadczeń.

## Status

| Zdolność | Status | Przyczyna |
|---|---|---|
| `write` (utworzenie frame'a) | `ready` | agent utworzył frame `3:2` natywnymi elementami Figmy; render utrwalony |
| `update` (poprawka istniejącego węzła) | `ready` | ten sam węzeł `3:2` zmodyfikowany; render po zmianie ma inny hash |

Znacznik czasu: **2026-09-19T07:44:17Z**

Poprzedni zapis (2026-09-18T23:08:40Z) podawał `write=blocked`, `update=blocked` z przyczyną
„konfiguracja klienta — OAuth niewykonany”. Bloker został usunięty jednorazową autoryzacją
interaktywną opisaną niżej; ten plik zastępuje tamten stan.

## Stanowisko i klienci

| Pole | Wartość |
|---|---|
| Stanowisko | `ak-300codes` |
| Konto systemowe | `adam` |
| Konto Figma (tożsamość MCP) | `michal.strzesniewski@300.codes` (handle: Michał Strześniewski) |
| Rola / seat na pliku próby | Full seat; rola `admin` w planie `Michał Strześniewski's team`, właściciel pliku próby |
| Plan Figma | tier `starter` |
| Wariant serwera MCP | zdalny, `https://mcp.figma.com/mcp` |
| Klient podstawowy | Claude Code |
| Wersja klienta podstawowego | 2.1.266 |
| Klient drugi | Codex CLI — **nieobecny na stanowisku** (`codex: nie znaleziono polecenia`) |
| Wersja klienta drugiego | nie dotyczy |

Lokalny serwer MCP aplikacji desktopowej Figmy pozostaje niedostępny (`127.0.0.1:3845/mcp` nie
odpowiada, brak katalogu `~/.config/Figma`). Cała próba przebiegła na wariancie zdalnym, który
jest też wariantem wymaganym przez Figmę do zapisu na canvas.

## Krok 0 — tożsamość MCP i zdolność zapisu

| Próba | Wynik | Fakt |
|---|---|---|
| Autoryzacja OAuth serwera zdalnego | `ok` | wykonana raz, interaktywnie, przez człowieka na stanowisku demo; utrwalona w profilu klienta poza repo |
| `whoami` | `ok` | `michal.strzesniewski@300.codes`, seat `Full`, plan `starter`, rola `admin` |
| `create_new_file` | `ok` | plik próby utworzony, zwrócony `file_key` |

**Konsekwencja dla decyzji o upgrade planu Figma:** rozstrzygnięta — **upgrade niepotrzebny**.
Seat `Full` wystarcza do zapisu na canvas, a konto jest właścicielem pliku próby, więc warunek
„Full seat + prawo edycji pliku” jest spełniony bez angażowania osoby decyzyjnej od kosztów.

**Znane ograniczenie do zapisania, nie bloker:** tier `starter` z seatem Full daje 200 wywołań
dziennie i 10 na minutę na narzędziach odczytu; narzędzia zapisu są z limitu wyłączone. Pętla
poprawek w UI-03 opiera się na sekwencji zapis→odczyt, więc limit minutowy jest realny do
dotknięcia przy szybkiej iteracji na kilku ekranach. Planować odczyty oszczędnie.

## Lista narzędzi klienta podstawowego

Serwer po autoryzacji publikuje 37 narzędzi. Narzędzia zapisu obecne i potwierdzone użyciem:
`use_figma` (wykonane), `create_new_file` (wykonane), a ponadto `generate_figma_design`,
`generate_diagram`, `upload_assets`. Narzędzia odczytu użyte w próbie: `get_screenshot`,
`get_metadata`, `whoami`.

Obowiązkowe skille serwera wczytane przed wywołaniami zapisu: `figma-create-new-file`, `figma-use`.

## Plik roboczy w Figmie

| Pole | Wartość |
|---|---|
| `fileKey` | `5wOkFtN959W4MFmgRuaU8S` |
| Adres pliku | https://www.figma.com/design/5wOkFtN959W4MFmgRuaU8S |
| Nazwa | `UI-01 — próba agentowego zapisu` |

## Próba interaktywna (Faza 2)

Wynik: **`ok`**. Sekwencja `create` → `read` → `update` → `read` przeszła na kliencie podstawowym.

| Krok | Węzeł | Fakt |
|---|---|---|
| `create` | `3:2` | frame `UI-01 / Lista usług`, 1440×1024: nagłówek „Katalog usług”, pasek filtrów (pole wyszukiwania + selekty Kategoria/Dostępność), siatka 6 kart usługi z miniaturą, nazwą, opisem, ceną i przyciskiem „Zgłoś” |
| `read` | `3:2` | render pobrany i zahashowany natychmiast po odczycie |
| `update` | `3:2` | **ten sam** węzeł: pasek „Znaleziono 6 z 24 usług” z linkiem „Wyczyść filtry” wstawiony nad siatką, plakietka „Polecane” dodana w prawym górnym rogu pierwszej karty |
| `read` | `3:2` | render po zmianie, inny hash niż render `create` |

Frame jest **edytowalnym natywnym elementem Figmy**, nie obrazem: niezależny odczyt `get_metadata`
pokazuje drzewo 50 węzłów typu frame / text / rounded-rectangle / vector z auto-layoutem.

Polecenia w języku naturalnym, wydane przez człowieka i powtarzalne przez UI-03:
[`evidence/figma/prompts.md`](evidence/figma/prompts.md). Dowód: [`evidence/figma/manifest.json`](evidence/figma/manifest.json),
`SHA256SUMS` i dwa rendery PNG w tym samym katalogu. Kontrole: `./verify.sh` — 11/11 przeszło.

## Próba headless (Faza 3)

Wynik: **`ok`** — z jednym warunkiem operacyjnym, który musi znać EXEC.

Proces nieinteraktywny na koncie systemowym `adam`, w konfiguracji odpowiadającej temu, jak CLI
odpali Cezar, wykonał **rzeczywisty zapis**: utworzył osobny frame `6:2` (`UI-01 / Headless probe`)
z węzłem tekstowym, nie naruszając frame'a `3:2`. Potwierdzone niezależnym odczytem `get_metadata`
z sesji interaktywnej, a nie samym raportem procesu headless.

**Warunek:** autoryzacja OAuth musi być wcześniej wykonana raz interaktywnie i utrwalona w profilu
klienta — proces nieinteraktywny dziedziczy ją, ale nie potrafi jej przeprowadzić. Ponadto w trybie
nieinteraktywnym narzędzia MCP wymagają jawnego nadania uprawnień przy uruchomieniu
(`--allowedTools "mcp__figma__use_figma,…"`). Bez tego proces **widzi** narzędzia, lecz każde
wywołanie jest blokowane brakiem zgody i nie ma komu jej udzielić — dokładnie taki wynik dała
pierwsza próba w tym oknie, zanim uprawnienia nadano jawnie.

**Dla EXEC-01:** automatyczne rysowanie przez Cezara jest wykonalne na tym stanowisku. Wymaga
dwóch rzeczy: utrwalonej autoryzacji w profilu klienta oraz jawnej listy dozwolonych narzędzi w
komendzie uruchamiającej. Nie kopiowano żadnych plików sesji ani poświadczeń.

## Wynik drugiego klienta

`not_attempted` — Codex CLI nie jest zainstalowany na stanowisku demo. Zgodnie z kontraktem Fazy 1
drugi klient nie leży na ścieżce krytycznej i jego brak nie wpływa na status główny.

## Eskalacja

Brak. Status `write=ready`, `update=ready`; żaden z wariantów eskalacji z Fazy 3 planu nie ma
zastosowania.

## Odbiór zespołu

`pending` — dowód automatyczny jest kompletny, brakuje wyłącznie oglądania ekranu przez zespół.
Wypełnia osoba prowadząca UI-01 po odbiorze; nie zaznaczać na podstawie samego istnienia artefaktów.

| Pole | Wartość |
|---|---|
| Uczestnicy | — |
| Ekran powstał przez agenta | tak — sekwencja wykonana wyłącznie narzędziami MCP, bez ręcznego rysowania |
| Potwierdzony login konta demo | — do potwierdzenia w interfejsie Figmy |
| Potwierdzony Full seat | — do potwierdzenia w interfejsie Figmy (`whoami` zwraca `Full`) |
| Potwierdzone prawo edycji pliku | — do potwierdzenia w interfejsie Figmy (konto jest właścicielem pliku) |
| Zespół rozumie tryb Cezara (EXEC-01) | nie odnotowano — czeka na wynik EXEC-01 |
