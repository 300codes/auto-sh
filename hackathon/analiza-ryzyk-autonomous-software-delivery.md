---
date: 2026-09-18T20:31:42+02:00
researcher: strzesniewski (Claude Opus 5, /10x-research)
git_commit: 83330e271e0da0e0ae8ed4dd4d83369735cc06e6
branch: main
repository: 300codes/auto-sh
topic: "Analiza ryzyk i luk w planie Autonomous Software Delivery OS"
tags: [research, hackathon, agent-orchestrator, cezar, figma, delivery-os, risk-map]
status: complete
last_updated: 2026-09-18
last_updated_by: strzesniewski
---

# Analiza ryzyk i luk — Autonomous Software Delivery OS

**Dokument źródłowy:** [`open-mercato-autonomous-software-delivery-spec.md`](open-mercato-autonomous-software-delivery-spec.md) (750 linii, 50 sekcji)
**Commit:** `83330e271` · **Branch:** `main` · **Repo:** `300codes/auto-sh`
**Założony horyzont:** hackathon + kontynuacja przez kilka tygodni
**Metoda:** przegląd dokumentu + czterowątkowe badanie kodu (orchestrator, warstwa egzekucji, Figma/DS, model domenowy)

---

## Streszczenie

Spec jest dobrze przemyślany na poziomie koncepcyjnym i **trafia w platformę lepiej, niż sam się z tego rozlicza**. Około 70% warstwy governance (§19–26, §35–38, §43) jest już zbudowane i działa w `packages/enterprise/src/modules/agent_orchestrator` — 21 encji, 537 plików, 18 stron cockpitu, ślady OTel, guardrails, bramki ludzkie, telemetria kosztów per run. Dokument tego nie wie i opisuje te rzeczy jako do zbudowania.

Jednocześnie spec zawiera **trzy założenia, które są sprzeczne z tym, co w platformie już zostało rozstrzygnięte**, i to one, a nie objętość pracy, są głównym ryzykiem:

1. **Agenci piszący kod** — orchestrator jest *propose-only z konstrukcji*, egzekwowane w sześciu niezależnych miejscach, w tym fail-closed na poziomie flush ORM. Wygenerowany plik agenta ma `write: deny`, `edit: deny`, `bash: deny`.
2. **Figma jako źródło prawdy** — repo ma zbudowane, udokumentowane i pilnowane w CI tooling w kierunku **odwrotnym** (`code → Figma`).
3. **Graf traceability** — nazwany „kluczową właściwością systemu" (§37) i jednocześnie jedyną rzeczą, dla której platforma **nie ma żadnego prymitywu**, a jej silnik zapytań jest wobec takiego grafu wrogi.

Do tego dochodzi zewnętrzna zależność, której spec nie przeanalizował: **Cezar jest narzędziem local-first, „zero config, no accounts", ze stanem w plikach i bez bazy danych**, mającym własny orkiestrator, własny cockpit i własny format workflow. Spec traktuje go jak serwerowy, wielotenantowy execution engine.

**Wniosek operacyjny:** projekt jest wykonalny w horyzoncie „hackathon + tygodnie", ale tylko po przekrojeniu zakresu opisanym w sekcji 6. Największą dźwignią nie jest przyspieszenie pracy, tylko **jedna decyzja architektoniczna podjęta przed napisaniem pierwszej linii** (jeden moduł zamiast sześciu — patrz R-04/R-05).

---

## 1. Punkt startowy — co naprawdę już istnieje

Rzetelna mapa ryzyk wymaga najpierw uczciwego zinwentaryzowania aktywów. Poniższe jest zweryfikowane w kodzie.

### Gotowe i mocne (do ponownego użycia bez zmian)

| Obszar spec | Co istnieje | Gdzie |
|---|---|---|
| §20 Orchestrator, §38 Human Gates | Silnik DAG: 12 typów kroków, warunki, `PARALLEL_FORK/JOIN`, `USER_TASK`, `WAIT_FOR_SIGNAL`, trwały `PAUSED` w bazie | `packages/core/src/modules/workflows/data/entities.ts:17-30`, `:717-859` |
| §38 bramki + §26 pętla | `AgentProposal` z dyspozycją `pending → auto_approved\|approved\|edited\|rejected`, polityka auto-akceptacji fail-closed (tenant → guardrails → kompletność trace → ryzyko → pewność → margines) | `.../agent_orchestrator/lib/disposition/autoApprovalPolicy.ts:127-157` |
| §22 Context Package | `AgentContextBundle` — `routedSources`, `prunedSources`, budżet tokenów, redakcja, provenance | `.../agent_orchestrator/data/entities.ts:1171` |
| §43 kontrakty agentów | `defineAiAgent` + zod `output.schema` + `OUTCOME.md` (JSON-Schema) + `allowedTools` + `mutationPolicy` + `requiredFeatures` | `packages/ai-assistant/.../lib/ai-agent-definition.ts:309-438` |
| §35 Audit, §45 Observability | `audit_logs` (ActionLog/AccessLog z wzorca komend) + `AgentSpan`/`AgentToolCall` (append-only OTel-GenAI, payloady do S3) | `.../agent_orchestrator/data/entities.ts:254`, `:321` |
| §34 dashboard live | DOM Event Bridge: `clientBroadcast: true` → SSE → `useAppEvent` | `packages/events/AGENTS.md:137-190` |
| §20 długie operacje | Moduł `progress` — `ProgressJob`, `ProgressTopBar` | `packages/core/AGENTS.md:306-318` |
| §41 Artefakty | `AgentRunArtifact` + moduł `attachments` (polimorficzny `entity_id`+`record_id`) + `storage-s3` + route obrazkowy z thumbnailami | `.../attachments/data/entities.ts:58-61` |
| §17 Target Adapter | Wzorzec pakietów-providerów (`gateway-stripe`, `channel-*`, `web-research-*`) — gotowy szablon | `packages/*/` |
| §40 tożsamość agentów | ID-JAG / RFC 7523, `AgentPrincipal`, odwoływalne `AgentDelegationGrant` | `.../api/identity/agent/auth/route.ts:19-36` |
| §36 telemetria kosztów (**tylko warstwa orchestratora**) | `agent_runs.input_tokens/output_tokens/cost_minor/currency/latency_ms/model` + `AgentMetricRollup` — ale patrz R-29 | `.../agent_orchestrator/data/entities.ts:142-258` |
| §31 deployment | Realne CLI `mercato deploy railway` z redakcją argumentów w logach | `packages/cli/src/mercato.ts:1636-1638` |

### Nie istnieje w ogóle

Figma read w kodzie produktu · regresja wizualna / image diff · komentarze kotwiczone jako produkt · encja `Deployment` · encje Requirement/Screen/Project · generyczna tabela krawędzi grafu · warstwa dispatch do zewnętrznego executora · egzekwowanie budżetu kosztowego · drabina autonomii · automatyzacja worktree/branch.

### Pułapka: rzeczy, które wyglądają na gotowe, a nie są

| Pozorne aktywo | Rzeczywistość | Dowód |
|---|---|---|
| `defineLink` / `data/extensions.ts` | **Runtime-dead.** Trzy deklaracje w całym repo, każda z komentarzem „declaration-only, nothing reads this" | `packages/shared/src/lib/query/engine.ts:1176-1200` |
| `executeProposal` — „efektor" | Brak wywołań w module; docstring przyznaje „not mandatory in the MVP" | `.../lib/runtime/executeProposal.ts:41-43` |
| `step.timeout`, `retryPolicy`, `signalConfig.timeout` | Walidowane schematem, przechodzą przez edytor wizualny, **bez konsumenta runtime** → *sygnał może wisieć w nieskończoność* | patrz R-11 |
| Budżety pętli (tokeny, wall-clock) | `runAiAgentObject` **nie konstruuje `BudgetEnforcer`** — a to tryb każdego agenta orchestratora | `packages/ai-assistant/.../agent-runtime.ts:2303-2313` |
| `AgentRunStatus = 'cancelled'` | Zadeklarowany, **nigdy niezapisywany** przez kod first-party | `.../data/entities.ts:11` |
| `AgentRuntime = 'external'` | Przechodzi enumy API i renderuje się w cockpicie, ale **nic go nie dispatchuje** — to etykieta dla runów przyjętych przez ingest trace'ów | `.../lib/sdk/defineAgent.ts:36` vs `.../lib/runtime/agentRuntime.ts:63-77` |
| Import Figmy | `docs/design-system/figma-audit/*.json` to **ręcznie wklejone transkrypty sesji MCP**, żaden skrypt tego nie odtworzy | nagłówek `"method": "Read-only…inventories"` |
| Cockpit — Pause / Configure / Reassign / Take over | Za flagą `NEXT_PUBLIC_OM_AGENT_ORCHESTRATOR_PREVIEW_UI`, **domyślnie wyłączone**, „buttons with no handler, toast-only actions" | `.../lib/featureFlags.ts:17-22` |
| `om-mockup-prototype` „anchored feedback" | Statyczny HTML, localStorage, kotwice po ścieżce DOM, eksport przez commit do gita | `.ai/mockups/time-tracking/prototype.js:152-181` |

---

## 2. Mapa ryzyk

Skala wpływu: **K** = krytyczne (wywraca założenie spec), **W** = wysokie (wymusza przeprojektowanie), **Ś** = średnie (kosztuje czas, da się zaplanować).

### 2.1 Top 8 — te decydują o powodzeniu

| ID | Ryzyko | Wpływ | Prawdop. | Mitygacja |
|---|---|---|---|---|
| **R-01** | Propose-only blokuje agentów piszących kod | K | pewne | Wykonanie kodu poza OM (Cezar); OM widzi proposal → approval → artefakt |
| **R-04** | Graf traceability nie ma prymitywu | K | pewne | **Jeden moduł** → relacje ORM legalne → graf to zwykły SQL |
| **R-02** | Brak warstwy dispatch do zewnętrznego executora | K | pewne | Zaimplementować Fazę 1 istniejącej spec `next/2026-06-19-agent-dispatch.md` |
| **R-03** | `/trace/ingest` nie domyka kroku workflow | K | pewne | Most: ingest → proposal → wznowienie zaparkowanej instancji (~1-2 dni) |
| **R-12** | Cezar jest local-first, bez tenancy i auth | K | pewne | Cezar jako **pull worker / BYO compute**, nie jako serwerowy executor |
| **R-22** | Sprawdzanie własnej pracy (AI ocenia AI w każdym ogniwie) | K | wysokie | Obiektywne bramki (testy, lint, build) **przed** reviewem LLM |
| **R-19** | Visual QA: Figma render ↔ screenshot to nie regresja wizualna | W | pewne | Wyciąć z zakresu; zastąpić asercjami DOM/tokenów DS |
| **R-27** | Zero egzekwowania budżetu kosztowego | W | pewne | Pre-flight check przed dispatchem jako wymóg P0, nie nice-to-have |
| **R-40** | Warstwa runtime'ów nie jest pluggable (`'external'` nic nie dispatchuje) | W | pewne | Spike: Cezar mówi kształtem `OpenCodeRunnerClient`; docelowo rejestr runnerów |

### 2.2 Architektura i platforma

**R-01 · Propose-only vs. agenci piszący kod · K**
`agent_orchestrator` egzekwuje propose-only w **sześciu niezależnych punktach**: odrzucenie rejestracji agenta deklarującego narzędzie `isMutation: true` lub nieznane (`lib/sdk/defineAgent.ts:486-506`), strip narzędzi mutujących w runtime (`:277`), `write/edit/bash: deny` + `task: deny` w generowanym pliku agenta (`lib/sdk/defineFileAgent.ts:333,355`), ACL per wywołanie MCP, oraz **backstop na flush ORM rzucający `AgentWriteBypassError`** (`lib/identity/agentNoBypassSubscriber.ts:53-67`). Szósty: ponowne sprawdzenie akcji tuż przed efektem (`executeProposal.ts:52-66`).
Do tego `AGENTS.md:40`: *„an action agent introduces no new effect surface"* — powierzchnia efektów to katalog komend OM. Wprowadzenie `git_commit` oznacza dodanie workflow-safe command, nie narzędzia agenta.
→ **§21–§26 wymagają przeprojektowania kontraktu agenta.** To nie jest blocker, ale zmienia model: albo commit/PR jest efektorem po zaakceptowanym proposalu, albo wykonanie kodu żyje całkowicie poza OM.

**Konsekwencja, która zaskoczy przy planowaniu:** każda akcja, którą delivery OS musi wykonać — otworzyć PR, zacommitować, uruchomić testy, wdrożyć — musi najpierw zostać **zarejestrowana jako workflow-safe command z zadeklarowanym poziomem ryzyka**. Nie da się jej przemycić jako narzędzia agenta. A ponieważ domyślny pułap auto-akceptacji to `maxAutoApproveRisk: medium`, zarejestrowanie `deploy` na uczciwym poziomie `high` **wymusza bramkę ludzką przy każdym wdrożeniu** — zbieżne z §33, ale narzucone, nie wybrane.
Dodatkowo: **dziś nie istnieje żaden efektor uruchamiający zestaw testów** (trzeba zarejestrować workflow-safe command albo aktywność `EXECUTE_FUNCTION`), a `mercato deploy railway` jest wyłącznie CLI — **nie jest wpisem w słowniku akcji**.

**R-02 · Brak warstwy dispatch · K**
Nie ma trwałego rekordu zadania (`AgentTask`), nie ma żadnego wywołania wychodzącego poza proces Node, nie ma leases ani heartbeatu. Wszystkie semafory (`admission.ts`, `agentWorkspaceManager.ts`) są **process-local i giną przy restarcie**. Payload `INVOKE_AGENT` (`packages/core/src/modules/workflows/data/activity-config-schemas.ts:153-189`) to `{agentId, input, onResult, outputMapping?, subject?, review?}` — **bez repo, brancha, narzędzi, limitów i kontraktu wyniku**.
→ Mitygacja jest napisana: `.ai/specs/enterprise/agent-orchestrator/next/2026-06-19-agent-dispatch.md` (Status: NOT STARTED) specyfikuje `AgentTask` jako źródło prawdy, `DispatchService.enqueue`, leases z heartbeatem i dead-letteringiem oraz trzy transporty, w tym **pull workers dla firewalled/BYO compute** i runtime-agnostyczny `AgentBinding`. **Nie wymyślać tego od nowa.**

**R-03 · Zewnętrznie wykonane zadanie nie potrafi domknąć kroku · K**
`POST /api/agent_orchestrator/trace/ingest` istnieje, jest podpisany HMAC (Standard Webhooks), idempotentny na `(runtime, externalRunId)`, przyjmuje `runtime` jako dowolny string, tokeny, `costMinor`, spany. **Ale: tworzy/aktualizuje `AgentRun` i na tym kończy.** Nie tworzy `AgentProposal`, nie uruchamia dyspozycji, nie wznawia zaparkowanego workflow — ta ścieżka (`invokeAgentForWorkflow → dispose`) jest wyłącznie in-process.
→ To **pojedynczy najważniejszy brakujący element dla dema**: bez niego Cezar może zaraportować, że skończył, a proces w OM tego nie zauważy. Jednocześnie to najtańsza z krytycznych luk.

**R-04 · Graf traceability nie ma prymitywu · K**
§37 nazywa graf „kluczową właściwością systemu". Tymczasem: `QueryEngine.query()` obsługuje **jedną encję na wywołanie**, bez `expand`/`include` (`packages/shared/src/lib/query/types.ts:193-195`); `QueryOptions.joins` kompiluje się do skorelowanego `WHERE EXISTS` — **filtr, zero projekcji** (`join-utils.ts:366-369`), więc dostajesz wiersze korzenia, nigdy przeskoków pośrednich; `defineLink` jest runtime-dead; `query_index` denormalizuje jeden wiersz bazowy i **nie robi fan-out inwalidacji** (zapis do B nie odświeża kopii B w A).
Ścieżka `REQ → TASK → AgentRun → ReviewFinding` to **cztery sekwencyjne zapytania**, każde zbierające id do `$in` następnego. Najbliższy helper paginuje id do pamięci przy pageSize 100 / maxPages 1000.
→ Brakujący element: generyczna tabela krawędzi (`from_entity_type, from_id, to_entity_type, to_id, edge_kind, tenant_id, organization_id, snapshots`) z symetrycznymi indeksami i batchowanym serwisem trawersacji. Będzie **niewidoczna dla `QueryOptions.joins`** (tabela polimorficzna nie ma pary `table`+`field`), więc trawersacja przez raw Kysely.

**R-05 · Podział na moduły jest mnożnikiem kosztu · K**
Reguła `AGENTS.md:37`: **zero relacji ORM między modułami**. Precedens kosztu: `document_entity_links` (`packages/documents/.../data/entities.ts:453-618`) — jedna nullowalna kolumna uuid **na typ celu** (7 sztuk), 7 częściowych indeksów w przód, **7 kolejnych wstecz** dla dwukierunkowości, plus `label_snapshot`/`href_snapshot` żeby link się renderował, gdy moduł-peer jest wyłączony.
→ **Jeśli ~35 encji żyje w jednym module, relacje ORM są w pełni legalne i graf to zwykły SQL.** Rozbicie ich na 6–8 modułów „dla czystości" zamienia każdą krawędź w: kolumnę/tabelę złączeniową + indeks w przód + indeks wstecz + kolumny snapshot + ręcznie napisany subscriber inwalidujący + jeden round-trip na przeskok.
→ **To jest najtańsza decyzja o największym wpływie w całym projekcie.** Naturalny odruch „czystej architektury" jest tutaj tym drogim.

**R-06 · Kierunek zależności enterprise → OSS · W**
`packages/enterprise` zależy od `core`/`ui`/`queue`/`ai-assistant`, **nie odwrotnie**. Moduł OSS nie może zaimportować `agent_orchestrator`. Aktywacja jest podwójnie bramkowana i domyślnie wyłączona: `OM_ENABLE_ENTERPRISE_MODULES` + `OM_ENABLE_ENTERPRISE_MODULES_AGENTS` (`apps/mercato/src/modules.ts:196-217`). Licencja: `SEE LICENSE IN LICENSE.md`, `publishConfig.access: restricted`, osobny build.
→ Decyzja **przed** pisaniem kodu — przenoszenie kodu przez granicę OSS/enterprise to jawny punkt „Ask First" (`packages/enterprise/AGENTS.md`).
→ Wariant hybrydowy jest realny: OSS `delivery_os` (Project/Requirement/Design/Task/graf — użyteczne samodzielnie jako narzędzie do specyfikacji i planowania) + nakładka enterprise (egzekucja agentów, dispatch, guardrails, koszty, cockpit), spięte przez `tryResolve` + eventy.

**R-07 · Podatek per-encja jest egzekwowany w CI · W**
Każda encja użytkownika wymaga: `tenant_id` + `organization_id`, `updated_at` z `onCreate`+`onUpdate`, `deleted_at`, **wpisu do ręcznie kuratorowanego rejestru** (`packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts:30-65` — dziś 60 encji w 20 modułach), `updatedAt` w każdej odpowiedzi API, ~2 feature'ów ACL, wpisu w `setup.ts`, **~55 kluczy i18n × 5 lokalizacji**, bloku `om-ds/*` o severity `error` w `eslint.ds.config.mjs`, zapisów przez wzorzec komend.
`yarn i18n:check-sync` i testy strażnicze są w bramce walidacyjnej (`.ai/agentic.config.json`) — **nic z tego nie da się odroczyć za pierwszy PR**. ~150–250 LOC i 6 dotknięć plików per encja, zanim powstanie jakikolwiek kod biznesowy.

**R-08 · Skala literalnego odczytu spec · W**
Zmierzone: `customers` = 489 plików nietestowych / 141 749 LOC / 25 encji → **~19,6 pliku i ~5 670 LOC na encję**. `agent_orchestrator` = 21 encji / 537 plików → ~25 plików/encję. Typowa encja: 22–30 plików, 1 800–2 600 LOC produkcyjnych, 1 500–3 000 LOC testów, 300–450 par klucz-wartość i18n.
→ Literalne 35 encji ≈ **875 plików, ~70 000 LOC produkcyjnych, ~90 000 LOC testów — około 1,5× moduł `customers`.**
→ Po odjęciu tego, co istnieje (~14–16 encji): ~19–21 nowych ≈ 500 plików / 40k LOC. Po zastosowaniu custom entities dla ogona: **~8–12 prawdziwych encji ORM ≈ 250–300 plików / 20–25k LOC.** To już jest wykonalne.

**R-09 · Brak scaffoldera CRUD · Ś**
`yarn generate` tylko podłącza pliki, które już napisałeś (rejestry, DI, entity ids) — oszczędza 200–400 LOC boilerplate'u rejestracyjnego na encję i **zero** kodu encji, walidatorów, route'ów, komend, sześciu plików stron, ACL, i18n i testów. `om-module-scaffold` to instrukcje dla agenta, nie generator.

**R-10 · Równoległość wewnątrz instancji workflow jest kooperatywna · Ś**
`PARALLEL_FORK`/`JOIN` przeplatają gałęzie **pod jednym pesymistycznym lockiem instancji** — komentarz w kodzie mówi wprost „single lock, no thread-level concurrency" (`workflows/lib/parallel-handler.ts:1-20`). Prawdziwa równoległość jest między instancjami, przez kolejkę (`WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY=5` per proces × repliki, wymaga `QUEUE_STRATEGY=async` + Redis; strategia domyślna `local` jest **sekwencyjna, plikowa**).
→ §47 pkt 12 („co najmniej 2 równoległe agent runs") jest osiągalne, ale **wymaga świadomego zaprojektowania** — i Redisa w demie.

**R-11 · Zadeklarowane, ale niepodłączone pola workflow · W**
`step.timeout`, step-level `retryPolicy`, `signalConfig.timeout` oraz stała `SIGNAL_TIMEOUT` przechodzą walidację schematu i round-trip przez edytor wizualny, ale **nie mają konsumenta runtime**. Eventy `workflows.instance.paused/resumed` są zadeklarowane i nigdy nieemitowane.
→ Konsekwencja wprost dla §38: **bramka ludzka, na którą nikt nie odpowie, zawiesi proces bez timeoutu i bez eskalacji.** `UserTask` ma kolumny `dueDate`/`escalatedAt`/`ESCALATED`, ale nie ma drivera eskalacji.

**R-30 · Brak anulowania runa w locie · Ś**
Status `cancelled` istnieje w typie, nic go nie zapisuje poza ingestem trace'ów. Jedyne, co kończy run, to deadline (`OM_AGENT_RUN_TIMEOUT_MS`, 5 min). Anulowanie **instancji workflow** działa, ale bez kompensacji (ta odpala się tylko na `FAILED`).
→ „Start/pause/resume workflow" z §6 jest częściowo iluzoryczne na poziomie runa agenta.

### 2.3 Integracja z Cezarem

**R-12 · Cezar jest narzędziem local-first, bez tenancy i auth · K**
Z README projektu: *„Run coding agents in parallel, right in your repo. **Local, zero config, no accounts**."* Uruchamiany przez `npx cezar-cli`, cockpit na `localhost:4321`, **stan w zwykłych plikach w `.ai/cezar/`, bez bazy danych**. Ślady w tym repo potwierdzają model: `.gitignore:163-167` („local agent-runner state… its own `.gitignore` covers the launch key"), wykluczenie jego worktree'ów z Playwrighta (`.ai/qa/tests/playwright.config.ts:19-24`), prefiks brancha `cez/<uuid8>` w `.ai/runs/*/HANDOFF.md`, commit `cezar: autosave (step-3) (#2098)`.
OM jest wielotenantowy, z ACL sprawdzanym przy każdym wywołaniu narzędzia i z `organization_id`/`tenant_id` na każdym wierszu.
→ **Podpięcie Cezara jako serwerowego executora dla wielu klientów to nie integracja — to zmiana modelu wdrożeniowego Cezara** (tenancy, auth, API, trwałość stanu). Wariant tańszy: Cezar jako **pull worker po stronie klienta** („BYO compute"), co jest dokładnie jednym z trzech transportów przewidzianych w `next/2026-06-19-agent-dispatch.md`.

**R-13 · Podwójna orkiestracja, dwa źródła prawdy o stanie · K**
§3 dzieli role: „OM Orchestrator = workflow/stany/dispatch, Cezar = execution engine". W rzeczywistości Cezar **ma własny orkiestrator** (kolejkowanie zadań, równoległość, warianty do porównania, tryb autonomiczny, integracja z GitHub issues), **własny cockpit** z monitoringiem postępu, wywołań narzędzi i zużycia tokenów (nakłada się na §34), **własny format workflow w YAML** (nakłada się na silnik DAG w `packages/core/src/modules/workflows`) i **własny format skilli w Markdown** (nakłada się na §43).
→ Bez jawnego narysowania granicy powstaną dwa niezależne, rozjeżdżające się źródła prawdy o stanie zadania — a to uderza bezpośrednio w §37 (traceability) i §34 (dashboard).
→ **Rekomendacja:** Cezar dostaje *jedno zadanie* i zwraca *jeden strukturalny wynik*; jego wewnętrzne workflow YAML jest szczegółem implementacyjnym, którego OM nie modeluje. Cockpit Cezara jest narzędziem deweloperskim, nie powierzchnią produktu.

**R-31 · Sekrety przez granicę · W**
§40 słusznie mówi, że sekrety nie trafiają do zwykłego kontekstu agenta. Ale Deployment Agent (§31) ich potrzebuje, Cezar ma **własny launch key** zarządzany lokalnie, a agent musi mieć dostęp do repo klienta. Spec nie opisuje, jak poświadczenia do repo / CI / hostingu klienta przechodzą przez granicę OM ↔ Cezar ani gdzie są przechowywane.
→ **Częściowa odpowiedź jest lepsza, niż się wydaje.** Przez granicę muszą przejść tylko trzy rzeczy: (1) krótkotrwały token OM zakresowany na rolach wywołującego, odwoływany w `finally`, (2) per-tenantowy sekret HMAC do raportowania trace'ów (wyprowadzony z `JWT_SECRET`, nigdy sam root secret), (3) klucz Tier-1 silnika, jeśli ma wołać MCP. **Poświadczenia gita, token GitHuba i klucze providerów modeli zostają po stronie Cezara** — OM nie ma mechanizmu, by je dostarczyć, ani miejsca, by je dla tego celu przechowywać.
→ Ryzyko rezydualne jest więc węższe, ale realne: to **Cezar** staje się miejscem przechowywania poświadczeń do repo i CI klienta, a jest narzędziem local-first bez modelu tenancy (R-12). Sekrety projektu klienta X i Y lądują na tej samej maszynie, w plikach.
→ Uwaga proceduralna: zmiana kontraktu HMAC ingestu trace'ów, kontraktu `/identity/*` lub odwoływania grantów to jawny punkt „Ask First" (`.../agent_orchestrator/AGENTS.md:178`) — integracja Cezara dotykająca tych powierzchni wymaga spec.

**R-32 · Brak modelu provisioningu · W**
§6 traktuje `repository` jako pole intake — zakłada, że repo istnieje. Nikt nie tworzy repozytoriów. §31 mówi „Deploy Preview/Staging" bez mechanizmu provisioningu środowiska; skąd URL staging? Brak rollbacku i ścieżki na nieudany deployment. Brak encji `Deployment` (CLI Railway wdraża, ale nic nie zapisuje).

### 2.4 Design i Figma

**R-14 · Kierunek prawdy jest odwrócony · K**
Repo ma zbudowane, udokumentowane i pilnowane tooling `code → Figma`: `scripts/ds-tokens-export.mjs` (595 linii) parsuje `apps/mercato/src/app/globals.css` → `.ai/ds/ds-tokens.json`, z bramką dryfu `yarn ds:tokens:check` (exit 1). `.ai/ds/README.md:31-36` mówi wprost: *„Direction of truth: code pushes, Figma mirrors… Nothing ever writes CSS from JSON."*
Spec §11 deklaruje odwrotnie („Figma owns design").
→ **To nie jest feature, tylko cofnięcie wdrożonej decyzji architektonicznej.** Wymaga jawnego rozstrzygnięcia przed jakimkolwiek kodem.
→ **Rekomendacja:** rozdzielić. Figma-as-truth **tylko dla DS projektu klienta**; kod-as-truth dla DS samej platformy. Inaczej anti-drift tooling zostanie zanegowany.

**R-15 · Zero odczytu Figmy w kodzie produktu · K**
Jedyny klient HTTP do Figmy w repo to `scripts/ds-tokens-export.mjs:447-470` — **write-only**, bramkowany planem Enterprise, z adnotacją „never run this in CI". Brak OAuth, brak przechowywania tokenów w aplikacji, brak pobierania renderów węzłów.
Wszystko, co wygląda na istniejący import Figmy (`docs/design-system/figma-audit/*.json`, 1,1 MB), to **ręcznie wklejone transkrypty sesji agenta MCP** — żaden skrypt tego nie odtworzy. Manifest `docs/design-system/figma-audit/pages.json`, od którego zależy strona Storybooka, **nigdy nie został zacommitowany**, a jego test jest dziś `.skip()`-nięty na `main` (issue #6223).
→ Do zbudowania od zera: klient REST jako kod produktu, OAuth lub PAT per tenant, szyfrowane przechowywanie poświadczeń, rate limiting, `GET /v1/files/{key}`, `/nodes`, `/images`, `/versions`, wykrywanie zmian.

**R-16 · Figma nie ma write API do tworzenia designu · K**
Ścieżka `FROM_BRIEF` (§11: *„system wykorzystuje Figmę do Design Systemu, wireframes i finalnych screens"*) wymaga, by agent **tworzył** projekty w Figmie. Figma nie udostępnia publicznego write API do swobodnego tworzenia designu — zapis idzie wyłącznie przez **Plugin API**, co wymaga żywej sesji Figmy z otwartym plikiem.
→ To podważa autonomię całej ścieżki `FROM_BRIEF` i **nie jest w spec nigdzie zaadresowane**. Albo w pętli stoi człowiek z otwartą Figmą, albo ta ścieżka produkuje design poza Figmą.

**R-17 · Variables REST API bramkowane planem Enterprise · W**
Własny draft spec repo (`.ai/specs/2026-07-07-ds-theme-from-figma-brand-import.md`) zauważa: *„the Variables REST API is Enterprise-plan-gated… most client files are on Professional or lower"*. Dla software house'u pracującego na plikach klientów to trafia w większość przypadków.

**R-21 · DS extraction z Figmy jest przeszacowane · W**
Istnieje wyłącznie jako **Draft zależny od innego Draftu** (`2026-07-07-ds-theme-from-figma-brand-import.md` → `2026-07-05-ds-theming-and-brand-customization.md`), żaden niezaimplementowany (`grep "from-figma\|theme init"` po `packages/cli/src` → nic). Co gorsza, dojrzalszy z nich sam argumentuje, że kluczowa część jest **nieautomatyzowalna**: *„the machine inventories, the designer interprets"*, i dokumentuje tryb porażki „częstotliwość zamiast roli" jako błąd, który system może zinstytucjonalizować.
→ §10 obiecuje rekonstrukcję wariantów, rozmiarów, stanów, zachowania responsywnego i wymagań a11y per komponent z dowolnego pliku Figma. **To jest daleko poza tym, co ktokolwiek w tym repo uznał na piśmie za osiągalne.** Realistyczny sufit: kolory + fonty + promienie uszeregowane wg częstotliwości, z człowiekiem przypisującym role.

**R-18 · Visual QA nie ma żadnej podstawy · W**
Brak zależności do image-diff (żadnego pixelmatch / resemblejs / odiff / looks-same / jest-image-snapshot). Brak `toHaveScreenshot`, brak `snapshotPathTemplate`, brak katalogów baseline. Playwright robi screenshoty (`.ai/qa/tests/playwright.config.ts:76`), ale wyłącznie jako **artefakty dowodowe przy błędzie**, nigdy do porównania.
Regresja wizualna była specyfikowana **czterokrotnie od kwietnia 2026** i nigdy nie zbudowana (`.ai/specs/implemented/2026-04-25-ds-foundation.md:50,474,639`). **To sygnał, nie przypadek.**

**R-19 · Porównanie render Figmy ↔ screenshot przeglądarki to nie jest regresja wizualna · W**
Nawet zakładając, że differ istnieje: render Figmy i screenshot przeglądarki pochodzą z **różnych rasteryzerów**, mają inny rendering fontów, inny sub-pixel AA, inne skalowanie obrazów i nie dzielą DOM-u. Pixel diff będzie zdominowany szumem.
A §29 chce diffa **semantycznego** („spacing, brakujące elementy, niewłaściwe komponenty, responsive mismatch") — to wymaga porównania **strukturalnego** drzewa węzłów Figmy z żywym DOM, sparowanego przez mapowania Code Connect. Pokrycie Code Connect w repo: **23 komponenty, ręcznie pisane, publikacja bramkowana planem.**
→ **Rekomendacja:** wyciąć z zakresu. Zastąpić asercjami implementacji wobec tokenów DS i tożsamości komponentów — `scripts/storybook-*-checks.mjs` już to robi przez computed styles — plus baseline DOM-vs-DOM. Screenshot zostaje jako **dowód dla człowieka**, nie jako automatyczna bramka.

**R-20 · Komentarze kotwiczone to pełny moduł, nie reuse · W**
`om-mockup-prototype` wygląda na gotowca, ale kotwiczy przez **pozycyjną ścieżkę DOM** (`div>section:2>button:3`) w jednoosobowym statycznym HTML z `localStorage` i eksportem przez commit do gita. Nic z tego nie przenosi się na kotwice we **współrzędnych obrazu**, uwierzytelnienie, wielu użytkowników i tenancy.
`packages/ui` **nie ma prymitywu zoomowalnego canvasu obrazu**. Najbliższy analog — adnotacje na canvasie React Flow w module `workflows` — kotwiczy do węzłów grafu w JSON, nie do rastra, i nie ma modelu wątków ani statusów.
→ Budżetować jako pełny moduł CRUD + istotna nowa powierzchnia UI. **Re-anchoring komentarzy między wersjami designu (komentarz z v3 pokazywany na renderze v4) zje więcej czasu niż sam CRUD.**

### 2.5 Jakość i zaufanie do AI

**R-22 · Sprawdzanie własnej pracy — ryzyko systemowe · K**
Discovery Agent pisze wymagania → BA je strukturyzuje → Developer implementuje → **QA Agent pisze testy do tych samych AC** → Final Acceptance weryfikuje. Bramki ludzkie są trzy (§38) i **żadna nie weryfikuje, czy test faktycznie testuje AC**.
§28 nazywa mapowanie `Requirement ↔ AC ↔ Test ↔ Result` „kluczowym", nie podając mechanizmu. Delivery Report z §32 („Satisfied: 22, Partial: 2") będzie **dokładnie tak wiarygodny, jak testy, których nikt niezależnie nie zwalidował** — a napisał je ten sam model, z tego samego opisu.
→ Mitygacja: obiektywne bramki (kompilacja, lint, testy, build) **przed** jakimkolwiek reviewem LLM; test-review jako osobny, wąski krok z innym promptem i innym modelem; próbkowanie ludzkie na testach, nie tylko na kodzie.

**R-23 · Reverse Specification „bez wymyślania" · K**
§15 wymaga, by agent analizował zachowania wynikające z UI *bez wymyślania brakujących*. To **najtwardsze wymaganie niezawodności w całym dokumencie** i jest zaadresowane jednym zdaniem. Brak scoringu pewności, brak przeglądu pozycja-po-pozycji, brak rozróżnienia „widzę to na ekranie" od „zakładam, że tak działa".
→ Mitygacja: wymusić, by każda wykryta pozycja niosła **dowód** (id węzła Figmy / wycinek renderu) i by pozycje bez dowodu lądowały automatycznie w `Questions`, nie w `Requirements`.

**R-24 · Reviewer LLM recenzujący LLM bez kotwicy prawdy · W**
§25/§26. Dwa tryby porażki: fałszywa akceptacja (reviewer zatwierdza zepsuty kod) i pętla na drobiazgach stylistycznych wyczerpująca `max_autonomous_iterations`. §24 słusznie wymaga testów przed `READY_FOR_REVIEW` — to trzeba wzmocnić, a reviewerowi zostawić wyłącznie to, czego automat nie sprawdzi.

**R-25 · Brak obsługi naruszenia kontraktu strukturalnego · Ś**
§43 zakłada structured output. Modele naruszają schematy. Brak pętli naprawczej, brak wersjonowania kontraktów, brak zdefiniowanego zachowania przy niezgodności. Istniejący guardrail na schemat **fail-closed** (`guardrailService.ts:169`) jest dobrą podstawą, ale oznacza porażkę runa, nie naprawę.

**R-26 · Context Builder to nierozwiązany problem badawczy · W**
§22 podaje listy „co wchodzi", ale „Relevant Files" to zadanie retrieval/ranking, nie konfiguracja. Istniejący `AgentContextBundle` jest **record-scoped, nie repo-scoped** — czyta rekordy z bazy, trafienia retrieval i zaingestowane dokumenty, **nigdy plików, diffów ani baseline'ów designu**. Budżet zaszyty na 4000 tokenów (`nativeAgentRunner.ts:52`), składany in-process tuż przed wywołaniem modelu i **nigdy nieserializowany do przekazania na zewnątrz** (`payload_ref` istnieje, nic go nie wypełnia dla zewnętrznego konsumenta).

### 2.6 Koszty i kontrola

**R-27 · Zero egzekwowania budżetu kosztowego · W**
Koszt jest **obserwowalny, nigdy ograniczany**. `grep "costLimit|maxCost|spendCap|budgetMinor"` → wyłącznie proza. Nic nie czyta skumulowanego kosztu i nie odmawia startu ani kontynuacji. Zatrzymać potrafią: wall clock, sloty współbieżności, współbieżność providera, kroki pętli (tylko w trybie chat) i guardrails.
→ §6 („AI budget/cost limit"), §39 („przekroczony AI budget" jako blocker) i §44 („budget exceeded" jako typ porażki) **nie mają się o co oprzeć**. Autonomiczna pętla korekcyjna jest domyślnie **nieograniczona wydatkowo**. Przy demie to ryzyko finansowe, przy produkcji — egzystencjalne.

**R-28 · Budżety pętli są martwe w trybie object · W**
`runAiAgentObject` — tryb, którego używa **każdy** agent orchestratora — **nie konstruuje `BudgetEnforcer`**; przekazywany jest wyłącznie `maxSteps` (`agent-runtime.ts:2303-2313`). Limity tokenowe i wall-clock, które wyglądają na istniejące, **na tej ścieżce nie działają**. Dodatkowo per-tenantowe override'y pętli mają encję i route zapisu, ale `resolveEffectiveLoopConfig` niesie `TODO(Phase 1782-3)` (`:457-458, :497-498`) — mimo że dokumentacja (`apps/docs/.../agents.mdx:445`) twierdzi inaczej.

**R-29 · Rozliczanie kosztów żyje w trzech rozłącznych, nieuzgodnionych płaszczyznach · W**
Wbrew pierwszemu wrażeniu `CostRecord` z §42 to **realna budowa, nie projekcja nad istniejącymi danymi**:
- **Płaszczyzna A (orchestrator)** — `agent_runs.input_tokens/output_tokens/cost_minor/currency`, `ProcessInstance.costMinor` (`.../data/entities.ts:1541`), `AgentEvalCaseRun.costMinor` (`:1895`). Pieniądze **i** tokeny, ale bez rollupu per projekt.
- **Płaszczyzna B (`ai_assistant`)** — `AiTokenUsageEvent` (`packages/ai-assistant/.../data/entities.ts:406`) per krok AI-SDK, z dzienną agregacją `(tenant, dzień, agent, model)`. **Brak jakiejkolwiek kolumny kosztu — wyłącznie tokeny.**
- **Płaszczyzna C (`packages/telemetry`)** — nie dostarcza ani metryki kosztu, ani tokenów; dodanie jej to jawny punkt „Ask First".
Komentarz w `token-usage-recorder.ts:39` mówi, że event istnieje, „so downstream subscribers (cost dashboards, metering) can react" — **ten dashboard jest zadeklarowanym punktem rozszerzenia, którego nikt nie zbudował.**
→ §36 (koszt per etap: Architecture/Design/Development/Review/QA/Security) wymaga: atrybucji projekt+etap, **uzgodnienia płaszczyzn A i B**, przeliczania walut, edytowalnej per tenant tabeli cen i pułapu budżetu per projekt. Nic z tego nie istnieje. Agregacja jest dziś per agent / tenant / okno czasowe.
→ Co jest darmowe: egzekwowanie `cost_limit` z §43 **w obrębie jednego runa** (presety pętli, `budget-tool-calls`/`budget-wall-clock`/`budget-tokens`, AbortController per tura). Budżetu **między runami** nie ma żadnego.

### 2.7 Zakres, proces, produkt

**R-33 · Dwa entry pointy podwajają powierzchnię hackathonu · W**
§47 ma 20 pozycji must-have, w tym obie ścieżki. `FROM_DESIGN` jest **trudniejsze** (Figma read + DS extraction + reverse spec) i to właśnie tam **nie ma ani jednej linii kodu**. Cztery pozycje z listy (4 — Figma, 7 — komentarze wizualne, 12 — porównanie wizualne, 18 — rekord deploymentu) to jedyne prawdziwie nowe budowy; reszta to w dużej mierze konfiguracja istniejącej infrastruktury.

**R-34 · Lifecycle projektu jest liniowy, a praca jest równoległa · W**
§5 to jedna maszyna stanów dla całego projektu (`IMPLEMENTATION → CODE_REVIEW → QA`), ale §18 zakłada „parallelizable groups", a §39 mówi, że blocker zatrzymuje wyłącznie zależną gałąź grafu. Pięć zadań w pięciu różnych fazach jednocześnie nie da się opisać jednym stanem projektu.
→ **Lifecycle zadania nie jest w spec zdefiniowany, a to on jest właściwą maszyną stanów.** Stan projektu powinien być **agregatem wyliczanym**, nie niezależnie przestawianym — dokładnie tak, jak w platformie działa już `ProcessInstance` (status wyprowadzany z `WorkflowInstance`, nigdy niezależnie przestawiany).

**R-35 · Adapter platformy jest opisany zbyt płytko · W**
Przykład YAML z §17 to `build`/`test` + coding standards. Realny adapter potrzebuje scaffoldingu projektu, zarządzania zależnościami, poświadczeń deploymentu, provisioningu środowisk i reguł walidacji specyficznych dla runtime'u. Cztery wymienione cele (WordPress/PHP, Strapi, Open Mercato/Next, generic Node) to **radykalnie różne światy**.
→ §47 słusznie redukuje to do „jeden naprawdę działający + jeden PoC". Ale §2 pozycjonuje genericzność jako **rdzeń obietnicy produktu**, którego MVP nie udowodni. Warto to rozejść: obietnica marketingowa vs. zakres demo.

**R-36 · Pozycjonowanie i miejsce w produkcie · Ś**
Open Mercato jest platformą e-commerce. Przerobienie jej na generyczny control plane do dostarczania oprogramowania to istotna decyzja produktowa — a moduł i tak wyląduje w `packages/enterprise` (restricted npm, dwie flagi env, osobny build, licencjonowanie per-projekt z „Phone Home"). Niedostępne dla użytkowników OSS.

**R-37 · Kolizja z zaplanowaną roadmapą modułu · W**
Delivery OS mapuje się **niemal dokładnie** na niezrealizowany bucket `next/` w `agent_orchestrator`: `2026-06-19-agent-dispatch.md`, `gap-14-lifecycle-autonomy-shadow.md` (drabina autonomii, shadow mode, agent releases — „Status: NOT STARTED"), `2026-06-19-agent-context-knowledge-plane.md`, `2026-07-10-agent-role-taxonomy-and-decision-pipeline.md`.
→ Ryzyko dublowania pracy albo rozjechania się z roadmapą modułu. **Rekomendacja: wykorzystać te specy jako plan implementacji, a nie pisać konkurencyjny.**

**R-38 · Brak strategii testowania samego orkiestratora · Ś**
Spec nie mówi nic o tym, jak testować system, którego zadaniem jest testowanie innych systemów. Aktywo do wykorzystania: `AgentEvalCase`/`Assertion`/`Result`/`SuiteRun` — gotowy flywheel ewaluacyjny.

**R-39 · Runtime OpenCode jest na ścieżce deprecjacji · Ś**
Jedyne miejsce, gdzie agent w OM w ogóle dotyka plików (`openCodeAgentRunner.ts`, 889 LOC), ma **zapisaną decyzję utrzymaniową o zastąpieniu go runtime'em `native`** (`.ai/specs/enterprise/agent-orchestrator/2026-07-07-lightweight-agent-runtime.md`). Nie kotwiczyć projektu na sandboxach OpenCode ani jego płaszczyźnie plikowej.

**R-40 · Warstwa runtime'ów nie jest pluggable · W**
`agentRuntime.ts:63-77` to **zahardkodowany `if` o dwóch gałęziach**; oba runnery są `new`-owane inline, bez interfejsu i bez rejestru. `AgentRuntime` zawiera już `'external'` (`lib/sdk/defineAgent.ts:36`), przechodzi enumy API i renderuje się w cockpicie — ale **nic go nie dispatchuje**; to wyłącznie etykieta dla runów przyjętych przez `/trace/ingest`.
→ Trzy szwy, od najtańszego: **(a) adapter na warstwie transportu** — `openCodeClient` jest singletonem DI, a runner potrzebuje tylko trzyczasownikowego kształtu `OpenCodeRunnerClient`; „Cezar mówi tymi trzema czasownikami" **nie wymaga żadnej zmiany w orchestratorze** i jest najszybszym działającym spike'em. **(b)** Podmiana `agentRuntime` przez DI — wszystko albo nic (reimplementujesz admission, actor scoping i no-bypass subscriber, albo opakowujesz oryginał). **(c)** Nowy `case` + `CezarAgentRunner` + rejestr runnerów zastępujący `if` — uczciwa budowa. Unia `AgentRuntime` jest w `BACKWARD_COMPATIBILITY.md` oznaczona jako **ADDITIVE-ONLY**, więc dodanie `'cezar'` jest legalne.

**R-41 · Kształt runa nie pasuje do wielogodzinnej sesji kodującej · W**
Istniejący runner zewnętrzny jest **synchroniczny i sterowany przez OM**: wysyłka HTTP jest fire-and-forget, a zakończenie wykrywane przez wyścig odpytywania bazy (750 ms), SSE busy→idle i deadline'u; przy bezczynności bez wyniku — 500 ms karencji, **jedna korygująca zachęta**, drugi idle i poddanie się. Do tego twardy limit 5 minut.
→ Run Cezara trwa minuty do godzin. **To nie jest ten kształt.** Długą pracę trzeba prowadzić przez kolejkę + `ProgressJob`, gdzie każde wywołanie agenta jest **ograniczonym krokiem**, a nie jedną długą sesją trzymającą otwartą aktywność workflow.

---

## 3. Punkty niedopracowane i nieszczegółowe

Uporządkowane wg sekcji spec. To nie są ryzyka — to miejsca, gdzie dokument urywa się przed mechanizmem.

| § | Punkt | Czego brakuje |
|---|---|---|
| §5 | Lifecycle | Brak lifecycle **zadania**. Brak reguły, czy stan projektu jest agregatem czy niezależny. Brak przejść do `BLOCKED`/`CANCELLED` |
| §8 | „Akceptacja tworzy baseline specyfikacji" | Brak wersjonowania wymagań, brak diffu baseline'ów, brak zachowania przy zmianie wymagania po akceptacji |
| §12/§14 | Zmiana designu po akceptacji | Brak odpowiedzi, co dzieje się z **zadaniami w locie**, gdy nowy baseline zostaje zatwierdzony. „Człowiek decyduje" nie jest mechanizmem |
| §13 | `linked_change_request` | `ChangeRequest` nie ma nigdzie zdefiniowanego cyklu życia, autora, stanów ani relacji do baseline'u wymagań |
| §15 | Reverse Specification | Brak mechanizmu odróżniania obserwacji od domysłu; brak wymogu dowodu przy wykrytej pozycji |
| §17 | Target Adapter | Brak scaffoldingu, zarządzania zależnościami, poświadczeń, provisioningu środowisk, wersjonowania adaptera |
| §22 | Context Builder | „Relevant Files" to problem retrieval/ranking podany jako punkt listy. Brak strategii, brak budżetu, brak ewaluacji trafności |
| §26 | `max_autonomous_iterations` | Brak definicji, co czyni finding **ważnym**; brak rozróżnienia blokujące vs. kosmetyczne; brak zachowania przy oscylacji |
| §28 | `Requirement ↔ AC ↔ Test ↔ Result` | Nazwane „kluczowym mapowaniem" bez mechanizmu. Kto pisze test? Kto waliduje, że test testuje AC? |
| §29 | Visual QA | Brak modelu tolerancji, brak definicji pass/fail, brak normalizacji (fonty, animacje, dane dynamiczne, scrollbary) |
| §30 | Security | Brak polityki severity. Brak rozdzielenia skanów narzędziowych (wykonalne) od oceny auth/authz przez LLM (zawodne) |
| §31 | Deployment | Brak provisioningu środowiska, brak rollbacku, brak ścieżki na nieudany deploy, brak encji `Deployment` |
| §32 | Final Acceptance | Brak mechanizmu porównania działającego systemu z prozą briefu. `Satisfied/Partial/Missing` wymaga dowodu per wymaganie |
| §36 | Koszty | Brak punktu egzekwowania. Kontrola musi być pre-flight (przed dispatchem) **i** mid-flight (strumieniowo) — to drugie jest trudne |
| §39 | Blockers | „Blocker zatrzymuje wyłącznie zależną część grafu" wymaga grafu zależności, który nie istnieje. Brak semantyki częściowego zatrzymania |
| §43 | Kontrakty agentów | Brak wersjonowania kontraktów, brak obsługi naruszenia schematu, brak reprezentacji wire dla zewnętrznego executora |
| §44 | Failure Handling | „alternate agent/model" bez strategii wyboru i fallbacku. Brak idempotencji i replay runów |
| — | Całkowicie nieobecne | Provisioning repo · zarządzanie sekretami projektu docelowego · rollback · współbieżność wielu recenzentów · retencja artefaktów (rendery, screenshoty to dużo blobów) · wielojęzyczność briefów · własność IP generowanego kodu · testowanie samego orkiestratora |

---

## 4. Pytania o cel i odpowiedzi

Użytkownik prosił o postawienie pytań dotyczących celu i znalezienie na nie odpowiedzi. Odpowiedzi pochodzą z samego dokumentu, z kodu repozytorium albo z README Cezara — źródło podane przy każdej.

**P1. Czy produktem jest wygenerowany kod, czy proces?**
→ **Proces.** Spec odpowiada sobie sam w §50: *„Najważniejszym produktem nie jest sam wygenerowany kod. Jest nim kontrolowany, powtarzalny i obserwowalny proces autonomicznego software delivery."*
→ **Konsekwencja, której spec nie wyciąga:** to przestawia ranking ryzyk. R-04 (graf traceability) i R-22 (sprawdzanie własnej pracy) rosną do rangi egzystencjalnej, bo dotyczą *wiarygodności procesu*. R-24 (jakość reviewera LLM) maleje — słaby review jest akceptowalny, jeśli jest **widoczny i audytowalny**. Inwestycja powinna iść w traceability i dowody, nie w jakość generowanego kodu.

**P2. Kto jest klientem tego systemu?**
→ **Software house / agencja**, nie zespół produktowy. Sygnały: robocza nazwa „Autonomous Software House", adaptery na WordPressa i Strapi (technologie projektów klienckich, nie własnego produktu), rola `Client Reviewer` w §40, brief jako wejście, „Give us an idea or give us a design".
→ **Konsekwencja:** wielotenantowość jest realna i twarda (projekt klienta X vs Y), co bezpośrednio uderza w R-12 (Cezar bez tenancy), R-17 (plany Figma klientów) i czyni adaptery kluczowe, a nie opcjonalne.

**P3. Człowiek w pętli czy nad pętlą?**
→ **Nad pętlą.** §38 definiuje minimum trzy bramki na granicach faz, §26 dopuszcza autonomię wewnątrz pętli z limitem iteracji. Model to „kontrola na granicach, autonomia wewnątrz".
→ **Konsekwencja:** to wymaga **drabiny autonomii**, która nie istnieje — `gap-14-lifecycle-autonomy-shadow.md` jest ostemplowany „Status: NOT STARTED", a dzisiejsza autonomia w orchestratorze jest **binarna** (auto-approve vs. człowiek), bramkowana polityką tenanta z pułapem ryzyka `low|medium|high`.

**P4. Co jest jednostką wartości dla kupującego?**
→ Nie zaoszczędzony czas developera, tylko **przewidywalność i audytowalność**. Wynika to z P1 i z tego, że §33 (Human Release Gate) pokazuje przed decyzją: specyfikację, preview, raport testów, raport bezpieczeństwa, podsumowanie zmian, koszt AI i nierozwiązane ryzyka.
→ **Konsekwencja dla demo:** pokazywać łańcuch traceability i koszt, a nie „patrzcie, AI napisało kod". Sam kod nikogo nie przekona — łańcuch od wymagania do wdrożenia przekona.

**P5. Dlaczego akurat Open Mercato jako host?**
→ **Bo daje za darmo ~70% infrastruktury governance** — i to jest realne uzasadnienie, którego w spec nie ma. Konkretnie: silnik DAG z trwałymi bramkami ludzkimi, `AgentProposal` z dyspozycją i polityką auto-akceptacji fail-closed, guardrails, ślady OTel-GenAI, context bundles, tożsamość agentów z odwoływalnymi grantami, audit log z wzorca komend, telemetria tokenów i kosztów per run, kolejki, SSE, notyfikacje, webhooki, attachments + S3, 18 stron cockpitu.
→ **Rekomendacja:** dopisać tę odpowiedź do spec. Dziś dokument nie broni swojego najważniejszego wyboru architektonicznego, przez co wygląda na arbitralny.

**P6. Czym dokładnie jest Cezar w tym podziale?**
→ **Dziś: lokalnym narzędziem deweloperskim.** README: „Local, zero config, no accounts", stan w plikach, bez bazy, cockpit na localhost. Spec traktuje go jak serwerowy, wielotenantowy execution engine — to **nie jest to samo narzędzie**.
→ **Odpowiedź, która działa:** Cezar jako **pull worker / BYO compute** po stronie klienta. To zachowuje jego model local-first (nie wymaga tenancy ani auth po jego stronie), a jednocześnie jest **jednym z trzech transportów już zaprojektowanych** w `next/2026-06-19-agent-dispatch.md`. Alternatywa (userwerowienie Cezara) to osobny projekt o nieoszacowanym rozmiarze.

**P7. Co się dzieje, gdy agent się pomyli i to trafi na produkcję?**
→ **Odpowiedź jest częściowa.** §33 ma Human Release Gate, §31 przewiduje osobną bramkę na produkcję, §30 pozwala blokować release wg severity. Ale **nie ma** modelu odpowiedzialności, rollbacku, incident response ani ścieżki wycofania wdrożenia. §49 wymienia „production monitoring i self-healing incident workflow" jako poza MVP — co jest uczciwe, ale zostawia lukę w opowieści sprzedażowej („kto odpowiada, jak się wywali?").

**P8. Czy demo ma przekonać technicznie czy biznesowo?**
→ **Biznesowo.** §48 mówi wprost: *„Demo ma być zrozumiałe bez tłumaczenia wewnętrznej architektury: brief lub design wchodzi z jednej strony, działający system wychodzi z drugiej."*
→ **Konsekwencja:** przekrojenie zakresu powinno optymalizować **spójność narracji**, nie pokrycie funkcji. Jedna ścieżka przejechana do końca bije dwie ścieżki urwane w połowie. To bezpośrednio uzasadnia rekomendację 2 poniżej.

---

## 5. Co jest tańsze, niż wygląda

Dla równowagi — rzeczy, które spec traktuje jak pracę do wykonania, a które są gotowe lub prawie gotowe:

- **Bramki ludzkie (§38)** — `UserTask` + `WAIT_FOR_SIGNAL` + `AgentProposal` z dyspozycją. Luka bliska zera, wystarczy cienka projekcja typu bramki.
- **Kontrakty agentów (§43)** — `defineAgent` + `OUTCOME.md` + `allowedTools` + `mutationPolicy` + `requiredFeatures` + `loop.*`. Dopasowanie niemal dokładne.
- **Context Package (§22)** — `AgentContextBundle` istnieje jako encja z routingiem źródeł, budżetem i redakcją. Trzeba go rozszerzyć o zakres repo i wystawić na zewnątrz, nie wymyślać.
- **Audit log (§35), telemetria (§45), notyfikacje, webhooki, kolejki, progres, SSE** — luka zerowa. (Uwaga: telemetria **nie** obejmuje kosztów — patrz R-29.)
- **Dashboard live (§34)** — DOM Event Bridge gotowy; cockpit agentów to 18 stron, które trzeba obudować zakresem projektu, nie pisać od zera.
- **Składowanie renderów designu** — `attachments` (polimorficzny `entity_id`+`record_id`) + `storage-s3` + route obrazkowy z on-the-fly resize i cache thumbnaili. Dni, nie tygodnie. **Najtańszy element całego toru designu.**
- **Tożsamość zewnętrznego executora** — ID-JAG / RFC 7523 gotowe; Cezar po prostu się rejestruje.
- **Raportowanie zwrotne** — `/trace/ingest` podpisany HMAC, idempotentny, przyjmuje dowolny `runtime`, tokeny, `costMinor`, spany, tool calls. Istnieje działający klient referencyjny (`scripts/agent-trace-ingest-demo.ts`).
- **Ogon domenowy** — custom entities (`ce.ts`) dają generyczny CRUD UI, ACL per encję i pola `relation` za **~10–30 LOC na encję, zero migracji, zero stron, zero walidatorów**.

---

## 6. Rekomendacje — przekrojenie zakresu

Uszeregowane wg stosunku wpływu do kosztu.

**1. Jeden moduł, nie sześć.** `delivery_os` w `packages/enterprise`. Relacje ORM wewnątrz modułu są w pełni legalne → graf traceability staje się zwykłym SQL-em zamiast tabeli krawędzi z podwójnymi indeksami i subscriberami inwalidującymi. **To jedna decyzja, podjęta przed pierwszą linią kodu, warta więcej niż jakakolwiek optymalizacja później.** (R-04, R-05)

**2. Jedno entry point na hackathon: `FROM_BRIEF`.** `FROM_DESIGN` zredukować do read-only importu ekranów (bez DS extraction, bez reverse spec) albo wyciąć z demo całkowicie. Uzasadnienie w P8: demo ma być zrozumiałe biznesowo, a jedna ścieżka przejechana do końca bije dwie urwane. (R-33, R-21)

**3. Wyciąć Visual QA w wersji „Figma ↔ screenshot".** Zastąpić: asercje implementacji wobec tokenów DS i tożsamości komponentów (`storybook-*-checks.mjs` robi to dziś przez computed styles) + baseline DOM-vs-DOM. Screenshot zostaje jako dowód dla człowieka na ekranie review, nie jako automatyczna bramka. (R-18, R-19)

**4. Zaimplementować Fazę 1 `next/2026-06-19-agent-dispatch.md` zamiast wymyślać integrację Cezara.** `AgentTask` jako trwałe źródło prawdy + pull worker. Cezar podłącza się jako BYO compute, zachowując swój model local-first. (R-02, R-12)
→ **Na hackathon jest tańszy skrót:** sprawić, by Cezar mówił trzyczasownikowym kształtem `OpenCodeRunnerClient`, i przerejestrować `openCodeClient` w DI. Zero zmian w orchestratorze, działający spike w godzinach zamiast dni. Ograniczenie: dziedziczy synchroniczny, 5-minutowy kształt runa (R-41), więc nadaje się do demo jednego zadania, nie do produkcji. (R-40)

**5. Zbudować most `/trace/ingest` → proposal → wznowienie workflow.** Najtańsza z krytycznych luk, a bez niej **nic nie wraca do procesu** i demo się nie domyka. (R-03)

**6. Custom entities dla ogona domenowego.** Prawdziwe encje ORM tylko dla hot path: `Project`, `Requirement`, `Screen`/`DesignVersion`, `Task`, `TraceEdge`, `Deployment`. Reszta (Question, Assumption, Risk, ADR, DesignToken, DesignComponent, VisualComment, SecurityFinding, ReviewFinding, Blocker, TargetPlatform, AgentRole) przez `ce.ts`. Redukcja z ~875 plików do ~250–300. (R-08)

**7. Zdefiniować lifecycle zadania; stan projektu jako agregat wyliczany.** Wzorzec już w platformie: `ProcessInstance.status` jest wyprowadzany z `WorkflowInstance` i nigdy niezależnie przestawiany. (R-34)

**8. Budżet kosztowy jako wymóg P0 — i uwaga, to większa robota, niż wygląda.** Minimum na hackathon: pre-flight check przed dispatchem (odmowa startu powyżej progu) liczony z płaszczyzny A (`agent_runs.cost_minor`), świadomie ignorując płaszczyznę B. Autonomiczna pętla korekcyjna bez tego jest nieograniczona wydatkowo. Przy okazji naprawić R-28 (`BudgetEnforcer` nieaktywny w trybie `object`) — inaczej limity, które wyglądają na istniejące, nie działają. Pełne §36 (koszt per etap, uzgodnienie płaszczyzn, waluty, tabela cen) to osobna budowa na fazę po hackathonie. (R-27, R-28, R-29)

**9. Rozstrzygnąć kierunek prawdy dla designu, jawnie i na piśmie.** Figma-as-truth **wyłącznie** dla DS projektu klienta; kod-as-truth dla DS platformy. Bez tego zapisu anti-drift tooling zostanie po cichu zanegowany. (R-14)

**10. Obiektywne bramki przed reviewem LLM.** Build, lint, testy, kontrola typów jako twarda bramka; reviewer LLM tylko na tym, czego automat nie sprawdzi. Osobny, wąski krok walidujący, że test faktycznie testuje AC — inny prompt, najlepiej inny model. (R-22, R-24)

**11. Dopisać do spec uzasadnienie wyboru Open Mercato** (odpowiedź P5) i **jawną granicę odpowiedzialności OM ↔ Cezar** (odpowiedź P6). Dokument nie broni dziś swojego najważniejszego wyboru architektonicznego.

**12. Wyprostować oczekiwania wobec bramek ludzkich.** `signalConfig.timeout` i `SIGNAL_TIMEOUT` nie mają konsumenta → bramka bez odpowiedzi wisi w nieskończoność. Albo dopiąć driver eskalacji (`UserTask` ma już `dueDate`/`escalatedAt`/`ESCALATED`), albo jawnie przyjąć, że na hackathonie człowiek jest zawsze obecny. (R-11)

---

## 7. Code References

**Orchestrator i bramki**
- `packages/enterprise/src/modules/agent_orchestrator/lib/identity/agentNoBypassSubscriber.ts:53-67` — backstop propose-only na flush ORM
- `.../lib/sdk/defineAgent.ts:486-506` — odrzucenie agenta z narzędziem mutującym
- `.../lib/sdk/defineFileAgent.ts:333,355` — `write/edit/bash/task: deny` w generowanym pliku agenta
- `.../lib/runtime/executeProposal.ts:41-43,52-66` — efektor bez wywołań w module
- `.../lib/disposition/autoApprovalPolicy.ts:127-157` — polityka auto-akceptacji fail-closed
- `.../data/entities.ts:11` — `AgentRunStatus` z martwym `cancelled`; `:142-258` — telemetria kosztów; `:1171` — `AgentContextBundle`
- `.../lib/featureFlags.ts:17-22` — flaga preview UI (domyślnie off)
- `packages/core/src/modules/workflows/data/entities.ts:17-30` — 12 typów kroków; `:717-859` — `UserTask`
- `packages/core/src/modules/workflows/lib/parallel-handler.ts:1-20` — „single lock, no thread-level concurrency"
- `packages/core/src/modules/workflows/data/activity-config-schemas.ts:153-189` — payload `INVOKE_AGENT` bez repo/brancha/limitów

**Runtime i budżety**
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts:2303-2313` — brak `BudgetEnforcer` w trybie `object`; `:457-458,:497-498` — `TODO` na override'ach pętli
- `packages/ai-assistant/.../lib/ai-agent-definition.ts:309-438` — `AiAgentDefinition`
- `.../lib/runtime/nativeAgentRunner.ts:52` — budżet kontekstu zaszyty na 4000 tokenów
- `.../lib/runtime/admission.ts:67-73` — limity współbieżności (process-local)
- `.../lib/runtime/agentRuntime.ts:63-77` — zahardkodowany `if` zamiast rejestru runnerów
- `.../lib/sdk/defineAgent.ts:36` — unia `AgentRuntime` z nieaktywnym `'external'`
- `.../lib/runtime/openCodeAgentRunner.ts:583-660` — wykrywanie zakończenia: poll + SSE idle + jedna zachęta + fail-closed
- `packages/ai-assistant/.../data/entities.ts:406-472` — `AiTokenUsageEvent` (tokeny bez kolumny kosztu)
- `packages/ai-assistant/.../lib/token-usage-recorder.ts:39` — niezbudowany punkt rozszerzenia „cost dashboards"
- `.../agent_orchestrator/AGENTS.md:178` — „Ask First" na kontrakcie HMAC ingestu i `/identity/*`

**Graf i model danych**
- `packages/shared/src/lib/query/types.ts:193-195` — jedna encja na zapytanie
- `packages/shared/src/lib/query/join-utils.ts:366-369` — joins bez projekcji
- `packages/shared/src/lib/query/engine.ts:1176-1200` — `defineLink` runtime-dead
- `packages/documents/src/modules/documents/data/entities.ts:453-618` — koszt dwukierunkowych linków (7 kolumn, 14 indeksów)
- `packages/shared/src/modules/entities.ts:115-131` — `CustomEntitySpec` (furtka na ogon domenowy)
- `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts:30-65` — kuratorowany rejestr encji

**Design i Figma**
- `scripts/ds-tokens-export.mjs:15-17,447-470` — kierunek prawdy + jedyny klient HTTP Figmy (write-only)
- `.ai/ds/README.md:31-36` — „code pushes, Figma mirrors"
- `.ai/qa/tests/playwright.config.ts:76` — screenshoty jako artefakty, nie porównanie
- `.ai/mockups/time-tracking/prototype.js:152-181` — kotwice po ścieżce DOM w statycznym HTML
- `packages/core/src/modules/attachments/data/entities.ts:58-61` — polimorficzne załączniki (gotowe pod rendery)

**Cezar**
- `.gitignore:163-167` — stan lokalny + launch key
- `.ai/qa/tests/playwright.config.ts:19-24` — worktree'y `.ai/cezar/worktrees/<id>/` z własnym `node_modules`
- `.ai/runs/2026-08-06-harness-assert-module-facts-required/HANDOFF.md:27-28` — branch `cez/<uuid8>`
- README projektu (github.com/open-mercato/cezar) — „Local, zero config, no accounts"

**Specy do wykorzystania zamiast pisania nowych**
- `.ai/specs/enterprise/agent-orchestrator/next/2026-06-19-agent-dispatch.md` — `AgentTask`, leases, pull workers, A2A push
- `.ai/specs/enterprise/agent-orchestrator/next/gap-analysis/gap-14-lifecycle-autonomy-shadow.md` — drabina autonomii (NOT STARTED)
- `.ai/specs/2026-07-07-ds-theme-from-figma-brand-import.md` — DS z Figmy (Draft, z uczciwą oceną granic automatyzacji)
- `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` — referencja as-built

---

## 8. Pytania otwarte

1. **Czy Cezar ma zostać userwerowiony, czy działać jako pull worker po stronie klienta?** Od tego zależy, czy integracja to tygodnie czy osobny projekt. (R-12)
2. **Gdzie przebiega granica OSS ↔ enterprise?** Czy `delivery_os` ma sens jako narzędzie do specyfikacji i planowania **bez** agentów (wariant hybrydowy)? (R-06)
3. **Czy ścieżka `FROM_BRIEF` akceptuje człowieka z otwartą Figmą w pętli?** Jeśli nie, trzeba przeprojektować, gdzie powstaje design. (R-16)
4. **Jaki jest próg budżetu, przy którym system odmawia startu?** I czy kontrola mid-flight jest w zakresie, czy tylko pre-flight? (R-27)
5. **Kto odpowiada za błąd, który przeszedł przez wszystkie bramki?** Brak modelu odpowiedzialności osłabia opowieść sprzedażową. (P7)
6. **Czy projekt ma się zsynchronizować z roadmapą `next/` modułu `agent_orchestrator`, czy iść obok?** Idąc obok, dubluje się pracę nad dispatchem i autonomią. (R-37)
7. **Jaka jest polityka retencji artefaktów?** Rendery designu, screenshoty i payloady trace'ów to dużo blobów per projekt.
8. **Czy wchodzimy w rejestr runnerów, czy zostajemy przy adapterze transportu?** Pierwsze to kontrakt do utrzymania i zmiana w module enterprise; drugie to szybki spike z odziedziczonym 5-minutowym limitem runa. (R-40, R-41)
9. **Gdzie mieszkają poświadczenia do repo i CI klienta?** Jeśli na maszynie Cezara, to sekrety wielu klientów lądują w plikach na jednym hoście bez modelu tenancy. (R-31)
