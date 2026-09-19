# UI-01 — gotowość agentowego zapisu w Figmie

> Artefakt dowodowy zadania [UI-01](../../context/changes/autonomous-software-delivery/workstreams/ui-01/plan.md).
> Statusy kryteriów 1.2 i 1.4 **planu głównego** prowadzi wyłącznie
> [Progress planu głównego](../../context/changes/autonomous-software-delivery/plan.md#progress) — ten plik dostarcza fakty, nie zalicza bramek.
>
> Bez tokenów, ciasteczek i ścieżek do plików poświadczeń.

## Status

| Zdolność | Status | Przyczyna |
|---|---|---|
| `write` (utworzenie frame'a) | `blocked` | konfiguracja klienta — serwer Figma MCP nie jest autoryzowany (OAuth niewykonany) |
| `update` (poprawka istniejącego węzła) | `blocked` | niesprawdzalne przed odblokowaniem `write` |

Znacznik czasu: **2026-09-18T23:08:40Z**

## Stanowisko i klienci

| Pole | Wartość |
|---|---|
| Stanowisko | `ak-300codes` |
| Konto systemowe | `adam` |
| Konto Figma (tożsamość MCP) | nieustalone — `whoami` niewywoływalne przed autoryzacją |
| Rola / seat na pliku próby | nieustalone |
| Wariant serwera MCP | zdalny, `https://mcp.figma.com/mcp` |
| Klient podstawowy | Claude Code |
| Wersja klienta podstawowego | 2.1.266 |
| Klient drugi | Codex CLI — **nieobecny na stanowisku** (`codex: nie znaleziono polecenia`) |
| Wersja klienta drugiego | nie dotyczy |

Lokalny serwer MCP aplikacji desktopowej Figmy nie jest dostępny: `127.0.0.1:3845/mcp` nie odpowiada, brak katalogu `~/.config/Figma`. Pozostaje wariant zdalny.

## Krok 0 — tożsamość MCP i zdolność zapisu

Cel kroku: uzyskać maszynową odpowiedź na pytania „jakim kontem jest agent po stronie Figmy" i „czy to konto może pisać", **zanim** zapadnie decyzja o upgrade planu.

| Próba | Wynik | Fakt |
|---|---|---|
| Rejestracja serwera MCP w kliencie podstawowym | `ok` | `claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp` → dodane do konfiguracji użytkownika (poza repo) |
| Health check serwera | `needs authentication` | `claude mcp list` → `figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication` |
| `whoami` | `not_attempted` | narzędzie niewidoczne przed autoryzacją OAuth — brak tożsamości, seata i planu do zapisania |
| `create_new_file` | `not_attempted` | jw. |

**Interpretacja:** to jest blocker **konfiguracji**, nie uprawnień. Autoryzacja OAuth zdalnego serwera Figma MCP jest interaktywna — wymaga polecenia `/mcp` w sesji Claude Code i logowania w przeglądarce na koncie demo. Nie da się jej wykonać z procesu nieinteraktywnego ani z narzędzia Bash wewnątrz trwającej sesji. Dopóki nie zostanie wykonana, odmowa zapisu byłaby nieinterpretowalna — dokładnie stan, przed którym ostrzega Implementation Note Fazy 1.

**Konsekwencja dla decyzji o upgrade planu Figma:** nierozstrzygnięta. Krok 0 miał ją rozstrzygnąć maszynowo i tego nie zrobił, bo nie doszedł do `whoami`.

## Lista narzędzi klienta podstawowego

Nieustalona. Serwer w stanie `Needs authentication` nie publikuje listy narzędzi, więc obecność narzędzia zapisu (`use_figma` / tworzenie natywnych elementów przez Plugin API) pozostaje niepotwierdzona. Zgodnie z kontraktem Fazy 1 brak narzędzia na liście **nie** jest jeszcze blockerem `write` — jest blockerem konfiguracji.

## Plik roboczy w Figmie

| Pole | Wartość |
|---|---|
| `fileKey` | nieustalony |
| Adres pliku | nieustalony |

Plik nie został utworzony: `create_new_file` należy do kroku 0 i nie był wywoływalny.

## Próba interaktywna (Faza 2)

`not_attempted` — sekwencja `create` → `read` → `update` → `read` nie została uruchomiona, bo bramka Fazy 1 (narzędzie zapisu widoczne w kliencie podstawowym) nie została przekroczona.

Polecenia w języku naturalnym przygotowane dla tej sekwencji, do powtórzenia przez UI-03, znajdują się w [`evidence/figma/prompts.md`](evidence/figma/prompts.md).

## Próba headless (Faza 3)

Wynik: **`failed`**

Próba wykonana, nie przewidziana. Komenda uruchomiona z procesu nieinteraktywnego na koncie systemowym `adam`, w konfiguracji odpowiadającej temu, jak CLI odpali Cezar:

```
claude -p "Wypisz dokładne nazwy wszystkich dostępnych narzędzi MCP serwera 'figma'. …"
```

Odpowiedź procesu (zacytowana):

> Serwer MCP 'figma' wymaga uwierzytelnienia przed udostępnieniem narzędzi. […]
> Dla innych serwerów: uruchomić `claude mcp` lub `/mcp` w sesji interaktywnej.
> **Narzędzia nie są dostępne w bieżącej nieinteraktywnej sesji.**

Przyczyna: proces nieinteraktywny dziedziczy tę samą niezautoryzowaną konfigurację serwera MCP, co sesja interaktywna. Autoryzacja OAuth jest warunkiem wcześniejszym i nie jest osiągalna z procesu nieinteraktywnego — nie istnieje ścieżka „zaloguj się w przeglądarce" bez człowieka.

**Wynik jest niekonkluzywny co do trybu Cezara.** Mierzy brak autoryzacji, nie zdolność procesu headless do rysowania. Rozstrzygnięcie wymaga powtórzenia próby po jednorazowej autoryzacji w profilu klienta na stanowisku demo.

**Ten wynik nie blokuje FROM_BRIEF** i nie zmienia statusu głównego — w demo rysuje agent w sesji człowieka.

**Ostrzeżenie dla EXEC-01:** dopóki autoryzacja nie zostanie wykonana raz i utrwalona w profilu klienta na stanowisku demo, Cezar **nie** będzie mógł rysować automatycznie. Po jednorazowej autoryzacji próbę headless należy powtórzyć — dopiero wtedy wynik odpowie na pytanie o tryb automatyczny. Żadnych plików sesji ani poświadczeń nie kopiowano w celu obejścia braku sesji.

Przy awarii konfiguracji, a nie braku sesji, punktem startu jest istniejący wzorzec wywołania z orchestratora WP — Claude CLI z narzędziami read Figma MCP uruchamiany z procesu serwera (`src/server/modules/figma/service.js:156,218`, patrz [research.md](../../context/changes/autonomous-software-delivery/research.md), wiersz „Import ekranów Figmy"). Kod jest na stanowisku Michała; to prośba o sam wzorzec, nie zależność.

## Wynik drugiego klienta

`not_attempted` — Codex CLI nie jest zainstalowany na stanowisku demo. Zgodnie z kontraktem Fazy 1 drugi klient nie leży na ścieżce krytycznej i jego brak nie wpływa na status główny. Instalacja i konfiguracja to praca do wykonania w czasie pozostałym, po rozstrzygnięciu zapisu.

## Eskalacja

Status `blocked` z przyczyną **konfiguracja klienta**. Wariant do zastosowania — wiersz drugi tabeli z Fazy 3 planu, decyzja po stronie prowadzącego UI-01, bez angażowania osoby decyzyjnej od kosztów:

1. Człowiek wykonuje w sesji Claude Code na stanowisku demo polecenie `/mcp`, wybiera serwer `figma` i autoryzuje go w przeglądarce **na koncie demo**.
2. Bezpośrednio po tym agent powtarza krok 0: `whoami` → tożsamość, seat, plan; `create_new_file` → plik próby.
3. Dopiero odpowiedź `whoami` rozstrzyga, czy potrzebny jest upgrade planu Figma i czy zaangażować osobę decyzyjną od kosztów.

Ręczne narysowanie designu przez człowieka nie jest wariantem eskalacji.

## Odbiór zespołu

`not_attempted` — nie ma czego oglądać: agent nie utworzył ekranu.

| Pole | Wartość |
|---|---|
| Uczestnicy | — |
| Ekran powstał przez agenta | nie |
| Potwierdzony login konta demo | nie |
| Potwierdzony Full seat | nie |
| Potwierdzone prawo edycji pliku | nie |
| Zespół rozumie tryb Cezara (EXEC-01) | nie odnotowano |
