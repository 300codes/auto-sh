# Integracja nocnych zmian — 2026-09-19

## Zakres i stan

Scalono roboczo trzy strumienie bez konfliktów, zachowując lokalny commit `94f477e67` (drzewo zadań) i nowe dokumenty `origin/main` (`54e8f0482`). Wynik jest na gałęzi `integration/overnight-20260919`; stan publikacji zostanie zapisany po gate.

| Branch | Head objęty przeglądem | Zakres |
|---|---|---|
| dev-mateusz | c24ac8ba8 | OSS-01–03 i część OSS-04; domena delivery_os, API i testy |
| feature/design-ui | 9a08a7952 | Dokumentacja UI-01 i narzędzia dowodowe Figmy |
| feat/wp-m01-studio-tools | 2018cf295 | Niezależny pakiet WordPress Studio |

Referencje PR odczytane przez git zawierają jedynie cztery aktualizacje Dependabota, których nie obejmuje ta integracja. GitHub connector zwrócił brak dostępu do repozytorium; CLI gh nie jest zainstalowane. Nie wykonano oceny etykiet/checków GitHuba ani zmian workflow, PR-ów czy Issues. Push przez istniejący SSH jest osobną operacją.

## Poprawki integracyjne

- Rejestracja delivery_os jest zgodna w aplikacji i szablonie create-app.
- Uzupełniono 18 opisów audytu delivery_os i 8 pozycji centralnego katalogu ACL w EN/PL/DE/ES/KO.
- Dodano jawne komparatory UTF-16 w hashowaniu, normalizacji evidence i scaffoldzie, bez zmiany kolejności ani hashy.
- WordPress dziedziczy root typeRoots, dzięki czemu build znajduje typy Node po standardowym hoistingu Yarn.
- Capture Figmy waliduje tymczasowy PNG, zanim zastąpi poprzedni render. Nieudany retry nie usuwa dowodu.
- Verifier Figmy skanuje także nieśledzone/ignorowane artefakty i pokazuje wyłącznie nazwy plików z potencjalnym sekretem.
- Test po stronie konsumenta OSS potwierdza zgodność snapshotu WP i odrzuca raport narzędziowy jako ResultManifest/ResultCheck.
- Ekran szczegółów projektu pobiera scoped API i przekazuje walidowany context v1 do rzeczywistego InjectionSpot. Serwerowa strona używa osobnej wyspy klienta; stałe walidacji nie wciągają node:crypto do przeglądarki, a dotychczasowe eksporty są zachowane.
- Readiness i lista kolejnych zadań łączą workstreamy. Raport EXEC-01 nie oznacza już concurrency workera jako udowodnionej przez samą konfigurację.

## Granice aktualnego działania

Wynik OSS kończy się na awaiting_review. R18 reconcile i R19 generic evidence doszły w dwóch kolejnych commitach podczas integracji. Nadal brakuje review evidence (kind=review jest odrzucany), R20/R21 decyzji deploy/release i R22 report. Istnieje minimalny ekran szczegółów projektu z hostem rozszerzenia execution. Lista projektów, baseline UI i enterprise provider/bridge pozostają do zrobienia. Figma ma blocked write/update. WordPress nie ma hosta integracji OM→WP→OM; jego lokalny raport nie jest dowodem AC domeny. Nie zmieniono tych stanów na PASS i nie stworzono zastępczych dowodów.

Nie wykonano migracji bazy ani publikacji preview. Schemat i migracja dodają nowy moduł; nie usuwają istniejących kontraktów. Do odbioru nowej funkcji potrzebne są testy integracyjne z rzeczywistą bazą i autoryzacją, w tym izolacja scope, optimistic lock, up/down migracji oraz pełny przebieg kolejki.

## Walidacja

Runner: **local**, Node 24.13.1. Docker Desktop nie udostępnia silnika w tym WSL. Zależności pobrano z istniejącego yarn.lock. Natywny isolated-vm wymagał przebudowania tymczasowym GCC12 w /tmp; testy używają LD_LIBRARY_PATH=/tmp/auto-sh-gcc-env/lib oraz --env-mode=loose, aby Turbo przekazało ścieżkę do procesów testowych. Smoke rzeczywistego izolatu zwrócił 42. Nie zmieniono bibliotek systemowych ani zależności projektu.

| Kontrola | Wynik |
|---|---|
| OSS delivery_os (Jest) | Końcowy wynik w pełnym gate poniżej; zawiera 4 przypadki WP consumer contract |
| WordPress native tests | PASS — 29/29; poza sandboxem ze względu na subprocessy i localhost HTTP |
| WordPress typecheck + build | PASS po poprawce typeRoots |
| Figma regressions | PASS — 2 testy z mockiem curl i syntetycznym PNG |
| bash -n capture/verify | PASS |
| git diff --check | PASS |
| Pierwszy build pakietów | PASS — 39/39, 6m29s |
| Template parity | PASS po dodaniu rejestracji modułu w template |
| i18n:check-usage | PASS po uzupełnieniu tłumaczeń; unused keys są advisory |
| typecheck | PASS — 39/39 z concurrency=1; aplikacja osobno PASS z GOMEMLIMIT=2GiB, GOGC=50 |
| ACL catalog test | PASS — 1/1 po dodaniu opisów |
| build:app | PASS — kompilacja, TypeScript i renderowanie tras |
| Host UI | PASS — 7 testów komponentu, 294 testy module-facts; Playwright discovery: 1 test, wykonanie live oczekuje |
| Pełne testy po poprawkach | W toku — końcowe wyniki poniżej po wykonaniu |

Testy zapisanych raportów WP nie są nowym live PoC; testy Figmy nie wywołują Figmy. Poprzednie logi autorów służą kontekstowi, nie zastępują kontroli wspólnej rewizji.

## Kolejna runda

[Lista dla czterech osób i kolejność połączeń](workstreams/next-tasks-2026-09-19.md). Najpierw Mateusz kończy review/lifecycle, Marcin provider i worker, Adam Figma/UI projektów, Michał gate/scoped integration i WP-M02 po dostępności hosta.
