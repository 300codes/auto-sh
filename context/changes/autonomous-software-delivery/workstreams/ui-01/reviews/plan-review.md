<!-- PLAN-REVIEW-REPORT -->
# Plan Review: UI-01 — Potwierdzić agentowy zapis w Figmie

- **Plan**: [`workstreams/ui-01/plan.md`](../plan.md)
- **Mode**: Deep
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND po triage
- **Findings**: 1 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

6/6 ścieżek ✓ (`package.json:100-102`, `docs/design-system/testing-designer.md:218`, `docs/design-system/figma-audit/`, brak `hackathon/delivery-demo/`, brak `.mcp.json`, `~/.codex/config.toml` bez MCP), `claude mcp list` = Claude Docs + Gmail ✓, dokumentacja Figmy zweryfikowana na żywo ✓ (`use_figma`, Full seat, Claude Code + Codex, warianty remote/desktop, `whoami`/`create_new_file` zwolnione z rate limitów), brief↔plan ✓, Progress↔Phase mechanicznie spójny ✓.

## Findings

### F1 — Brak taniej próby wstępnej przed 45 min konfiguracji i przed zakupem

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Blind Spots
- **Location**: Warunki startu + Phase 1 / Critical Implementation Details
- **Detail**: Plan weryfikował seat ręcznie w interfejsie Figmy, ale zapis idzie przez tożsamość OAuth serwera MCP — przeglądarka i klient MCP mogą być zalogowane na różne konta. `whoami` (zwolniony z rate limitów) odpowiada na to maszynowo i nie był użyty. Dodatkowo tabela dostępu Figmy wymienia plan Starter w wierszu Dev/Full seat, więc upgrade do Professional jako twardy warunek przed H0 może być zbędny. Pierwszy sygnał „czy zapis działa" padał ok. H1 zamiast ok. H0:10 — po wydaniu pieniędzy i zużyciu dostępności osoby decyzyjnej.
- **Fix ⭐ Recommended**: Krok 0 Fazy 1 (~10 min): jeden klient, `whoami` + `create_new_file` na koncie demo, zapis zwróconej tożsamości/seat/planu jako faktu maszynowego; dopiero potem decyzja o upgrade i drugi klient.
  - Strength: Zamyka lukę tożsamości (przeglądarka ≠ MCP OAuth), daje rozstrzygnięcie ~50 min wcześniej, nie zużywa budżetu wywołań.
  - Tradeoff: Jeśli seat faktycznie trzeba dokupić, krok 0 dokłada ~10 min do ciasnego okna.
  - Confidence: HIGH — oba narzędzia potwierdzone jako rate-limit-exempt w dokumentacji Figmy (sprawdzone 2026-09-19).
  - Blind spot: Nie zweryfikowano, czy Starter + Full seat przepuszcza `use_figma` — krok 0 właśnie to rozstrzyga empirycznie.
- **Decision**: FIXED (Fix ⭐)

### F2 — Faza 1 wymaga obu klientów przed próbą, Faza 2 wymaga jednego

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Lean Execution
- **Location**: Phase 1 → Success Criteria vs Phase 2 → Sekwencja agentowa
- **Detail**: Kryterium Fazy 1 żądało, żeby oba klienty listowały narzędzie zapisu przed przejściem dalej, a Faza 2 mówiła „wystarczy, że dowód przechodzi na jednym". Bramka ostrzejsza niż dowód wpychała konfigurację Codexa (niezweryfikowana obsługa remote MCP z OAuth) na ścieżkę krytyczną w 45-minutowym oknie. Uzasadnienie „druga ścieżka do tego samego API" nie chroni przed dominującym trybem awarii — odmową na poziomie seat, która dotknie obu klientów identycznie.
- **Fix ⭐ Recommended**: Bramką Fazy 2 jest wyłącznie klient podstawowy; drugi konfigurowany po próbie zapisu, jego wynik jako kryterium Fazy 3 (`ok` / `failed` / `not_attempted`).
  - Strength: Skraca drogę do rozstrzygnięcia FROM_BRIEF; niezweryfikowana obsługa OAuth w Codexie schodzi ze ścieżki krytycznej.
  - Tradeoff: Wada konfiguracji klienta podstawowego ujawni się dopiero przy próbie zapisu — ale krok 0 daje wtedy sygnał w kilka minut.
  - Confidence: HIGH — sprzeczność wewnątrz dokumentu; założenie o Codexie potwierdzone jako niezweryfikowane w repo.
  - Blind spot: Nie sprawdzono, czy zainstalowana wersja Codex CLI obsługuje zdalne serwery MCP z OAuth.
- **Decision**: FIXED (Fix ⭐)

### F3 — Kryteria automatyczne bez wykonywalnych komend

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: Desired End State + Success Criteria Faz 1–3
- **Detail**: „`sha256sum -c` na manifeście" — manifest to JSON, `sha256sum -c` go nie skonsumuje, a plan nie przewidywał pliku sum. „Skan wzorców sekretów" powtarzał się w trzech fazach, a w `package.json` nie ma żadnego skryptu secret/gitleaks/trufflehog (sprawdzone). „Niepusty PNG" bez nazwanej kontroli.
- **Fix**: Emitować `evidence/figma/SHA256SUMS` obok manifestu i wpisać konkretne komendy: `sha256sum -c SHA256SUMS`, `file evidence/figma/*.png`, `git grep -nIE '(figd_|figu_|Bearer |access_token|refresh_token|client_secret)' -- hackathon/delivery-demo`.
- **Decision**: FIXED

### F4 — Lokalna numeracja Progress koliduje z numeracją planu głównego

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: Overview + `## Progress`
- **Detail**: Overview mówi „Zadanie zalicza Progress 1.2 i 1.4" — to pozycje planu głównego (`plan.md:545,551`). Lokalny Progress ma własne 1.2 i 1.4 o innym znaczeniu. Te same etykiety, dwa pliki edytowane równolegle — dokładnie ta pomyłka, przed którą ostrzega nagłówek sekcji Progress.
- **Fix**: Ponumerować kroki lokalne rozłącznie (`U1.1`, `U1.2`, …) i przy każdym odwołaniu dopisać „planu głównego".
- **Decision**: SKIPPED — ryzyko pozostaje otwarte; istotne dla osoby zaznaczającej wynik w Progress planu głównego.

### F5 — Eskalacja o H3 nie ma zdefiniowanego zbioru opcji

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Blind Spots
- **Location**: Phase 3 → Domknięcie artefaktu + tabela Ryzyk
- **Detail**: Przy statusie `blocked` plan wymagał eskalacji przed H3 i zakazywał ręcznego designu jako zastępstwa — słusznie — ale nie nazywał żadnej opcji do rozważenia. Bramka H3 dostawała problem, nie wybór, w momencie gdy cztery strumienie raportują readiness, a od odpowiedzi zależy 7 h UI-03 (H6–H15).
- **Fix ⭐ Recommended**: Tabela wariantów z właścicielem decyzji: inne konto/zespół Figma z potwierdzonym Full seat, wariant desktop serwera MCP, drugi klient jako podstawowy, uznanie FROM_BRIEF za niezaliczone i przesunięcie okna UI-03 na FROM_DESIGN / UI-04.
  - Strength: Zamienia bramkę H3 z odkrycia w wybór; kosztuje akapit napisany na spokojnie zamiast pod presją.
  - Tradeoff: Wariant przesunięcia okna trzeba nazwać wcześnie, co może wyglądać jak przedwczesne dopuszczenie porażki.
  - Confidence: HIGH — brak listy opcji był wprost widoczny w dokumencie.
  - Blind spot: Nie wiadomo, czy zespół ma dostęp do drugiego konta Figma.
- **Decision**: FIXED (Fix ⭐)

### F6 — Binarne ready/blocked zaciera stan „zapis działa, edycja nie"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: End-State Alignment
- **Location**: Desired End State + Phase 3 → wpis w `readiness.md`
- **Detail**: Kryterium 1.2 planu głównego wymaga create + odczytu ID/renderu. UI-01 świadomie podnosi poprzeczkę do create→read→update→read (słusznie — UI-03 potrzebuje realnej poprawki). Skutek uboczny: create OK + update failed dawało `blocked`, choć 1.2 planu głównego byłoby spełnione, a zagrożona jest tylko pętla poprawek.
- **Fix**: Rozdzielić status na `write` (ready/blocked) i `update` (ready/blocked), oba w artefakcie i w linii w `readiness.md`.
- **Decision**: FIXED

### F7 — Istniejące prior art dla próby headless nie jest przywołane

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 → Próba w procesie nieinteraktywnym
- **Detail**: `research.md` (wiersz „Import ekranów Figmy") dokumentuje moduł Figmy orchestratora WP (`src/server/modules/figma/service.js:156,218`) uruchamiający Claude CLI z narzędziami read Figma MCP z procesu serwera — najbliższy istniejący dowód dotyczący ścieżki badanej w Fazie 3. Kod nie jest dostępny z tego stanowiska (sprawdzone), a Michał prowadzi WP-M01 w tym samym oknie.
- **Fix**: Jedno zdanie odsyłające do tego wzorca wywołania jako punktu startu przy awarii konfiguracji, z zastrzeżeniem, że to prośba o wzorzec, nie zależność.
- **Decision**: FIXED

## Triage Summary

| Wynik | Findings |
|---|---|
| FIXED | F1, F2, F3, F5, F6, F7 |
| SKIPPED | F4 |

Po poprawkach spójność Progress↔kryteria przeliczona: 5/6/7 pozycji na fazę, dokładnie tyle co bulletów Success Criteria, brak checkboxów poza sekcją Progress. Verdykt po triage: **SOUND**.
