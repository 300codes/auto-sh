# Autonomous Software Delivery OS

> **Korekta kierunku — 2026-09-19:** [dodatek produktowy](../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) ma pierwszeństwo w zakresie domyślnego flow, osobnych akceptacji UX/KV/DS/UI, komentarzy Figma → Kanban, ustawień procesu i WordPress E2E jako głównego demo. [Nowe pakiety dla zespołu](../context/changes/autonomous-software-delivery/flow-handoff/README.md). Poniższy dokument zachowuje wcześniejsze ustalenia techniczne; dawne React-first/WP-PoC i estymaty nie stanowią odbioru ani wyceny rozszerzonego zakresu. To zmiana wymagań, nie potwierdzenie implementacji.
## Specyfikacja wdrożeniowa — Open Mercato + OM Orchestrator + Cezar + Figma

**Status:** pełny scope koncepcyjny\
**Cel:** opis kompletnego rozwiązania przed podziałem implementacji na zespoły i zadania\
**Robocza nazwa:** Autonomous Software House / Software Delivery OS

## 1. Wizja

Celem projektu jest stworzenie systemu pozwalającego przeprowadzić projekt software'owy end-to-end przy użyciu agentów AI, z kontrolą człowieka w kluczowych punktach.

System obsługuje dwa wejścia:

1. **Start from Brief** — od briefu przez discovery, wymagania, UX, Design System, makiety, review, architekturę i implementację.
2. **Start from Design** — od istniejącego projektu Figma przez analizę designu, rekonstrukcję Design Systemu, reverse specification i dalej do implementacji.

Po osiągnięciu gotowości do implementacji obie ścieżki korzystają z jednego wspólnego pipeline'u delivery.

### Podział odpowiedzialności

- **Open Mercato (OM)** — control plane i system zarządzania całym projektem.
- **OM Orchestrator** — workflow, stany, zależności, human gates i dispatch pracy.
- **Cezar** — execution engine / workforce uruchamiający agentów.
- **Figma** — source of truth dla designu.
- **Git/repository** — source of truth dla implementacji.
- **CI/CD** — build, test i deployment.

> Give us an idea or give us a design. We manage the software delivery process from specification to deployed application.

## 2. Założenia

System nie jest generatorem pojedynczej aplikacji i nie jest związany z jednym CMS-em czy frameworkiem. Różne platformy docelowe są obsługiwane przez adaptery, np. WordPress, Strapi, Open Mercato, headless CMS, CRM/ERP, Astro, React, Vue, Next, Nuxt i rozwiązania custom.

Zasady:

- implementacja nie rusza bez wystarczającej specyfikacji;
- projekt z UI nie rusza bez zatwierdzonego design baseline;
- Figma pozostaje edytorem i source of truth dla designu;
- OM zarządza procesem, komentarzami, akceptacjami i traceability;
- każdy agent otrzymuje kontrolowany kontekst;
- agenci mogą pracować równolegle;
- feedback wraca do właściwego agenta;
- autonomiczne pętle mają limity i eskalację;
- wszystkie ważne działania są audytowalne;
- requirements, design, tasks, code, tests i deployment są ze sobą powiązane.

## 3. Architektura wysokiego poziomu

```text
                         OPEN MERCATO
              ┌───────────────────────────────┐
              │ Projects / Requirements       │
              │ UX / Design / Reviews         │
              │ Tasks / Agents / Tests        │
              │ Deployments / Costs / Audit   │
              └───────────────┬───────────────┘
                              ▼
                     OM ORCHESTRATOR
                    workflow / events / state
                              │
                              ▼
                           CEZAR
                    Agent Execution Engine
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
        Figma                Git               CI/CD
                                                  │
                                                  ▼
                                          Target Platform
```

## 4. Entry points

### 4.1 Start from Brief

```text
Brief → Discovery → Requirements → Human Review
→ UX / IA / User Flows → Wireframes → Design System
→ UI Design in Figma → Visual Review in OM
→ Human Design Approval → READY_FOR_IMPLEMENTATION
```

### 4.2 Start from Design

```text
Existing Figma → Design Import & Analysis
→ Screens / Components / Tokens / Assets / User Flows
→ Design System Extraction → Reverse Specification
→ Missing States / Requirements Detection → Human Review
→ Design Baseline Approval → READY_FOR_IMPLEMENTATION
```

### 4.3 Kontrakt READY_FOR_IMPLEMENTATION

Projekt musi posiadać Requirements, Acceptance Criteria, Target Platform, zatwierdzone Screens i Design System dla projektu UI, wymagane Assets, rozwiązane lub zaakceptowane blocking issues oraz zatwierdzony design baseline.

## 5. Lifecycle

`DRAFT → DISCOVERY → REQUIREMENTS_REVIEW → UX_DESIGN → UI_DESIGN → DESIGN_REVIEW → READY_FOR_IMPLEMENTATION → ARCHITECTURE → PLANNING → IMPLEMENTATION → CODE_REVIEW → QA → SECURITY_REVIEW → STAGING → FINAL_ACCEPTANCE → READY_FOR_RELEASE → RELEASED`

Dodatkowe stany: `BLOCKED`, `CANCELLED`.

## 6. Project Intake

Projekt przechowuje: name, description, mode (`FROM_BRIEF | FROM_DESIGN`), brief, attachments, Figma reference, repository, target platform, preferred stack, constraints, NFR, environments, Definition of Done, AI budget/cost limit i autonomous iteration limits.

Funkcje: tworzenie projektu, wybór wejścia, podłączenie repo/Figmy, wybór adaptera, start/pause/resume workflow i podgląd stanu.

## 7. Discovery

**Discovery Agent** analizuje brief, domenę, użytkowników, role i procesy. Wykrywa braki, sprzeczności, assumptions i ryzyka.

Output: Discovery Report, Questions, Assumptions, Risks, Proposed Scope.

Braki: `BLOCKING | IMPORTANT | OPTIONAL`. Blocking issue zatrzymuje workflow.

## 8. Requirements & Specification

**Business Analyst Agent** tworzy `Epic → Feature → User Story → Acceptance Criteria`.

Requirement posiada ID, tytuł, opis, source, status, priority, assumptions, AC, dependencies oraz linki do screens, tasks i tests.

### Human Gate: Requirements Approval

Akcje: `Approve | Request Changes | Comment | Accept Assumption`. Akceptacja tworzy baseline specyfikacji.

## 9. UX Module

**UX Designer Agent** tworzy Information Architecture, User Journeys, User Flows, Screen Inventory, Navigation Model, Wireframes i wymagane stany ekranów: default, loading, empty, error, validation, success i responsive/mobile.

Każdy Screen jest powiązany z Requirements.

## 10. Design System

Dla `FROM_BRIEF` Design System Agent tworzy system od podstaw. Dla `FROM_DESIGN` Design System Extraction Agent rekonstruuje go z Figmy.

Foundations: colors, typography, spacing, grid, breakpoints, radius, shadows, icons, motion.

Components: buttons, inputs, selects, forms, cards, tables, navigation, modals, alerts, tabs, pagination i komponenty domenowe.

Komponent posiada variants, sizes, states, responsive behaviour, accessibility requirements, Figma reference i opcjonalny implementation reference.

Agent wykrywa niespójności, lokalne style, brakujące tokeny i states.

## 11. Integracja Figma

> **Figma owns design. Open Mercato owns the process. Cezar owns execution.**

OM nie zastępuje edytora Figma.

W `FROM_BRIEF` system wykorzystuje Figmę do Design Systemu, wireframes i finalnych screens. W `FROM_DESIGN` analizuje istniejącą Figmę, tworzy Screen Inventory, rekonstruuje Design System, tworzy Reverse Specification i wykrywa braki.

Mapowanie: `OM Screen ↔ Figma File ↔ Figma Node ↔ Approved Design Baseline`.

## 12. Design Versioning & Approval

Implementacja odnosi się do zatwierdzonego baseline'u, nie do aktualnego zmiennego stanu Figmy.

`Approve Design` zapisuje immutable snapshot: render, Figma reference/version, tokens, component refs, timestamp, approver i linked requirements.

Zmiana w Figmie po akceptacji nie zmienia automatycznie scope'u implementacji.

## 13. Visual Feedback w OM

OM posiada ekran review renderu/snapshotu designu z zoomem, wyborem wersji, desktop/mobile, komentarzami punktowymi i obszarowymi, threads, statusami, filtrowaniem i porównaniem wersji.

### VisualComment

```text
id
screen_id
design_version
x / y
optional_region
author
body
status
created_at
resolved_at
linked_change_request
```

Status: `OPEN | IN_PROGRESS | RESOLVED | ACCEPTED | REJECTED`.

`Comment → Design Change → New Design Version → Review → Resolution`.

Designer Agent otrzymuje aktywne uwagi i raportuje wersję, w której zostały rozwiązane.

## 14. Design Change Impact Analysis

Zmiana zatwierdzonego designu uruchamia analizę wpływu na Requirements, Tasks, Components, Implementation i Tests. Człowiek decyduje, czy zmiana wchodzi do aktualnego scope'u.

## 15. Reverse Specification

Kluczowy element `FROM_DESIGN`. Agent analizuje zachowania wynikające z UI bez wymyślania brakujących zachowań.

Przykład:

```text
SCREEN-12 Product Listing

Detected:
- product list
- category filtering
- search
- pagination

Undefined:
- empty results
- API error
- loading state
- mobile filter behaviour
```

Nieokreślone zachowania tworzą Questions / Missing Requirements.

## 16. Solution Architecture

**Architect Agent** tworzy Technical Blueprint: architecture, stack, components/services, integrations, data model, API contracts, authentication/authorization, caching, environments, CI/CD, deployment, observability, security i testing strategy.

Istotne decyzje są zapisywane jako ADR.

## 17. Target Platform Adapter

Adapter oddziela core delivery od technologii. MVP może wspierać np. `wordpress`, `strapi`, `open-mercato`, `generic-node`.

Adapter definiuje capabilities, documentation/context, coding standards, bootstrap, dev/test/build commands, deployment, tools, agent skills i validation rules.

```yaml
platform: wordpress
capabilities:
  - custom-post-types
  - blocks
  - rest-api
commands:
  build: npm run build
  test: npm test
rules:
  php: WordPress Coding Standards
```

## 18. Delivery Planner

Planner otrzymuje requirements, design baseline, architecture i target adapter. Tworzy workstreams, tasks, dependencies, required roles, execution order, parallelizable groups i estimated complexity.

Dependency Graph jest podstawą orkiestracji.

## 19. Agent Team Builder

Zespół jest dynamiczny. Przykład:

```text
Architect
WordPress Developer
Astro Developer
Integration Developer
QA Engineer
Security Engineer
Code Reviewer
```

Builder definiuje role, skills, model, tools, context policy, concurrency i permissions.

## 20. OM Orchestrator

Odpowiada za workflow, events, human gates, dependency management, dispatch do Cezara, retry, feedback loops, iteration limits, escalation, statusy i blokowanie procesu.

Przykładowe eventy:

```text
PROJECT_CREATED
REQUIREMENTS_READY
REQUIREMENTS_APPROVED
DESIGN_READY
DESIGN_COMMENT_ADDED
DESIGN_APPROVED
ARCHITECTURE_READY
PLAN_READY
TASK_READY
AGENT_STARTED
TASK_IMPLEMENTED
REVIEW_FAILED
REVIEW_PASSED
QA_FAILED
QA_PASSED
DEPLOYED
PROJECT_ACCEPTED
```

## 21. Cezar Execution Layer

OM przekazuje Cezarowi task, rolę, context package, repo, workspace, tools, limity i expected output contract.

Cezar odpowiada za izolację i uruchomienie agenta, wykonanie pracy, telemetry, raportowanie i artefakty.

## 22. Context Builder

Agent nie dostaje automatycznie całego projektu.

Backend: Task + Requirements/AC + Architecture + Data Model + API Contract + Relevant Files + Coding Rules.

Frontend: Task + Requirements + Approved Screen + Design System + Component mappings + API Contract + Relevant Files.

QA: Requirements + AC + Implementation + Test Strategy + Approved Design.

Reviewer: Specification + Architecture + Task + Approved Design + Diff.

Celem jest redukcja kosztu, szumu i przypadkowego wpływu nieistotnego kontekstu.

## 23. Agent Workspace

Każdy agent developerski pracuje w izolowanym branch/worktree, np. `agent/TASK-21`.

Cykl: pobierz task/context → implementuj → walidacje → self-review → commit → structured result.

## 24. Self Review

Developer Agent nie oznacza pracy jako zakończonej bez:

`Implementation → Self Review → Tests → Acceptance Criteria Check → READY_FOR_REVIEW`.

## 25. Independent Code Review

Reviewer otrzymuje spec, architecture, task, design baseline i diff. Sprawdza requirements/AC, design, architecture, coding standards, security, maintainability i regresje.

Output: `APPROVED` albo `CHANGES_REQUESTED` z ustrukturyzowanymi findings.

## 26. Autonomous Feedback Loop

`Developer → Reviewer → CHANGES_REQUESTED → Developer → Reviewer → APPROVED`.

Konfigurowalny limit, np. `max_autonomous_iterations = 3`. Po przekroczeniu: `HUMAN_INTERVENTION_REQUIRED`.

## 27. Integration Agent

Scala branche, rozwiązuje bezpieczne konflikty, uruchamia build i integration tests oraz eskaluje konflikty wymagające decyzji.

## 28. QA

QA Agent uruchamia unit, integration, E2E/Playwright, accessibility, performance/Lighthouse i acceptance tests zgodnie z projektem.

Kluczowe mapowanie: `Requirement ↔ Acceptance Criterion ↔ Test ↔ Result`.

## 29. Visual QA

Playwright wykonuje screenshot implementacji. Visual QA porównuje `Approved Figma Baseline ↔ Implemented Screen` i raportuje konkretne różnice: spacing, brakujące elementy, niewłaściwe komponenty, responsive mismatch.

## 30. Security Agent

Zakres: dependencies, secrets, OWASP checks, auth/authz, API exposure, security headers i konfiguracja. Wynik może blokować release zależnie od severity.

## 31. Deployment Agent

Po wymaganych gates:

`Build → Review → QA → Security → Deploy Preview/Staging`.

Deployment zapisuje URL, environment, commit SHA, timestamp i status. Produkcja może wymagać osobnego Human Gate.

## 32. Final Acceptance Agent

Agent porównuje finalny system przede wszystkim z zaakceptowanym briefem/specyfikacją i tworzy Delivery Report:

```text
Requirements: 24
Satisfied: 22
Partial: 2
Missing: 0
Tests: 48/48
Security: PASS
Accessibility: PASS
Deployment: READY
```

Nie podejmuje za człowieka finalnej decyzji release.

## 33. Human Release Gate

OM pokazuje Specification, Preview, Test Report, Security Report, Change Summary, AI Cost i unresolved risks.

Akcje: `Accept | Reject | Request Changes`.

## 34. Project Control Center

Główny ekran OM:

```text
PROJECT: PHARMA PORTAL
Status: IMPLEMENTATION
Progress: 82%

Requirements       31 / 34
Tasks              42 / 48
Acceptance Tests   29 / 31

AGENTS
Architect           DONE
WordPress #1        TASK-43
Frontend            TASK-31
QA                  WAITING
Reviewer            TASK-39

AI COST             $12.84
BLOCKERS             1
STAGING              not deployed
```

Dashboard powinien pokazywać aktualny stan, a nie tylko historyczne metryki.

## 35. Audit Log

Każde istotne zdarzenie trafia do timeline:

```text
18:42 Architecture created
18:44 Planner created 34 tasks
18:45 Cezar started 5 agents
18:51 TASK-14 completed
18:52 Reviewer requested changes
18:54 Developer revision started
18:59 Reviewer approved
19:01 TASK-14 merged
```

## 36. Cost & Token Tracking

Telemetry per `Project → Agent → Task`:

- model;
- tokens;
- czas;
- koszt;
- iterations;
- outcome.

OM pokazuje koszt całego projektu i etapów: Architecture, Design, Development, Review, QA, Security.

## 37. Traceability Graph

Kluczowa właściwość systemu:

```text
Brief
 ↓
REQ-14
 ↓
UX Flow
 ↓
SCREEN-07 / Figma v4
 ↓
TASK-31
 ↓
Commit / PR
 ↓
TEST-22
 ↓
Deployment
```

Kliknięcie dowolnego elementu powinno umożliwić przejście w obie strony po relacjach.

## 38. Human Gates

Minimalny zestaw:

1. **Requirements Approval**
2. **Design Approval**
3. **Release Approval**

Opcjonalnie: Architecture Approval, Change Scope Approval, Production Deployment Approval.

Human Gate jest obiektem workflow i przechowuje decyzję, autora, czas, baseline i komentarz.

## 39. Blockers & Escalation

Blocker może pochodzić od człowieka, agenta, integracji lub testów.

Przykłady:

- niekompletne wymaganie;
- brak dostępu;
- nierozwiązywalny merge conflict;
- przekroczony iteration limit;
- krytyczny security finding;
- przekroczony AI budget;
- niespójny design/spec.

Blocker zatrzymuje wyłącznie zależną część grafu, jeśli pozostałe workstreamy mogą bezpiecznie pracować dalej.

## 40. Permissions & Security

Role przykładowe:

- Project Owner;
- Client Reviewer;
- Product/BA;
- Designer;
- Developer;
- QA;
- Admin;
- Agent/System.

Należy rozdzielić permissions dla: approvals, deployment, repo access, Figma access, secrets, agent execution i budget changes.

Sekrety nie powinny być kopiowane do zwykłego kontekstu agenta.

## 41. Artefakty

System powinien traktować jako artefakty m.in.:

- brief;
- discovery report;
- requirements baseline;
- UX flows;
- design snapshots;
- design tokens;
- architecture;
- ADR;
- delivery plan;
- agent outputs;
- commits/PR;
- test reports;
- visual diffs;
- security reports;
- deployment records;
- final delivery report.

Artefakty powinny być wersjonowane i linkowane do encji domenowych.

## 42. Proponowany model domenowy OM

Główne encje:

```text
Project
ProjectSource
Requirement
AcceptanceCriterion
Question
Assumption
Risk
UXFlow
Screen
DesignVersion
DesignComponent
DesignToken
VisualComment
ChangeRequest
Architecture
ADR
TargetPlatform
TargetAdapter
Workstream
Task
TaskDependency
AgentRole
AgentRun
ContextPackage
Review
ReviewFinding
TestCase
TestRun
VisualTest
SecurityFinding
Deployment
HumanGate
Blocker
Artifact
AuditEvent
CostRecord
```

Najważniejsze relacje powinny umożliwiać Traceability Graph.

## 43. Kontrakty agentów

Każdy typ agenta powinien mieć jawny kontrakt:

```text
role
purpose
input_schema
output_schema
required_context
allowed_tools
permissions
success_conditions
failure_conditions
max_iterations
timeout
cost_limit
```

Agent nie powinien zwracać wyłącznie swobodnego tekstu. Wynik potrzebny do workflow powinien mieć structured output.

## 44. Failure Handling

Rozróżniamy:

- execution failure;
- validation failure;
- business blocker;
- integration failure;
- timeout;
- budget exceeded;
- permission/access failure.

Orchestrator decyduje na podstawie typu: retry, alternate agent/model, rollback, block dependency branch lub human escalation.

## 45. Observability

Dla każdego AgentRun potrzebujemy:

- start/end;
- status;
- task;
- model;
- tools;
- token/cost telemetry;
- result;
- error;
- produced artifacts.

Dla projektu: aktywni agenci, queue, blocked tasks, critical path, koszty, czas i ostatnie zdarzenia.

## 46. End-to-end workflow

```text
START
 │
 ├─ FROM BRIEF ── Discovery → Requirements → UX → Design System → Figma
 │
 └─ FROM DESIGN ─ Figma Analysis → DS Extraction → Reverse Specification
                          │
                          ▼
                  Requirements Review
                          │
                  Design Review in OM
                          │
                   DESIGN APPROVED
                          │
                          ▼
                     Architecture
                          │
                       Planner
                          │
                   Agent Team Builder
                          │
                   OM ORCHESTRATOR
                          │
                        CEZAR
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
          Backend      Frontend    Integrations
             └────────────┼────────────┘
                          ▼
                     Self Review
                          ▼
                     Code Review
                       ↕ changes
                          ▼
                     Integration
                          ▼
                         QA
                          ▼
                      Visual QA
                          ▼
                       Security
                          ▼
                       Staging
                          ▼
                  Final Acceptance
                          ▼
                   HUMAN RELEASE GATE
                          ▼
                       RELEASE
```

## 47. Scope MVP / hackathon vertical slice

Pełna architektura powinna być widoczna w modelu, ale hackathon powinien dostarczyć jeden kompletny vertical slice.

### Must have

1. Project Intake.
2. Dwa entry pointy w UI.
3. Co najmniej częściowo działający `FROM_BRIEF`.
4. Import/odczyt co najmniej jednego flow z Figmy dla `FROM_DESIGN`.
5. Requirements/AC.
6. Design Screen + baseline.
7. Visual comments w OM.
8. Human Design Approval.
9. Architecture/Planning.
10. Tasks + dependency graph.
11. Dispatch z OM do Cezara.
12. Co najmniej 2 równoległe agent runs.
13. Implementacja w repo.
14. Code Review Agent.
15. Jedna działająca correction loop.
16. QA/Playwright.
17. Visual comparison.
18. Preview/Staging deployment.
19. Statusy i audit log w OM.
20. Finalny URL i Delivery Report.

### Wystarczający Target Adapter

Na hackathon wystarczy jeden naprawdę działający adapter oraz drugi minimalny proof-of-concept pokazujący wymienność architektury.

## 48. Idealne demo

1. Użytkownik tworzy projekt.
2. Wybiera `Start from Brief` albo `Start from Design`.
3. OM przygotowuje requirements/design context.
4. Człowiek dodaje uwagę bezpośrednio na makiecie.
5. Design zostaje poprawiony i zatwierdzony.
6. OM tworzy architecture i delivery plan.
7. Cezar uruchamia kilku agentów.
8. Dashboard pokazuje pracę w czasie rzeczywistym.
9. Reviewer odrzuca jedno zadanie.
10. Developer Agent automatycznie poprawia je.
11. QA przechodzi.
12. Visual QA porównuje implementację z zatwierdzoną Figmą.
13. Powstaje deployment.
14. OM pokazuje działający URL, Delivery Report, koszty i traceability.

Demo ma być zrozumiałe bez tłumaczenia wewnętrznej architektury: **brief lub design wchodzi z jednej strony, działający system wychodzi z drugiej, a Open Mercato zarządza całym procesem pomiędzy.**

## 49. Poza MVP, ale przewidziane architektonicznie

- Start from Existing Codebase;
- dwukierunkowe komentarze OM ↔ Figma;
- większa biblioteka Target Adapters;
- automatyczna aktualizacja dokumentacji;
- learning z historycznych projektów;
- estimate vs actual;
- scope creep detection;
- project risk radar;
- reusable organizational knowledge;
- cross-project agent performance analytics;
- automatyczne generowanie maintenance handover;
- production monitoring i self-healing incident workflow.

## 50. Kryterium sukcesu produktu

System osiąga cel, gdy potrafi przyjąć brief lub istniejący design, stworzyć kontrolowany i zatwierdzony kontrakt implementacyjny, zaplanować pracę, zbudować dynamiczny zespół agentów, wykonać zadania przez Cezara, przeprowadzić review/QA/security, wdrożyć rezultat i zachować w Open Mercato pełny, audytowalny łańcuch od wymagania do produkcji.

Najważniejszym produktem nie jest sam wygenerowany kod. Jest nim **kontrolowany, powtarzalny i obserwowalny proces autonomicznego software delivery**.
