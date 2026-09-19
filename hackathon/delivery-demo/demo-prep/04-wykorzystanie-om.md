# Co konkretnie wykorzystaliśmy z Open Mercato

Notatka techniczna dla prowadzącego i slajdu architektury. Przegląd kodu2026-09-19;
obecność callsite nie jest dowodem odebranej integracji live na komputerze demo.

| Gotowy element OM | Nasze rzeczywiste użycie | Źródło | Dowód dla jury |
|---|---|---|---|
| UI: DataTable i CrudForm | Lista i formularz projektu w istniejącym backoffice | `packages/core/src/modules/delivery_os/components/projects/DeliveryProjectListClient.tsx`, `DeliveryProjectForm.tsx` | Pokazać projekt w natywnym UI; nie opowiadać o nowym osobnym panelu |
| Auth, RBAC, scope | Guardy decyzji i scope organizacji | `packages/core/src/modules/delivery_os/api/baselines/[id]/decisions/route.ts`, `api/routeSupport.ts` | Uprawniony aktor zatwierdza; zapis testu odmowy dostępny do pytań |
| Command bus i mechanizm logowania operacji | Wykonanie komend domeny i budowanie ich logów | `packages/core/src/modules/delivery_os/api/routeSupport.ts`, `commands/decisions.ts` | Decyzja i jej historia; nasze reguły domenowe działają przez wspólny mechanizm |
| Workflows | Próba wykonania korzysta z workflowExecutor i WAIT_FOR_SIGNAL | `packages/enterprise/src/modules/delivery_agents/lib/executionBridge.ts`, `lib/attemptWorkflow.ts` | Rzeczywiste oczekiwanie i wznowienie po wyniku; wymaga potwierdzonego EXEC live |
| Queue/worker contract | Zadanie trafia do modułowej kolejki i workera OM | `packages/enterprise/src/modules/delivery_agents/lib/queue.ts`, `workers/execute-task.ts` | Zlecenie w UI → właściwe wykonanie asynchroniczne; nie sam komunikat202 |

## Co jest naszym wkładem

Domena delivery_os: baseline, wersje i zgody, zadania/próby, kontrola dowodów oraz
report/release gates. delivery_agents łączy ją z wykonaniem. Operator WP, snapshoty,
mapper wyniku i przygotowanie Preview są rozszerzeniami integrującymi narzędzia.
Figma, executor CLI i WordPress Studio to narzędzia zewnętrzne, nie wbudowane funkcje OM.

Zdanie na slajd: „Na istniejącym UI, uprawnieniach, komendach, workflow i workerach
OM zbudowaliśmy proces realizacji zlecenia z wersjonowanym odbiorem.” Używać jako
opisu zintegrowanego działania dopiero po właściwym odbiorze; wcześniej opis architektury.

## Twierdzenia wymagające dodatkowego potwierdzenia

- Staff/Kanban: istnieje moduł OM i kontrakt powiązania; w tym przeglądzie nie znaleziono
  działającego callsite synchronizacji komentarzy. Mateusz/Adam potwierdzają kod
  i rzeczywisty import. Nie umieszczać go jako „wdrożone” tylko na podstawie specyfikacji.
- Konfigurowalny workflow całego projektu nie jest tym samym co workflow próby
  z WAIT_FOR_SIGNAL. Builder, publikacja wersji i pin wymagają oddzielnego dowodu.
- OM AI framework: nie deklarować jego użycia dlatego, że działa zewnętrzny executor
  lub import propozycji. Wskazać konkretną rejestrację/agenta i wykonanie, jeśli są.
- Settings logowania narzędzi to osobny nowy backlog, nie istniejąca funkcja demo.

Jeżeli do próby generalnej zabraknie odebranego Figma→Kanban,35s tego fragmentu
scenariusza przeznaczyć na realną decyzję/jej historię i pokazać pochodzenie artefaktu.
Nazwać synchronizację brakującą; nie twierdzić, że to zamyka pełny plan.

## Jak odpowiedzieć „dlaczego OM?”

„Potrzebowaliśmy wspólnego miejsca dla pracy ludzi i automatów: uprawnień,
interfejsu operacyjnego, komend i procesów asynchronicznych. Użyliśmy tych elementów
platformy, a własny kod skupiliśmy na kontrakcie zlecenia, kontroli wersji i dowodach
wyniku. To pozwala rozbudowywać firmę o kolejnych wykonawców w tym samym środowisku.”

Przygotować techniczną zakładkę z callsites na pytania jury; nie przeglądać repo przez
minutę w głównej prezentacji. Nie podawać niezmierzonej liczby zaoszczędzonych godzin.
