# Kolejna runda — po przeglądzie nocnych branchy, 2026-09-19

Plan pracy integracyjnej: przegląd trzech branchy → scalenie w izolowanym worktree → poprawki i kontrole kontraktów → lekkie kontrole → push do main (bez buildów i pełnego gate OM na polecenie użytkownika). Osobny [raport integracji](../overnight-integration-2026-09-19.md) zapisuje faktyczny wynik publikacji i testów.

## Co jest już w kodzie

| Strumień | Przeglądany head | Rezultat | Granica ukończenia |
|---|---|---|---|
| OSS / Mateusz | `dev-mateusz` — `124828233` | Kontrakty v1, encje, scoped API, baseline/decisions/proposals, reserve/claim/link/result/cancel/reconcile/evidence | Review evidence i przejścia verified/changes_requested są dostępne; report i decyzje publikacji pozostają do zrobienia |
| UI / Adam | `feature/design-ui` — `8cd49117c` | Readiness, skrypty Figmy i dołączony podczas integracji ekran szczegółów z hostem execution | Dowody write/update/read zapisane; utrzymać OAuth na demo, lista projektów i baseline UI pozostają do zrobienia |
| WP / Michał | `feat/wp-m01-studio-tools` — `2018cf295` | Samodzielne narzędzia Studio, scoped ownership, snapshot SQLite/motywu, lokalne evidence | Raport CLI nie jest manifestem OSS; brak hosta OM→WP→OM |
| EXEC / Marcin | `main` — `54e8f0482` | Raport udanego probe CLI Cezara i konfiguracja async/Redis | Brak dowodu efektywnej concurrency workera; provider/bridge do zrobienia |

Nie obejmujemy aktualizacji Dependabota: nie należą do integracji funkcji hackathonu. Nazwiska/role wynikają z autorów commitów i bieżących workstreamów; nie tworzymy nowych Issues ani etykiet.

## Najbliższe zadania czterech osób

| Osoba | Teraz, równolegle | Następnie | Kryterium przekazania |
|---|---|---|---|
| **Mateusz — OSS** | Przekazać ukończone review evidence i przejścia verified/changes_requested do EXEC/UI | R22 report, R20 deploy-decisions i R21 release-decisions | result → review → verified odblokowuje zależne zadanie; cancel → potwierdzone stop → nowa próba; testy odmów i duplikatów |
| **Marcin — EXEC** | Potwierdzić start workera async, rzeczywisty log budżetu i ≥2; zbudować EXEC-02 provider Cezara oraz szkielet enterprise | EXEC-04: rezerwacja/claim, WAIT_FOR_SIGNAL przed enqueue, idempotentny import, recovery/resume | Jeden prawdziwy TaskPackage → wykonanie → ResultManifest → awaiting_review; następnie dwa niezależne runy i restart bez ponownego spawn |
| **Adam — UI** | Utrzymać OAuth na stanowisku demo i zapisane dowody Figmy; wdrożyć UI-02 lista projektów i rozbudowa gotowego ekranu szczegółów na API OSS | UI-03 baseline/proposals/decisions; rozwinąć host delivery_os.project.execution; UI-04 execution/manual handoff z enterprise | Dwa odmienne rendery tego samego nodeId przechodzą verifier; oba wejścia prowadzą do baseline zatwierdzonego przez człowieka; brak udawanych stanów verified |
| **Michał — QA + WP** | Przy kolejnym odbiorze funkcjonalnym wykonać scoped API integration: ACL, tenant/org mismatch, duplicate, stale baseline, lock conflicts; utrzymać narzędzia WP | WP-M02 po gotowym hoście: świeża próba, base/result snapshot, rzeczywiste kontrole profilu i import do OSS; następnie QA obu flow | Skorelowany OM→WP→OM z dowodami bieżącej próby, fixture nigdy nie liczy się jako live; osobno oględziny witryny i AC; respektować wspólny limit 6 h WP |

## Jak połączyć funkcje

1. **UI → OSS:** projekt, proposals, zatwierdzenie requirements/design/baseline i task plan korzystają z istniejących scoped API `delivery_os`. UI nie przejmuje logiki domenowej ani nie zapisuje bezpośrednio encji.
2. **OSS → EXEC:** zarezerwowany TaskPackage v1 jest wejściem wykonawcy. Enterprise dodaje provider i widget wykonania; OSS pozostaje działające bez enterprise. Kontrakty i fixture są w `packages/core/src/modules/delivery_os/lib/`.
3. **EXEC → OSS:** zaufany wykonawca przekazuje powiązany ResultManifest z prawdziwymi hashami, checkami i rewizją. Import kończy na awaiting_review. Review i decyzja człowieka dopiero potem prowadzą do verified.
4. **EXEC → WP:** `@open-mercato/delivery-wordpress` zapewnia create/status/start/stop/captureSnapshot. Nowa próba istniejącego projektu używa istniejącego scoped handle. Host koreluje project/task/attempt/baseline/version i zbiera pełne ResultCheck — nie uzupełnia brakujących dowodów fikcyjnymi PASS.
5. **WP → OSS:** snapshot pasuje do SourceRevision dla wordpress-theme@1. Raport CLI oraz ToolCheck nie pasują do manifestu i dowodów AC; test kontraktowy utrwala tę granicę. Adapter wymaga hosta i prawdziwego wykonania kontroli.
6. **QA → odbiór:** testy dotyczą wspólnej końcowej rewizji. Publikacja preview i release pozostają oddzielnymi decyzjami człowieka związanymi z tą rewizją.

## Kolejność wspólnych odbiorów

- Najpierw: API OSS + UI projektów/baseline + provider EXEC na tej samej wersji kontraktów.
- Potem: jeden pionowy run → review → verified; dopiero następnie dwa równoległe runy i cancel/reconcile.
- WP PoC może działać równolegle do React po gotowym hoście i zatwierdzonym pakiecie.
- Na końcu: test finalnej rewizji, report UI/API, zgoda publikacji, preview i osobna zgoda release.

Źródła: [drzewo zależności](task-tree.md), [OSS](01-oss-domain.md), [EXEC](02-execution.md), [UI](03-design-ui.md), [QA](04-quality-preview.md), [WP](05-wordpress-michal.md), [readiness](../../../../hackathon/delivery-demo/readiness.md).
