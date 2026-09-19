# Pakiet do rozdania — domyślny flow i WordPress demo

Każdemu przekaż [dodatek do specyfikacji](../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md), ten README oraz jego plik poniżej. Przydział kontynuuje dotychczasowe role z `workstreams/next-tasks-2026-09-19.md`.

| Osoba | Plik | Odpowiedzialność |
|---|---|---|
| Mateusz | [01-mateusz-domain.md](01-mateusz-domain.md) | Kontrakty, etapowe approvals, wersje artefaktów, powiązanie staff i idempotencja importu |
| Marcin | [02-marcin-flow-execution.md](02-marcin-flow-execution.md) | Workflow projektu, agent scoping, ustawienia/builder API, wykonanie i WP host |
| Adam | [03-adam-ui-figma.md](03-adam-ui-figma.md) | Portfolio/wizard, UI zgód, Figma UX/KV/DS/UI, provider komentarzy i frontend ustawień |
| Michał | [04-michal-wordpress-qa.md](04-michal-wordpress-qa.md) | Narzędzia WP, publikacja i QA całego procesu |

## Start i kolejność integracji

1. F0: Mateusz publikuje kontrakty i fixture; pozostali podają potrzebne operacje, wyniki probe i estymaty. Dalsze rozszerzenia szczegółowych specyfikacji są częścią zadania właściciela. Nie zgadujemy payloadów w równoległych branchach.
2. Mateusz i Adam łączą projekty/Scope/zgody. Marcin dostarcza agentowy scoping przez istniejącą warstwę wykonania; agent tylko proponuje.
3. Adam generuje i wersjonuje UX/KV/DS/UI oraz pobiera komentarze. Mateusz dostarcza import/linkowanie do staff; wspólnie odbierają Kanban.
4. Marcin integruje proces i przypięcie wersji; Adam wejście z ustawień i builder UI. Nie budują drugiego edytora grafu.
5. Marcin + Michał łączą realne WP z wynikiem w OM; Adam pokazuje raport. Michał prowadzi pełną próbę i sprawdza publikację.

Po F0 prace backend/UI/adaptery/testy mogą iść równolegle na wspólnych fixture. Zgody, kontrakty i dowody są punktami synchronizacji, nie zadaniami „do dopisania na końcu”. Wspólne pliki domeny i rejestrów edytuje Mateusz; enterprise Marcin; UI i pakiet Figma Adam; pakiet WP Michał. Zmiany staff/workflows uzgadnia odpowiedzialny właściciel z Mateuszem, zachowując publiczne seams.

## Demo do wspólnego odbioru

Z pustego portfolio tworzymy projekt → uzupełniamy i wznawiamy brief → agent doprecyzowuje Scope → wybieramy WordPress → zatwierdzamy Scope → powstaje UX w Figmie → nowy komentarz daje kartę Kanbana OM → poprawka i akceptacja UX → Key Visual i akceptacja klienta → DS/UI i akceptacja klienta → realna implementacja WP i QA → zgoda publikacji → działający URL i odbiór. Oddzielnie pokazujemy zmianę flow w ustawieniach i nowy projekt na v2 przy starym pozostającym na v1.

PASS wymaga wszystkich FLOW-01…09 z dodatku. Snapshot motywu ani localhost nie zastępuje publikacji na docelowy, uzgodniony adres. Dane klienta/połączenia Figma/cel publikacji ustalamy przed próbą live; nie wpisujemy fikcyjnych dowodów.

## Budżet i zakres

Nie obowiązuje automatyczne zapewnienie, że nowe wymagania zmieszczą się w poprzednich 36 h lub WP 6 h. Dostarczamy nową estymatę; nie przekraczamy budżetu ani nie redukujemy zakresu bez decyzji użytkownika. Flow builder, klientowskie zgody i WordPress E2E są wymaganiami nowego odbioru.

W repo są już niezwiązane, niezatwierdzone zmiany QA/readiness; nie nadpisywać ich. Ten pakiet nie zmienia ich statusu i nie zalicza dawnego Progress.
