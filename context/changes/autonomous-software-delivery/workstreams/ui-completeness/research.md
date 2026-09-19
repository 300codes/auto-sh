---
date: 2026-09-19T18:11:29+02:00
researcher: Codex
git_commit: 0b1cce2847d73ac8280a1c1de25c06ebe0c3af62
branch: feature/design-ui
repository: 300codes/auto-sh
topic: "Kompletność wdrożenia 03-design-ui.md i podplanów UI-01–06"
tags: [research, codebase, delivery_os, delivery_agents, design-ui, figma]
status: complete
last_updated: 2026-09-19
last_updated_by: Codex
---

# Research: kompletność wdrożenia strumienia UI

**Data:** 2026-09-19T18:11:29+02:00 · **Autor:** Codex  
**Commit:** `0b1cce2847d73ac8280a1c1de25c06ebe0c3af62` · **Branch:** `feature/design-ui` · **Repo:** `300codes/auto-sh`

## Research Question

Czy `context/changes/autonomous-software-delivery/workstreams/03-design-ui.md`
wraz z podspecyfikacjami jest wdrożony w komplecie?

## Summary

**Nie.** Istnieje znaczna część kodu UI-01–05 oraz integracja D1–D3, ale znaleziono
konkretne niewdrożone wymagania i usterki integracji. UI-06 ma dokumentację przygotowania
i dostarczony kod raportu; pełna próba i demonstracja nie zostały wykonane.
Nowszy, nadrzędny zakres procesu (wizard, Scope, UX/KV/DS/UI, Figma → staff Kanban,
ustawienia Workflows Studio) pozostaje częściowo domeną/kontraktami, bez kompletnego UI.

Nie utożsamiamy braku odbioru z brakiem kodu. Oddzielamy: **implementację**, **pokrycie
testami**, **wykonaną weryfikację** i **odbiór człowieka/live**. Sam istniejacy plik testu
ani odznaczony checkbox nie rozstrzygają o działaniu produktu.

Audyt obejmował świeże odczyty kodu, call sites, podplanów, handoffów i artefaktów,
z trzema równoległymi analizami UI-01/02, UI-03/04 i UI-05/06. Nie uruchamiano testów,
builda, migracji, aplikacji ani Figmy/WP; poniższe usterki są ustaleniami analizy statycznej.

## Detailed Findings

### Macierz UI-01–06

| Zadanie | Co rzeczywiście dostarczono | Co uniemożliwia uznanie kompletności |
|---|---|---|
| UI-01 | Skrypty capture/verify, prompty i historyczne manifesty oraz PNG z create/update tego samego frame | Odbiór zespołu pozostaje `pending`; nie powtórzono aktualnego probe sesji/seat/editability |
| UI-02 | Lista, create/detail/archive, sekcje, rzeczywiste API, typowany InjectionSpot i ACL | Uszkodzony widget enterprise; utrata jego stanu po refresh; nieaktualna asercja E2E; brak odbioru manualnego |
| UI-03 | Import requirements/plan, ręczne AC, upload bytes/hash, wersje baseline i decyzje hash/version | Import wieloekranowego DesignManifest niepodłączony; draft ekranu nie ma review przed freeze; pełny przebieg Figmy/obu wejść nieodebrany |
| UI-04 | Task route, register prób, rezerwacja, export package, import, cancel/reconcile, honest status/usage components | Zaimportowany wynik znika po refresh rodzica; brak browser coverage tych interakcji; niepotwierdzone dwa rzeczywiste runy/review/poprawka |
| UI-05 | Raport, traceability, history, polling, D1 reads/files, D2 gates, D3 candidate, guarded deploy/release | Szczegóły dowodu pomijają wymagane metadane; 422 bez wymaganych linków; brak pełnej browser/flow/ACL/scope integracji |
| UI-06 | Scenariusz, readiness, protokół, handoff oraz domknięcie backendu i klienta D1–D3 | Próba FROM_BRIEF/FROM_DESIGN, pełny design live, WP publish/verify i verdict `not_run`; brak kanonicznego indeksu odbioru |

UI-01 ma rzeczywiste zapisane artefakty: [hackathon/delivery-demo/evidence/figma/manifest.json:5](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/hackathon/delivery-demo/evidence/figma/manifest.json#L5).
Stan odbioru jest jawny: [hackathon/delivery-demo/figma-readiness.md:133](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/hackathon/delivery-demo/figma-readiness.md#L133).
Macierz opisuje aktualny kod, a nie tylko historyczne statusy handoffów.

### 1. UI-02: rozszerzenie enterprise nie spełnia działającego happy path

**Wysoki priorytet — błąd renderowania.** Widget używa `const { t } = useT('delivery_agents')`,
podczas gdy rzeczywisty `useT()` zwraca funkcję tłumaczącą bezpośrednio. Po wybraniu taska
render wykonuje `t(...)`, lecz `t` jest undefined. Źródła:
[packages/enterprise/src/modules/delivery_agents/widgets/injection/project-execution-action/widget.client.tsx:24](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/enterprise/src/modules/delivery_agents/widgets/injection/project-execution-action/widget.client.tsx#L24)
i [packages/shared/src/lib/i18n/context.tsx:90](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/shared/src/lib/i18n/context.tsx#L90); użycie przy renderze w widget line 96.
Host istnieje i montuje prawdziwy InjectionSpot:
[packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx:203](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx#L203).
To problem integracji z właścicielem EXEC, nie brak samego hosta OSS.

**Wysoki priorytet — utrata stanu wykonania.** Widget zapisuje `attemptId` wyłącznie
w local state i natychmiast wywołuje `context.refresh()` (widget lines 49–51).
Host ustawia loading i usuwa z drzewa InjectionSpot
([packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx:86](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx#L86)
i line 178). Po remount stan jest pusty; brak odczytu aktualnej próby przywracającego Cancel.
Problem pozostaje także po poprawieniu tłumaczeń.

POST execute/cancel w widget lines 40/61 omija `useGuardedMutation`, mimo wymaganego
kontraktu i dostępnego kontekstu retry. Test hosta korzysta z atrapy widgetu:
[packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/__tests__/executionHost.test.tsx:10](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/__tests__/executionHost.test.tsx#L10).
Nie dowodzi zatem poprawności powyższej integracji.

### 2. UI-03: niepodłączony import DesignManifest i brak review draftu

Podplan wymaga wklejenia DesignManifest oraz powiązania plików wszystkich ekranów:
[context/changes/autonomous-software-delivery/workstreams/ui-03/plan.md:183](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/context/changes/autonomous-software-delivery/workstreams/ui-03/plan.md#L183).
Helper `mapManifestScreens` istnieje w
[packages/core/src/modules/delivery_os/components/detail/screenUpload.ts:149](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/components/detail/screenUpload.ts#L149),
ale jedyne wywołania są w testach. `ScreenImportDialog` przechowuje pojedynczy plik
oraz ręcznie wpisane metadata i zapisuje jeden screen:
[packages/core/src/modules/delivery_os/components/detail/ScreenImportDialog.tsx:53](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/components/detail/ScreenImportDialog.tsx#L53)
i line 98. Istnienie przetestowanego helpera nie oznacza dostępnej funkcji UI.

Upload dopisuje ekran do draftu (dialog line 99), natomiast design i komentarze
iterują wyłącznie `active.content.screens` zamrożonego baseline:
[packages/core/src/modules/delivery_os/components/detail/DesignSection.tsx:61](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/components/detail/DesignSection.tsx#L61), line 70 i 101.
Nowego draft screen nie można obejrzeć/skomentować w tej sekcji przed pierwszym freeze.
To luka w zaplanowanej sekwencji upload → review/comment → freeze.

### 3. UI-04: wynik importu znika po udanym zapisie

[packages/core/src/modules/delivery_os/components/task/TaskExecutionPanel.tsx:51](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/components/task/TaskExecutionPanel.tsx#L51)
przechowuje zaakceptowany manifest w local state. `onImported` ustawia go i wywołuje
`onMutated` (lines 59–61). Rodzic odświeża task, przechodzi w loading i unmountuje panel:
[packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/tasks/[taskId]/DeliveryTaskDetailClient.tsx:42](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/tasks/[taskId]/DeliveryTaskDetailClient.tsx#L42),
line 71 i 83. Remount przywraca `accepted = null`.

Komponenty findings/checks/usage istnieją, ale ich integracja nie utrzymuje wyniku
nawet w bieżącej sesji po udanym imporcie. D1 GET już istnieje, lecz task screen nie
odczytuje przez niego historycznego wyniku. Dane nie są usuwane z backendu; znika ich prezentacja.

### 4. UI-05: D1–D3 dostarczone, pozostały konkretne braki prezentacji

Obecny kod faktycznie ma list/detail/bytes evidence, scoped attachment service,
flow projection i server gates oraz jawnego kandydata stosowanego przy decyzjach:

- [packages/core/src/modules/delivery_os/commands/evidenceQueries.ts:39](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/commands/evidenceQueries.ts#L39);
- [packages/core/src/modules/delivery_os/commands/reportContext.ts:15](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/commands/reportContext.ts#L15);
- [packages/core/src/modules/delivery_os/commands/publicationGate.ts:15](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/commands/publicationGate.ts#L15);
- [packages/core/src/modules/delivery_os/commands/candidates.ts:22](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/commands/candidates.ts#L22);
- [packages/core/src/modules/delivery_os/commands/reportQueries.ts:85](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/commands/reportQueries.ts#L85);
- [packages/core/src/modules/delivery_os/components/report/decisionInput.ts:15](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/components/report/decisionInput.ts#L15).

**Nie raportujemy D1–D3 jako nadal brakujących.** Brak dowolnego selektora rewizji /
formularza nominacji nie jest luką wobec uzgodnionego UI-06 — nominacja ma kontrakt API.

Pozostałe braki:

1. UI-05 wymaga provenance manual/adapter, czasu i korelacji źródła
   ([context/changes/autonomous-software-delivery/workstreams/ui-05/plan.md:161](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/context/changes/autonomous-software-delivery/workstreams/ui-05/plan.md#L161)).
   DTO dostarcza source/createdAt/baselineId/taskId/attemptId
   ([packages/core/src/modules/delivery_os/lib/evidenceReadContracts.ts:14](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/lib/evidenceReadContracts.ts#L14)),
   lecz dialog pokazuje tylko kind/revision/hash/payload/files:
   [packages/core/src/modules/delivery_os/components/report/EvidenceDetailDialog.tsx:28](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/components/report/EvidenceDetailDialog.tsx#L28).
2. Plan wymaga nazwanych blockerów 422 i linków do AC/skanów/deploymentu (plan line 193).
   Hook redukuje je do surowego `path: code`, a dialog renderuje zwykłe list items:
   [packages/core/src/modules/delivery_os/components/report/useReleaseDecision.ts:76](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/components/report/useReleaseDecision.ts#L76)
   i [packages/core/src/modules/delivery_os/components/report/ReleaseDecisionDialog.tsx:48](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/components/report/ReleaseDecisionDialog.tsx#L48).

### 5. Pokrycie testami nie odpowiada całemu zakresowi podplanów

To osobna kwestia od tego, że testy nie zostały uruchomione:

- UI-002 nadal oczekuje usuniętego `delivery-evidence-list-unavailable`:
  [packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-UI-002.spec.ts:110](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-UI-002.spec.ts#L110).
  Aktualny [packages/core/src/modules/delivery_os/components/detail/EvidenceSection.tsx:116](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/components/detail/EvidenceSection.tsx#L116)
  renderuje link do raportu. Ta asercja nie może przejść dla obecnego UI.
- UI-003 i UI-004 są request-only. Nie sprawdzają hydration, klawiatury ani realnych
  interakcji task route, których brak ujawniają powyższe problemy lifecycle:
  [packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-UI-004.spec.ts:293](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-UI-004.spec.ts#L293).
- UI-007 sprawdza screenshot/detail UI. UI-008 dobrze pokrywa API Git/snapshot,
  candidate A/B/C, context conflict i consent/verification/release, ale używa tylko
  `{ request }`: [packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-UI-008.spec.ts:11](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-UI-008.spec.ts#L11).
  Fixture jest legacy FROM_DESIGN z requirements/design approvals, a nie flow stages:
  [packages/core/src/modules/delivery_os/__integration__/helpers/reportReadiness.ts:22](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/__integration__/helpers/reportReadiness.ts#L22).
- Nadal brak pełnego testu przeglądarkowego formularzy deploy/release oraz integracji
  nowego flow ze stale stage, próbą obejścia przez legacy API, rozdzielonymi ACL i dwoma scope.
  Mockowane testy hooków/guardów dostarczają wartościowe, lecz inne pokrycie.

Handoff D1–D3 odnotowuje 73 zaliczone nowe testy, scoped TS oraz generator z fallback
OpenAPI. To wynik wcześniejszej implementacji; nie był powtarzany dla aktualnego merge HEAD:
[context/changes/autonomous-software-delivery/workstreams/ui-06/handoff.md:38](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/context/changes/autonomous-software-delivery/workstreams/ui-06/handoff.md#L38).

### 6. Nadrzędny dodatek procesu nie jest kompletnie wdrożony

Pierwszeństwo dodatku jest zapisane w
[context/changes/autonomous-software-delivery/workstreams/README.md:3](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/context/changes/autonomous-software-delivery/workstreams/README.md#L3).
Pakiet UI wymaga wizard/scoping, osobnych UX/KV/DS/UI, FigmaSync/staff Kanban i FlowSettings:
[context/changes/autonomous-software-delivery/flow-handoff/03-adam-ui-figma.md:13](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/context/changes/autonomous-software-delivery/flow-handoff/03-adam-ui-figma.md#L13).

| Wymaganie | Aktualny stan kodu | Luka |
|---|---|---|
| Wizard z zapisem/wznowieniem i rozmowa Scope | Zwykły create form ma `brief` textarea i wybór profilu; istnieją komendy intake | Brak podłączonego wieloetapowego wizard/scoping UI i jego publicznych API |
| Osobne UX/KV/DS/UI i zgody klienta | Są encje, pure rules, komendy stage i projekcja w raporcie | Brak ekranów tworzenia/review tych etapów oraz HTTP routes stage/intake/flow |
| Realne komentarze Figma → staff Kanban | Reguły/kontrakty komentarzy, ręczne komentarze snapshotów | Brak delivery providera pobrania, sync UI/cursor/retry i podłączonego importu; loader threads zwraca `[]`, deferrals no-op |
| Ustawienia procesu → Workflows Studio, publikacja v2 | Built-in template provider i komenda pin/link instance | Brak delivery settings/publish UI/API i workflows-backed provider |
| Backend gate przed wykonaniem | Nowe gates działają przy deploy/release/publication record | `attempts.reserve` nadal sprawdza task/dependencies/active v1 baseline, bez stage currency; nowy flow nie jest chroniony end-to-end |
| Handoff tokenów do WP, edytowalność i pełne demo | Opis scenariusza i wymaganych mapowań | Brak dowodu wykonania aktualnego projektu, mapy tokenów/sekcji i live odbioru |

Konkretne punkty odniesienia:
[packages/core/src/modules/delivery_os/backend/delivery/projects/create/page.tsx:68](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/backend/delivery/projects/create/page.tsx#L68),
[packages/core/src/modules/delivery_os/commands/flow.ts:123](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/commands/flow.ts#L123),
[packages/core/src/modules/delivery_os/commands/stages.ts:153](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/commands/stages.ts#L153),
[packages/core/src/modules/delivery_os/commands/flowTemplateProvider.ts:10](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/commands/flowTemplateProvider.ts#L10),
[packages/core/src/modules/delivery_os/commands/attempts.ts:193](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/packages/core/src/modules/delivery_os/commands/attempts.ts#L193) i line 216.

Sprawdzono inwentarz `delivery_os/backend`, `components`, `api`, `commands`, powiązania
w packages/enterprise i aplikacji oraz wyszukiwania providerów i nazw islands.
Sama nieobecność nazwy komponentu nie była podstawą werdyktu: istniejące route/call sites
wykonują starszy flow i nie konsumują nowych komend. Braki zależności OSS/EXEC/providerów
współblokują odbiór UI; nie przypisujemy ich wszystkich jednej osobie.

### 7. UI-06: materiały wszystkich faz nie zastępują wykonanych faz

Scenariusz, readiness, protokół i handoff istnieją. Jednak
[context/changes/autonomous-software-delivery/workstreams/ui-06/rehearsal.md:3](https://github.com/300codes/auto-sh/blob/0b1cce2847d73ac8280a1c1de25c06ebe0c3af62/context/changes/autonomous-software-delivery/workstreams/ui-06/rehearsal.md#L3)
jednoznacznie zapisuje brak przeprowadzonej próby i brak nowego projektu/artefaktu/wdrożenia.
Nie znaleziono kanonicznych `hackathon/delivery-demo/runbook.md`, `acceptance.md`
i `evidence-index.md`; ograniczenie odnotowano też w readiness.

Do wykonania pozostają: FROM_BRIEF i osobny FROM_DESIGN, nowe UX→KV→DS/UI live,
komentarze/poprawki, niezależne zgody, rzeczywista implementacja i publikacja WP,
URL/build verification, pomiary, pełny gate i końcowy verdict. Te punkty wymagają
operacyjnego środowiska i ludzi, nie tylko kolejnego commitu.

## Code References

Odnośniki przy ustaleniach prowadzą do badanego commitu. `origin/feature/design-ui`
zawierał ten HEAD według lokalnych remote-tracking refs. `gh repo view` nie połączył się
z GitHub API; identyfikator repo ustalono z remote `origin`. Nie wykonywano fetch/push.

## Architecture Insights

- Podział OSS/enterprise i InjectionSpot jest wdrożony, ale testy hosta z atrapą nie
  wychwytują błędów rzeczywistego widgetu. Potrzebne jest sprawdzenie całego połączenia.
- Powtarza się problem lokalnego stanu potomka traconego przez loading-only refresh
  rodzica: dotyczy widgetu wykonania i task result summary.
- Pure helper, schema, komenda i fixture są różnymi etapami dostawy. Manifest mapping
  oraz nowy flow pokazują, dlaczego trzeba sprawdzać realne wejście UI/HTTP i call sites.
- Rozszerzenie raportu D1–D3 nie implementuje upstream całego procesu ani operatora
  publikacji WP. Serwerowy gate na końcu procesu nie zastępuje gate przed dispatch.

## Historical Context

- UI-02/04/05 handoffy poprzedzają D1–D3 i częściowo opisują już usunięte blokery
  (brak evidence GET, wyłączone decyzje, pusty widget). Nie są aktualnym inwentarzem kodu.
- Commit `1fd03d0c27` dostarczył D1–D3. Aktualny merge HEAD zawiera tę pracę.
- Wcześniejsze ograniczenie użytkownika pozwalało uruchamiać tylko nowe testy/scoped TS.
  Brak pełnego gate został jawnie udokumentowany; nie jest dowodem nieuczciwego PASS,
  lecz nadal ogranicza możliwość potwierdzenia kompletnego wdrożenia.

## Related Research

- [Badanie pierwotnego planu](../../research.md).
- [Plan strumienia UI](../03-design-ui.md).
- [Aktualny handoff D1–D3](../ui-06/handoff.md).

## Kolejność domknięcia

1. Naprawić integrację widgetu enterprise i utratę wyników po odświeżeniu.
2. Podłączyć DesignManifest i review draftu; domknąć metadane evidence i 422 navigation.
3. Dostarczyć brakujący wizard/stages/FigmaSync/FlowSettings oraz backend dispatch gate.
4. Uzupełnić i poprawić realne browser/flow/ACL/scope integracje, następnie wykonać je
   na finalnym SHA wraz z uzgodnionym gate.
5. Wykonać próbę obu wejść i nowe demo WP/Figma, zapisać dowody i verdict człowieka.

## Open Questions

- Czy brakujące F1–F3/provider istnieją na innych branchach? Nie ma ich w badanym checkoutcie.
- Jaki aktualny runtime ma już zastosowane migracje i gotowe dostępy Figma/WP?
- Kto i kiedy wykona potwierdzony odbiór UI-01 oraz pełną próbę UI-06?

Powyższe niewiadome nie zmieniają odpowiedzi dla badanego kodu: **zakres nie jest kompletny**.
