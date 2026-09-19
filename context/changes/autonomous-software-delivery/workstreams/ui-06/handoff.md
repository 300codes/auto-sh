# UI-06 — przekazanie przygotowania i blokad

Data: 2026-09-19. Rewizja audytu platformy: `42d14310679a9cc843eceae76497e06b22bddff7`.
**Implementacja pozostaje nieukończona.** W tej sesji przygotowano materiały operacyjne;
nie dostarczono integracji raportu D1–D3, pełnej próby ani prezentacji live.
`change.md` ma status `implementing`. Żadne kryterium wspólnego
[Progress](../../plan.md#progress), FLOW ani WP nie zostało zaliczone.

## Dostarczone pliki

- [demo-scenario.md](demo-scenario.md): fikcyjny brief, PL/EN, AC, role, kolejność obu wejść i live.
- [readiness.md](readiness.md): fakty, właściciele i warunki przyjęcia dostaw oraz dostępu.
- [rehearsal.md](rehearsal.md): protokół pomiaru i korelacji dowodów, rozdzielenie próby/live/replay, jawne `not_run`.
- [change.md](change.md) i sekcja Progress [planu](plan.md#progress--odwołanie-do-rejestru-kanonicznego): rozpoczęcie pracy i odnośniki, bez zaliczania odbioru.
- Ten handoff: granice wykonania i propozycja przekazania do QA.

Commit tej dokumentacji można wskazać przez `git log -1 --format=%H -- context/changes/autonomous-software-delivery/workstreams/ui-06/handoff.md`.
Nie jest on sourceRevision wygenerowanej witryny. W tej sesji taka witryna nie powstała.

## Bramka integracji fazy 2

Ścieżki poniżej są względne wobec `packages/core/src/modules/delivery_os/`.
To ponowny audyt kodu, nie przeniesienie wyniku wcześniejszego handoffu.

| Dostawa | Dowód w aktualnym kodzie | Skutek i warunek wznowienia |
|---|---|---|
| D1 | `api/projects/[id]/evidence/route.ts` eksportuje POST, nie GET. Brak odrębnego read route evidence | Nie można podłączyć listy/szczegółów. OSS dostarcza opublikowane scoped list/detail/attachment schema, endpointy, fixture i wyniki testów |
| D2 | `commands/reportQueries.ts` zwraca `DeliveryReportV1`; `api/projects/[id]/report/route.ts` publikuje v1. `commands/decisions.ts` używa dotychczasowych gates.publishable/releasable | Same typy flow nie dowodzą runtime. Wymagane jawne legacy/flow, projekcja i serwerowe etapowe bramki także wobec legacy mutacji |
| D3 | Raport opisuje domyślną rewizję jako newest accepted result; brak publicznego wskazania kandydata i jego kontroli przy decyzji | Wymagany kontrakt ID/version kandydata i dowód A/B/C dla git oraz WP snapshot; latest-result nie zastępuje kandydata |
| Integracja | `__integration__/TC-DELIVERY-UI-005.spec.ts` zawiera jawne skips D1/D2/D3 | Zastąpienie ich realnymi scenariuszami czeka na API; nie usunięto blokad ani nie dopisano pustych testów |

Szczegóły wymagań dostaw pozostają wyłącznie w [D1–D3 UI-05](../ui-05/oss-dependencies.md).

Istnieją częściowe dostawy F1: `ec0502d7a20835ec318f88891f25d3de32495bfb`
(intake/flow pin), `04e13ab01dbdb5e01ff0d37019b7dc27f1bb6474` (stage commands)
i `d593fff81c183ed47cb253002ce5e3fde4eb6e9c` (pure flow rules).
`lib/flowStatus.ts` ma `buildDeliveryReportFlowSection`, ale bez produkcyjnego
wywołania. Brakuje HTTP routes intake/stages/flow status; loader komentarzy
`loadStageCommentThreads` w `commands/stages.ts` zwraca pustą tablicę, a zapis
deferrals jest no-op. Te częściowe dostawy nie zamykają F1/F2 ani D2.
Wynik audytu dotyczy wskazanego checkoutu, nie nieznanych branchy innych właścicieli.

`EvidenceSources`, `EvidenceDetailDialog` i `ReleaseDecisionActions` nadal poprawnie
informują o brakach. Nie dodano niepodłączonych hooków/formularzy, nowych payloadów,
zmian backendu, publicznych kontraktów ani zależności produkcyjnych.

## Fazy 3 i 4

Nie odtworzono błędu UX na działającej aplikacji; nie ma podstaw do spekulacyjnego
refaktoru. Findings QA po wznowieniu powinny mieć kroki, plik/właściciela, wpływ,
poprawkę i wynik retestu końcowej rewizji. Braki dostaw w tabeli wyżej nie są
findings interakcji przeglądarkowej.

Pełna próba i live wymagają przyjęcia F0–F4, sesji operatora, osobnego dostępu do
komentarzy Figmy, uzgodnionego celu WP, zgodnych wersji/licencji i obecnego odbierającego.
Nie ma nowego projectId/baselineId/artifact ref, zgody ani deployment evidence z tej sesji.
Nie wykonywano migracji, publikacji, zakupów, push/PR ani wiadomości do innych osób.

## Weryfikacja i ograniczenie użytkownika

Użytkownik w tej sesji polecił pominąć kompleksowe testy i dopuścił wyłącznie nowe
testy albo TS nowych plików. Ma to pierwszeństwo przed pełnym gate opisanym w planie.
Nie powstały pliki TS ani zmiany zachowania; nie uruchamiano testów aplikacji i TS.
Nie oznacza to zniesienia wymagań końcowego odbioru przez QA.

Runner odczytów: **local**. `DOCKER_COMPOSE_FILE` nieustawione, brak lokalnych compose
overrides. Probe `docker compose --project-directory . -f starters/docker/compose.fullapp.dev.yml ps --status running -q app`
zwrócił exit 0 i pusty wynik. Probe `compose.fullapp.yml` zwrócił exit 1 z powodu
brakującego `JWT_SECRET`. `.ai/qa/ephemeral-env.json` nie istnieje. Nie sprawdzano stanu
tabel ani danych użytkowników; historyczne problemy bazy UI-03 nie są aktualnym dowodem.

Pełny gate, istniejące suites i integracje, i18n, lint, hydration, build/bundle,
pomiar odczytu oraz próba Figma/WP: **`not_run`**. Nowe dokumenty podlegają tylko
kontroli lokalnych referencji i formatowania diffu; wynik tych kontroli nie dowodzi API.

Kontrola dokumentacji: lokalny skrypt sprawdził 37 referencji w czterech nowych plikach
(wszystkie cele istnieją) i brak konkurencyjnych checklist; exit 0. `git diff --check`
również exit 0. To kontrole dokumentacji, nie testy aplikacji ani potwierdzenie kotwic HTML.

## Tekst do włączenia przez QA

To propozycja przekazania, bez edycji plików wspólnych i bez wysyłania wiadomości.
Oczekiwane pliki `hackathon/delivery-demo/runbook.md`, `acceptance.md` i `evidence-index.md`
nie istnieją w audytowanym checkoutcie. QA musi dostarczyć ich kanoniczne lokalizacje;
nie linkujemy ich jako istniejących dowodów.

Do runbooka: „UI-06 używa Pracowni Forma PL/EN i trzech oddzielnych projektów:
próba FROM_BRIEF, FROM_DESIGN do baseline oraz nowy FROM_BRIEF na pokazie. Cały design
live powstaje od zera. Zgody Scope/UX/KV/DS/UI, deploy i release są osobne. Aktualny
scenariusz i warunki rozpoczęcia znajdują się w workstreams/ui-06.”

Do indeksu dowodów: „Stan przekazania UI-06: przygotowanie dokumentacji, bez wykonania
FLOW/WP. D1/D2/D3 nieprzyjęte; testy i live not_run. Każdy przyszły wynik zawiera:
platform SHA, sourceRevision witryny, schema/profile/fixture versions, project/run/task/attempt
refs, baseline/hash, stage artifacts i zgody, kandydata, test IDs/komendy/exit codes/runner,
czas, surowy plik/hash i live/fixture/replay. Wynik na poprzedniej rewizji pozostaje historyczny.”

Do acceptance: „Dokumentacja UI-06 nie zalicza 5.1/5.4/6.1–6.5 ani FLOW-01…09/WP-01…05.
Brak security check, upload bez verify, stary stage/candidate i manual_handoff bez dowodów
nie dają PASS. Pełny verdict zapisuje odbierający po dowodach wszystkich właścicieli.”

QA po dostawie API rozszerza istniejące TC-DELIVERY-UI-003/004/005 o rzeczywisty flow,
oddzielne scope/ACL i aktualność decyzji; UI dostarcza testy nowych hooków/formularzy razem
z ich implementacją. Osobno należy odebrać zmiany evidence bez projectUpdatedAt,
guarded retry, 409/422/428 i niepewny POST bez duplikacji. Duplicate callback/restart
pozostają testami OSS/EXEC; UI pokazuje ich wynik. TC-UI-006 dodawać tylko dla uzgodnionej
luki przekrojowej. Ta lista wskazuje brakującą pracę, a nie wykonane coverage.
