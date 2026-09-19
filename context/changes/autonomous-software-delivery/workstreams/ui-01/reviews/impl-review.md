<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UI-01 — Potwierdzić agentowy zapis w Figmie

- **Plan**: `context/changes/autonomous-software-delivery/workstreams/ui-01/plan.md`
- **Scope**: Fazy 1–3 (całość planu; żadna faza nie jest w Progress kompletna)
- **Commits**: `d669e82732`, `d7834d82b7`, `dcadbf3e6b`, `c9e31d3e86`
- **Date**: 2026-09-19
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 3 warnings, 1 observation
- **Auto-fixed in this review**: F1, F2, F3

## Kontekst wyniku

Zadanie utknęło na blokerze zewnętrznym: zdalny serwer Figma MCP jest w stanie
`Needs authentication`, a autoryzacja OAuth jest interaktywna. Wdrożenie **poprawnie** nie
przeszło do Fazy 2 (Implementation Note Fazy 1) i **poprawnie** zapisało blocker zamiast go
ukryć — Progress 1.1, 1.4, 2.1–2.6 pozostają odznaczone. To jest właściwe zachowanie i nie jest
przedmiotem żadnego findingu poniżej. Findingi dotyczą tego, co zostało dostarczone **wokół**
blokera: dwóch błędów w skryptach dowodowych, fałszywej proweniencji w Progress oraz zakresu
Fazy 2.

## Verdicts

| Dimension | Verdict | Uwaga |
|-----------|---------|-------|
| Plan Adherence | WARNING | Fazy 1–2 niedostarczone (bloker zewnętrzny, uczciwie zapisany); Faza 3 zgodna z planem |
| Scope Discipline | WARNING | F4 (318 linii nieplanowanych narzędzi), F5 (`readiness.md`) |
| Safety & Quality | FAIL → PASS po naprawie | F1 (utrata dowodu), F2 (fałszywe przejście skanu sekretów) — oba naprawione |
| Architecture | PASS | Brak `.mcp.json` w repo, konfiguracja poza repo, brak zależności krzyżowych |
| Pattern Consistency | PASS | Oba skrypty spójne wewnętrznie; brak rodzeństwa do porównania |
| Success Criteria | WARNING | Faza 3 spełniona i zweryfikowana; Fazy 1–2 niespełnione i tak oznaczone |

### Zweryfikowane kryteria automatyczne (stan HEAD)

| Kryterium | Wynik |
|---|---|
| 1.2 `figma-readiness.md` i `evidence/figma/` istnieją, pola wypełnione | ✅ |
| 1.3 / 3.4 `git grep` po wzorcach sekretów w `hackathon/delivery-demo` | ✅ brak trafień |
| 1.1 Krok 0 (`whoami`, `create_new_file`) | ❌ niewykonany — bloker OAuth (zapisany) |
| 1.4 Klient podstawowy listuje narzędzie zapisu | ❌ serwer nie publikuje listy (zapisane) |
| 2.1–2.4 manifest, `sha256sum -c`, PNG, różnica hashy | ❌ `verify.sh` → 3 kontrole nie przeszły (brak manifestu i renderów) |
| 3.1 statusy `write`/`update` + sekcja headless | ✅ |
| 3.2 jedna linia w `readiness.md` z działającym odnośnikiem | ✅ link rozwiązuje się |
| 3.3 wynik drugiego klienta jako osobny fakt | ✅ `not_attempted` |
| Wszystkie odnośniki względne w artefaktach | ✅ 6/6 rozwiązuje się |

## Findings

### F1 — `capture.sh` przerywa się i traci pobrany render, gdy `claude` nie jest w PATH

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (utrata danych)
- **Location**: `hackathon/delivery-demo/evidence/figma/capture.sh:64` (przed naprawą)
- **Detail**: Skrypt działa pod `set -euo pipefail`. Przypisanie
  `client_version=$(claude --version 2>/dev/null | awk '{print $1}')` zwraca kod wyjścia potoku,
  a `pipefail` propaguje 127 z brakującego `claude`. Pod `set -e` przypisanie kończy skrypt.
  Zreprodukowane: `env PATH=/usr/bin:/bin bash capture.sh …` → `exit=127`.
  Punkt przerwania leży **po** pobraniu renderu (linia 41), a **przed** zapisem do
  `manifest.json` (linia 69). W katalogu zostaje osierocony PNG, w manifeście nie ma nic,
  a adres renderu Figmy w międzyczasie wygasa — dowód jest nieodtwarzalny bez powtórzenia
  całej sekwencji w Figmie. To uderza dokładnie w rację istnienia tego skryptu
  („pobranie, hash i wpis do manifestu muszą nastąpić w jednym kroku"). Ścieżka jest realna:
  plan wymienia `codex-cli` jako dopuszczalną wartość `client.name`, a na stanowisku bez
  Claude Code `claude` w PATH nie będzie.
- **Fix**: Dopiąć `|| true` — wersja klienta jest polem opisowym, nie warunkiem zapisu.
  - Strength: Usuwa klasę „utrata dowodu przez pole kosmetyczne"; manifest zapisuje się
    z `client.version` pominiętym (jq `keep()` już pomija puste pola).
  - Tradeoff: Brak — jedna linia, zero zmian w ścieżce pozytywnej.
  - Confidence: HIGH — zreprodukowane przed i po; test end-to-end z `MCP_CLIENT=codex-cli`
    i zdjętym PATH kończy się `exit=0` i poprawnym wpisem.
  - Blind spot: Brak istotnego.
- **Decision**: FIXED (auto) — dodatkowo `curl --remove-on-error`, żeby nieudane pobranie nie
  zostawiało obciętego pliku, oraz zamiana `ls -1 ./*.png | wc -l` na tablicę globa (ten sam
  wzorzec `set -e` + `pipefail`, ostatnia linia skryptu).

### F2 — `verify.sh` raportuje skan sekretów jako przechodzący, gdy sam skan się nie wykonał

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `hackathon/delivery-demo/evidence/figma/verify.sh:117` (przed naprawą)
- **Detail**: `if git grep … >/dev/null 2>&1; then fail; else ok; fi` rozróżnia tylko kod 0 od
  „reszty". `git grep` zwraca 0 przy trafieniu, 1 przy braku trafień i **≥2 przy błędzie**
  (zreprodukowane: 128 poza repozytorium). Każdy błąd skanu — zły `repo_root`, wywołanie spoza
  repo, brak ścieżki — jest raportowany jako „✓ brak wzorców sekretów". Kontrola higieny,
  której cała wartość polega na wyłapaniu wycieku tokena przed commitem, nie może mieć trybu
  cichego przejścia. Dodatkowo `repo_root=$(git rev-parse --show-toplevel)` bez `set -e`
  zostawia pusty `repo_root`, a `git -C ""` błądzi — prosto w tę samą ścieżkę.
- **Fix**: Rozgałęzić po kodzie wyjścia (`0` = trafienie → fail, `1` = czysto → ok, reszta →
  fail z kodem) i zgłosić pusty `repo_root` jako porażkę kontroli.
  - Strength: Nieudany skan wygląda jak porażka, nie jak przejście — jedyne bezpieczne
    zachowanie dla kontroli sekretów.
  - Tradeoff: Brak — ścieżka pozytywna w repo pozostaje `✓`.
  - Confidence: HIGH — trzy przypadki przetestowane: trafienie (`figd_…` → ✗), brak trafień
    (→ ✓), skan poza repo (→ ✗ „skan nie wykonał się").
  - Blind spot: Brak istotnego.
- **Decision**: FIXED (auto)

### F3 — Progress przypisuje trzem kryteriom commity, w których ich treść nie powstała

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Success Criteria
- **Location**: `context/changes/autonomous-software-delivery/workstreams/ui-01/plan.md:289,315,317`
- **Detail**: Cztery commity powstały w oknie 54 sekund (01:13:48–01:14:42), a artefakt
  `figma-readiness.md` został napisany w całości (119 linii, wraz z sekcją headless, eskalacją
  i odbiorem) w commicie Fazy 1 `d669e82732` i **nigdy potem nie zmieniony**
  (`git log -- figma-readiness.md` → jeden commit). Rozbicie na fazy jest więc retroaktywne, a
  trzy przypisy SHA są nieprawdziwe:
  - `1.2` („`figma-readiness.md` i `evidence/figma/` istnieją") wskazywało `d669e82732`, gdzie
    `evidence/figma/` **nie istniał** — katalog powstał w `d7834d82b7`.
  - `3.1` i `3.3` (treść w `figma-readiness.md`) wskazywały `dcadbf3e6b`, który tego pliku
    **nie dotknął** (zmienił tylko `readiness.md` i `plan.md`).

  Konwencja „` — <commit sha>`" istnieje po to, żeby kryterium dało się zweryfikować pod
  wskazanym SHA. W zadaniu, którego jedynym produktem jest audytowalny dowód, fałszywa
  proweniencja podważa wiarygodność pozostałych zapisów, także tych prawdziwych.
- **Fix**: Skorygować SHA na commity, w których treść faktycznie wylądowała
  (`1.2 → d7834d82b7`, `3.1 → d669e82732`, `3.3 → d669e82732`). `3.2` i `3.4` były poprawne.
  - Strength: Każdy przypis daje się teraz zweryfikować przez `git show <sha>`.
  - Tradeoff: Brak — korekta faktograficzna, żaden checkbox nie zmienia stanu.
  - Confidence: HIGH — ustalone z `git ls-tree` i `git show --stat` dla każdego commitu.
  - Blind spot: Sam fakt retroaktywnego rozbicia fazowego zostaje w historii; korekta czyni go
    czytelnym, nie usuwa.
- **Decision**: FIXED (auto)

### F4 — Faza 2 dostarczyła 318 linii nieplanowanych narzędzi zamiast któregokolwiek planowanego artefaktu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `hackathon/delivery-demo/evidence/figma/{capture.sh,verify.sh,prompts.md}`
- **Detail**: Plan wymienia dla Fazy 2 dokładnie trzy rzeczy: `manifest.json`, `SHA256SUMS`,
  `*.png` — a dla samej sekwencji „**brak zmian w repo**". Dostarczono zamiast tego trzy inne
  pliki (`capture.sh` 123 l., `verify.sh` 130 l., `prompts.md` 63 l.), żaden nieopisany w
  planie, i zero plików planowanych. Zamiana jest broniona w komunikacie commita i ma sens:
  bloker uniemożliwił sekwencję, narzędzia utrwalą jej wynik przy powtórce, `prompts.md`
  realizuje wprost kontrakt Fazy 2 („treść poleceń trafia do artefaktu, żeby UI-03 mogło je
  powtórzyć"), a listy „What We're NOT Doing" to nie narusza (skrypty to nie proxy, integracja
  zapisu ani edytor canvasu).

  Kosztem jest jednak ~320 linii kodu napisanych w trzygodzinnym timeboksie, którego twardy stop
  wypada o H3, na rzecz przyszłej pracy UI-03 — przy jednoczesnym nierozstrzygnięciu blokera
  OAuth, który wymagał jednego interaktywnego `/mcp`. Oba błędy F1 i F2 mieszkają właśnie w tym
  nieplanowanym kodzie: zakres, którego plan nie przewidział, nie dostał też przeglądu, jaki
  plan przewidywał dla zakresu planowanego.
- **Fix A ⭐ Recommended**: Dopisać do planu UI-01 aneks („Faza 2 — dostarczone zamiast") z
  uzasadnieniem podmiany i jawnym wskazaniem, że `manifest.json`/`SHA256SUMS`/`*.png` są nadal
  zaległe; przenieść same skrypty do zakresu UI-03 w README strumieni.
  - Strength: Zachowuje pracę, która realnie oszczędzi czas UI-03, i przywraca planowi rolę
    źródła prawdy zanim UI-03 zacznie czytać go jako kontrakt.
  - Tradeoff: Plan przestaje być zamrożony; wymaga jednej linii w README strumieni, żeby UI-03
    w ogóle wiedziało, że narzędzia istnieją.
  - Confidence: MEDIUM — zależy od tego, czy właściciel UI-03 przyjmie ten format manifestu
    bez zmian; skrypty nie były z nim konsultowane.
  - Blind spot: Nie sprawdzono, czy UI-03 nie ma już własnego pomysłu na format dowodu; plan
    główny (`plan.md:292`) wymaga bytes/hash, ale nie narzuca `capture.sh`.
- **Fix B**: Zostawić bez zmian i odnotować jako świadomy dług zakresowy w `figma-readiness.md`.
  - Strength: Zero dalszej pracy w oknie, które i tak jest zamknięte twardym stopem o H3.
  - Tradeoff: Plan UI-01 pozostaje rozjechany z repo; następny przegląd (albo UI-03) natrafi na
    trzy pliki bez umocowania i wyda ten sam finding od zera.
  - Confidence: HIGH — koszt zerowy, konsekwencja przewidywalna.
  - Blind spot: Brak istotnego.
- **Decision**: PENDING — wymaga decyzji (nie naprawione automatycznie)

### F5 — `readiness.md` utworzony z nagłówkiem, mimo kontraktu „nic poza tą jedną linią"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `hackathon/delivery-demo/readiness.md:1-3`
- **Detail**: Plan (Faza 3, punkt 2) mówi wprost: „Nie dopisywać do `readiness.md` niczego poza
  tą linią — plik należy do OSS-01/EXEC-01 i jest edytowany równolegle". Plik nie istniał, więc
  UI-01 go założyło, dodając tytuł i blockquote z regułą („Każdy strumień wnosi własną linię;
  nie edytować cudzych"). Komunikat commita to odnotowuje. Ryzyko jest realne, ale małe:
  OSS-01/EXEC-01 pracują w tym samym oknie i przy równoległym założeniu tego samego pliku
  dostaną konflikt na nagłówku, nie na linii statusu. Sama linia UI-01 jest dokładnie taka,
  jakiej plan wymaga — rozdzielone `write=blocked`, `update=blocked`, data, działający odnośnik.
- **Fix**: Zostawić. Usunięcie nagłówka dałoby plik bez kontekstu dla dwóch pozostałych
  strumieni i nie zmniejszyłoby ryzyka konfliktu; jeśli OSS-01 założy swoją wersję, scalenie
  nagłówka jest trywialne. Wart natomiast jednego zdania na kanale strumieni: „`readiness.md`
  już istnieje, dopisujcie linie".
- **Decision**: PENDING — do rozstrzygnięcia przez prowadzącego (nie naprawione automatycznie)

## Naprawy zastosowane w tym przeglądzie

```
 context/.../workstreams/ui-01/plan.md               |  6 +++---   F3
 hackathon/delivery-demo/evidence/figma/capture.sh   | 15 +++++----  F1
 hackathon/delivery-demo/evidence/figma/verify.sh    | 18 ++++++---- F2
```

Weryfikacja napraw (na kopii roboczej, z syntetycznymi PNG; artefakty testowe usunięte):

- Ścieżka pozytywna: `capture.sh create` + `capture.sh update` + `verify.sh` → 11/11 kontroli ✓,
  manifest w kształcie ze specyfikacji, `SHA256SUMS` zgodny.
- F1: `env PATH=/usr/bin:/bin MCP_CLIENT=codex-cli capture.sh create …` → `exit=0`, wpis w
  manifeście obecny, `client.name=codex-cli` (przed naprawą: `exit=127`, brak manifestu).
- F2: zasiany `figd_…` → ✗ z cytatem trafienia; czysty katalog → ✓; uruchomienie poza
  repozytorium git → ✗ „skan nie wykonał się" (przed naprawą: ✓).
- W repo: `verify.sh` → 3 kontrole nie przeszły (brak manifestu i renderów — stan oczekiwany,
  Faza 2 nie została wykonana), skan sekretów ✓.
