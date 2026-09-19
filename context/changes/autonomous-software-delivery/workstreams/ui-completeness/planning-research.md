# Uzupełnienie researchu do planu domknięcia

## Aktualizacja przy implementacji — 2026-09-19

Pierwszy inwentarz implementacji na `4a88394432` znalazł dostawy poza checkoutem:
F1 HTTP/gate na `origin/main` (`ee369f72da`), F2 na `origin/dev-mateusz`
(`f8eb5651d8`) oraz F3/F4 na `origin/dev-mateusz-flow-b` (`749b93fa2d`).
`origin/main` zawiera także nowe narzędzia WP (`83a2d8c2d9`). Poniższe historyczne
określenia „brak” dotyczą wyłącznie bazy planowania, nie wszystkich branchy.
Nie wykonano fetch; aktualność serwera pozostaje niepotwierdzona.

Dokładna delta, konflikty D1–D3/F4, decyzja o dostosowaniu recovery Staff do planu,
ledger kontraktów i aktualny probe środowiska: [handoff.md](handoff.md).
Testy dostawców nie stanowią PASS po integracji. Manualny odbiór pozostaje pending.

Data: 2026-09-19. Odczyty checkoutu, bez testów, migracji, uruchomienia aplikacji,
usług zewnętrznych i porównywania branchy. Trzy równoległe analizy uzupełniały
konkretne luki planowania; nie zastępują [audytu](research.md).

## Kontrakty i kolejność integracji

Spec OSS `.ai/specs/2026-09-18-delivery-os-hackathon.md:490` definiuje F1–F15:
nie tworzyć konkurencyjnych payloadów w UI.

| Operacje | Stan / praca pozostała |
|---|---|
| F1/F2 GET/PUT `projects/:id/intake` | Komenda zapisu istnieje; dostarczyć HTTP i odczyt. Intake ma własny token wersji. |
| F3 POST `projects/:id/intake/proposals` | Istnieje import komendą; dostarczyć HTTP, zachować replay przed lock. |
| F4 POST `projects/:id/flow/pin` | Istniejąca komenda zapisuje immutable snapshot/hash; brakuje HTTP. |
| F5 `delivery_os.flow.link_instance` | Istniejąca wewnętrzna komenda z trusted token; nie wystawiać HTTP. |
| F6 GET `projects/:id/flow` | Istnieje pure projection; brak query i HTTP. |
| F7/F8/F9 `projects/:id/stages/:stageId/artifacts` i `decisions` | Komendy zapisu istnieją; brak HTTP oraz query historii. |
| F10–F13 staff-link, comment-imports, comment-threads, triage | Kontrakty opublikowane; domknąć storage, publiczne integracje i HTTP. |
| F14 `projects/:id/publications` | Komenda `publications.record` i HTTP GET/POST nie istnieją. Dostarczyć je, wykorzystując istniejący publicationGate i deployment evidence. |
| F15 report + flow | D1–D3 dostarczone; wykorzystać, nie odtwarzać. |

Wspólne wzorce tras: `packages/core/src/modules/delivery_os/api/routeSupport.ts`
oraz `api/tasks/[id]/attempts/route.ts:47`. Wymagane OpenAPI, context scope,
command bus i registry mutation guards. StageId sprawdzać wobec przypiętego
template. F7 ma ACL zależne od source; HTTP nie otrzymuje trustedExecution.

## Load-bearing ustalenia

- `delivery_os/commands/intake.ts:182,244`: update/import_proposal już istnieją.
  Pierwszy token intake pochodzi z project.createdAt; kolejne z intake.updatedAt.
- `commands/flow.ts:123,199`: pin i wewnętrzne link_instance już istnieją.
- `commands/stages.ts:316,503`: tworzenie artefaktu i decyzje już istnieją;
  aktywna lub nierozstrzygnięta próba blokuje nowy artefakt przed lock check.
- `commands/stages.ts:158,168`: loader threads zwraca `[]`, zapis odroczeń jest
  no-op. Obie implementacje muszą powstać przed odbiorem feedback approval gate.
  `collectArtifactAcReferences` w linii 177 także jest pusty; obecny kontrakt
  artefaktów nie cytuje AC w design screens, więc nie rozszerzać v1 przypadkiem.
- `lib/flowStatus.ts:158` już wyprowadza etap, nextAction, pending approvals i
  blockers. To źródło przeglądu projektu, nie osobny frontendowy state machine.
- `lib/flowRules.ts:97,169`: currency i checkFlowGate istnieją. Open comments
  blokują F8 approval, nie dispatch/publication (spec OSS:545–551 i flowStatus:134).
  Późny reply wraca do triage; sam nie cofa zgody. Zachować ten kontrakt.
- `commands/tasks.ts:350,488`, `commands/attempts.ts:137,193`: podłączyć wspólny
  gate do ready i reserve pod blokadą projektu; legacy korzysta ze starego kodu
  baseline_not_approved z etapowymi details. Zachować replay istniejącej próby.
- Enterprise `delivery_agents/lib/executionBridge.ts:149` już deleguje reserve
  do OSS. `workers/execute-task.ts:67,75,86` claimuje, buduje package i uruchamia
  efekt zewnętrzny: sprawdzić aktualność również przed efektem/retry/resume.
- F7/stage mutation używa wersji projektu; intake i triage własnej wersji.
  Nie przekazywać nagłówka wersji rodzica dla innego edytowanego agregatu.
- Project workflow i attempt workflow są odrębne; obecny
  `delivery_agents/lib/attemptWorkflow.ts:7` dostarcza wyłącznie drugi.

## Providerzy i reuse

- Adam: dedykowany pakiet integracji Figma. Transport pobiera i normalizuje
  `commentImportBatchV1Schema` (`delivery_os/lib/contracts.ts:1633`), a domenę
  zapisują publiczne komendy. Nazwę pakietu i seam utrwalić przed implementacją.
- Mateusz: scoped thread/comment/cursor, link do staff i trwała idempotencja.
  Staff ma `/api/staff/timesheets/tasks` i `tasks/:id/comments`, publiczne komendy
  w `staff/commands/timesheets-tasks.ts` i `timesheets-task-comments.ts`.
  Recovery po efekcie staff musi odtworzyć mapowanie bez drugiego zadania.
- Adam: publiczne spoty staff `staff.time_task.board:card-badges`, `card-footer`
  oraz `detail:staff:staff_time_task:header` (staff AGENTS:388). Kanban pozostaje
  w swojej route boundary; Done nie aprobuje designu ani wyniku DeliveryTask.
- Marcin: `DeliveryFlowTemplateProvider.getTemplate(id, version)` z
  `delivery_os/commands/flowTemplateProvider.ts:15` nie przyjmuje scope jako
  argumentu. Scoped DI/provider nie może przechowywać mutable tenant globalnie.
  Zachować built-in fallback OSS i immutable snapshot projektu.
- Workflows ma `api/definitions/[id]/publish/route.ts:46,115,188` oraz publiczny
  DI workflowExecutor. Reuse Studio/publish, walidując wszystkie semantyczne
  zmiany template: graf, conditions, tools i approval policies.
- Michał/Marcin: `delivery-wordpress/src/tools.ts:188` udostępnia tylko
  create/status/start/stop/captureSnapshot; realny host implementacji/kontroli
  oraz adapter publikacji wymagają domknięcia. ToolCheck nie jest ResultCheck.
- WordPress musi otrzymać zatwierdzone tokeny, mapę edycji, theme.json/Tailwind,
  Yoast/ACF Pro/Polylang, dwa języki i ochronę treści po redeploy. Lokalny snapshot
  nie zastępuje publikacji ani verify docelowego URL.

## Odtwarzalna walidacja

Polecenia istnieją w konfiguracji repo; nie były uruchamiane podczas planowania:

```bash
yarn jest --config packages/core/jest.config.cjs --runInBand --testPathPatterns=delivery_os
yarn jest --config packages/enterprise/jest.config.cjs --runInBand --testPathPatterns=delivery_agents
yarn workspace @open-mercato/delivery-wordpress test
yarn workspace @open-mercato/core typecheck
yarn workspace @open-mercato/enterprise typecheck
yarn workspace @open-mercato/delivery-wordpress typecheck
yarn check:client-boundaries:fail
yarn test:integration TC-DELIVERY --list
yarn test:integration TC-DELIVERY
```

Wąskie iteracje Jest: `--runTestsByPath` i konkretne pliki. WP używa node:test
i Node 24, nie Jest. Playwright czyta `BASE_URL`, nie PLAYWRIGHT_BASE_URL;
preferować repo-native `yarn test:integration` (ustawia wymagany cache mode).
Historyczny `/tmp/ui06-tsconfig.json` nie jest commitowany ani odtwarzalny;
stosować istniejące package-scoped typechecks.

Końcowy gate z `.ai/agentic.config.json`: build:packages → generate →
build:packages → i18n:check-sync → i18n:check-usage → typecheck → test → build:app.
Integracje i client-boundaries są dodatkowymi kryteriami planu. Runner wybierać
raz na sekwencję wg `.ai/docs/agent-instructions.md`: DOCKER_COMPOSE_FILE lub
pierwszy działający app w zdefiniowanej kolejności; w Docker `node
scripts/docker-exec.mjs X` zastępuje `yarn X`, inaczej runner local.

## Macierz testów do dostarczenia wraz z funkcjami

W checkoutcie nie ma jeszcze TC-DELIVERY-FLOW-*; nazwy 01–04/08/09 są już
ustalone w spec OSS:576. Pozostałe poniżej są propozycją lokalizacji.

| Test | Główna asercja |
|---|---|
| TC-DELIVERY-FLOW-01-intake.spec.ts | Save/resume, proposal replay, frozen platform, lock, browser wizard/Scope |
| TC-DELIVERY-FLOW-02-stage-approvals.spec.ts | Osobne zgody, reject, hash/ACL/client proof; stare API nie omija gate |
| TC-DELIVERY-FLOW-03-comment-import.spec.ts | Thread→card, reply→comment, cursor/retry/concurrency bez duplikatów |
| TC-DELIVERY-FLOW-04-kanban-approval.spec.ts | Done≠approval, hash-bound deferral, obce ID i optimistic conflict |
| TC-DELIVERY-FLOW-05-template-versioning.spec.ts | Graf/warunek publish v2, nowy projekt v2, stary v1 także po restarcie |
| TC-DELIVERY-FLOW-06-wordpress-execution.spec.ts | OM→host→kontrolowany runner→wynik/review/poprawka, korelacja |
| TC-DELIVERY-FLOW-07-publication.spec.ts | Pinned flow, browser deploy/release, 422 links, ACL, stale, verify |
| TC-DELIVERY-FLOW-08-v1-regression.spec.ts | Pełna ścieżka legacy, OSS-only, dwa tenant/org, rozdzielone ACL |
| TC-DELIVERY-FLOW-09-upstream-change.spec.ts | Zależne zgody stale, stary wynik≠PASS, próba/reconcile |

WP node:test do rozszerzenia: scaffold oraz tools. Nowe behawioralne testy:
themeBuild.test.ts (WP-01), designTokens.test.ts (WP-02), plugins.test.ts (WP-03),
redeployPreservation.test.ts (WP-05). WP-04/05 wymagają dodatkowo realnej edycji
przez redaktora, dwóch języków i redeploy; browser live w module __integration__
z jawną konfiguracją środowiska lub protokół manualny, nigdy ukryte sekrety CI.

Istniejące UI-003/004 są request-only; UI-008 używa legacy fixture. Zachować je
i dołożyć realne browser interakcje, zamiast twierdzić, że już je pokrywają.
UI-002:110 ma usunięty testid i wymaga asercji bieżącego linku do report.
Osobne regresje: prawdziwy enterprise widget + refresh/Cancel, wynik po reload,
manifest partial→retry→draft review→freeze, metadane evidence, 422 nawigacja,
hydration i klawiatura każdego nowego routa. Fixture zawsze self-contained.

Live Figma/WP ma osobne dowody: SHA platformy, rewizja/hash artefaktu, data,
provenance, operator i decyzje. Fixture/skip/blocked/replay nie oznacza live PASS.

## Końcowe doprecyzowania

- Stage artifacts nie materializują wykonawczego baseline. Dodać deterministyczny
  draft z approved Scope i DS/UI, provenance UX/KV oraz osobny binding baseline
  do czterech artifact refs/template hash. Uzupełnić AC→tests i użyć istniejącego
  freeze oraz jawnych technicznych requirements/design approvals; nie fabrykować
  zgód i nie zmieniać frozen v1. Gate porównuje binding z bieżącymi artefaktami.
- DesignManifest v1 i draft.screens nie opisują oczekiwanych brakujących plików.
  Częściowy import wymaga osobnego scoped DesignImportSession z hash manifestu,
  expected screen keys, wynikami i updatedAt. Klucz nie może opierać się tylko
  na nodeId; uwzględnia fileKey/viewport/version. Nie zmieniać manifestu v1.
- D1 evidence payload jest ograniczoną bezpieczną projekcją, bez pełnych findings
  i usage. Zaplanować additive GET tasks/:id/results?attemptId= z osobnym DTO
  summary; odczyt przez scoped task/register/resultEvidenceId z korelacją.
- Worker gate nie może blokować własnej poprawnie claimed próby. Ocenia tylko
  konflikty z innymi próbami, aktualność bindingu i zgód przed efektem.
- workflowExecutor potrafi start(version), nie czytać/publikować definitions.
  workflowDefinitionAuthoring.upsertOwnedDefinition zmienia latest i nie jest
  bezpieczną publikacją immutable v2. Potrzebny publiczny exact-version/publish
  seam wyodrębniony z obecnej ścieżki workflows, z zachowaniem jej zabezpieczeń.
- Opcjonalny OSS pakiet delivery-workflows może posiadać provider/settings
  i project workflow; core nie zależy od konsumenta ani od enterprise.
- Scoping agent nie istnieje; dodać typowanego propose-only agenta w enterprise
  na istniejącym runtime AI i imporcie intake.import_proposal.
