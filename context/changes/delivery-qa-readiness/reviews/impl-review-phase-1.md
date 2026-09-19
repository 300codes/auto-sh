<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Delivery QA readiness

- **Plan**: ../plan.md
- **Scope**: Phase 1 of 7
- **Date**: 2026-09-19
- **Verdict**: APPROVED — automated; manual acceptance pending
- **Findings**: 0 critical, 0 open code warnings; historical findings resolved below

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | FAIL — HTTP not_run/environment |

## Findings

### F1 — Nazwa roli przekraczała kontrakt API

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/helpers/integration/deliveryFixtures.ts
- **Detail**: Namespace z limitem 80 znaków plus UUID i sufiks roli przekraczał maksymalną długość 100 znaków. Provisioning kończyłby się odmową walidacji.
- **Fix**: Skrócić części runId/testId, zachować retry i UUID; najdłuższa bieżąca nazwa roli ma maksymalnie 99 znaków.
- **Decision**: FIXED w pętli implementacja/review autoryzowanej przez użytkownika.

### F2 — Awaria zamykania sesji pomijała kontekst bootstrap

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/helpers/integration/deliveryFixtures.ts
- **Detail**: Promise.all dla aktorów mogło odrzucić przed wywołaniem bootstrap.dispose().
- **Fix**: Promise.allSettled obejmuje wszystkie konteksty; błąd zbiorczy nie zawiera sekretów.
- **Decision**: FIXED.

### F3 — Ledger niepoprawnie oznaczał zachowanie rekordu użytkownika

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/core/src/helpers/integration/deliveryFixtures.ts
- **Detail**: API usuwa użytkownika fizycznie; retained=true sugerowało zachowanie jego rekordu.
- **Fix**: retained=false dla użytkownika; runbook oddziela retencję rekordu od audytu i obowiązku usunięcia środowiska.
- **Decision**: FIXED.

### F4 — Błędne CRC danych obrazu fixture

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/helpers/integration/deliveryFixtures.ts
- **Detail**: PNG miał poprawny strumień pikseli, ale błędne CRC chunku IDAT. Ścieżka przetwarzania obrazu mogłaby odrzucić fixture.
- **Fix**: Poprawić CRC w rzeczywistych bytes uploadu; hash baseline jest nadal liczony z przesyłanych bytes.
- **Decision**: FIXED; sprawdzono CRC wszystkich chunków i dekompresję danych pikseli.

### F5 — Brak dowodu wykonania HTTP i odbioru środowiska

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: ../plan.md — Progress 1.1–1.3
- **Detail**: Pierwsza próba wymaganego polecenia zakończyła się przed discovery z powodu braku node_modules. W odizolowanej kopii z zależnościami zgodnymi z lockfile przeszły 4 testy ledger i wąska kontrola TypeScript 7. Nie dowodzi to wykonania dwóch powtórzeń realnych testów HTTP. Późniejsza próba przygotowania własnej instancji również nie dotarła do HTTP: standardowy build Next przekroczył limit kontenera 6 GiB, a ograniczony build webpack przekroczył stertę JS 3072 MiB. Nie zwiększano limitu kontenera. Nie wykonano żadnego scenariusza HTTP; domyślny limit czasu testu 20 s nadal wymaga sprawdzenia na gotowej instancji.
- **Fix**: Przygotować ograniczone zasobowo disposable środowisko, wykonać wymagany run i zachować raporty cleanup; osobno odnotować potwierdzenie operatora. Bez zmian globalnego runnera ani timeoutów w plikach testowych.
  - Strength: Zachowuje rzeczywisty poziom dowodu i kontrolę zasobów.
  - Tradeoff: Wymaga przygotowania aplikacji i świeżej bazy.
  - Confidence: HIGH — brak środowiska został sprawdzony.
  - Blind spot: Zachowanie prawdziwych endpointów pozostaje niewykonane.
- **Decision**: PENDING — not_run/environment; kontrolowane próby uruchomienia zakończone, bez dalszego podnoszenia limitów. Wymagane działające disposable środowisko dla bieżącej rewizji.

## Iteracje i dowody

Dwie analizy: zgodność z planem oraz bezpieczeństwo/wzorce i zgodność payloadów z API.
Poprawki F1–F4 wdrożone; dodatkowo cleanup pliku wymaga zarchiwizowania projektu,
a wrapper sprawdza zgodność aktora z zakresem jego zapisanej sesji.

[Dowody testów jednostkowych i typów](../evidence/phase-1/verification.json) zawierają
rewizję bazową, hashe nowych plików oraz raportów. Weryfikacja dotyczy niecommitowanego
zestawu plików, nie całego gate repo. Progress 1.1–1.3 pozostaje niezaznaczony.

Końcowy ponowny review poprawek nie wykrył nowych regresji bezpieczeństwa.
Pętla korekt kodu jest zakończona; cała faza 1 nie jest ukończona, ponieważ nie ma
dowodów HTTP 1.1/1.2 ani potwierdzenia odbioru 1.3. Błędy przygotowania środowiska
nie są wynikami failed testów produktu. Nie wykonano commitu ani dalszych faz.

[Raport środowiska](../evidence/phase-1/environment.json): wszystkie własne kontenery
i trzy jednorazowe bazy są nieobecne; usunięto całą izolowaną kopię wraz ze storage,
cache, kolejkami, surowymi logami i zależnościami. physicalCleanup=completed dotyczy
środowiska bootstrap, nie niewykonanego cleanup scenariuszy HTTP.

## Ponowna próba po zgodzie na stertę 4096 MiB

[Raport próby 4 GiB](../evidence/phase-1/retry-4gb-environment.json) oraz
[wyciąg błędów kompilacji](../evidence/phase-1/retry-4gb-webpack-error.log): brak OOM
przy niezmienionym limicie kontenera 6 GiB / 2 CPU. Webpack zakończył kompilację błędem
rozwiązywania `fs`, `tls`, `net`: gRPC → OpenTelemetry → kod serwerowy DI →
`customers/message-objects` → `messages.client.generated.ts` → ClientBootstrap.
Dotyczy prywatnego wariantu QA z Webpack; standardowy build Turbopack nie został
ukończony w poprzedniej próbie. Nie wprowadzono obejścia ani zmian kodu produktu.

F5 nadal PENDING: wykonano 0 testów HTTP; nie ma wyników failed asercji HTTP.
Kontenery i dane runtime usunięte, nieaktywny cache narzędzi zajmuje około 4,55 GiB.
Przepis lokalny nie ma potwierdzenia udanego cold/warm startu. Kryteria 1.1–1.3
pozostają oczekujące; pętla korekt kodu fixture jest zakończona.

## Aktualizacja po zgodzie na usuwanie blockerów

Powyższe próby opisują historię, nie końcowy stan kodu. Następnie:

- Naprawiono granicę klient/serwer w 19 loaderach message objects; regresja bundlera i template sync przeszły, kompilacja Webpack jest zielona.
- Pełna kontrola typów Next wyczerpała heap 4096 MiB. Prywatny wariant QA pomija wyłącznie ten etap; standardowy build pozostaje niezaliczony. Wąska kontrola typów zmienionych plików przeszła.
- Discovery ujawniło nieprawidłowe importy fixture w Node 24; testowe importy JSON mają jawne attributes. Końcowe discovery: 47 testów / 10 plików, bez zmiany kontraktu produkcyjnych fixture.
- Collect page data ujawniło podwójne bootstrap API/full z identycznym obiektem loadera. Dwuliniowa naprawa zachowuje odrzucanie różnych loaderów. [Regresja](../evidence/phase-1/registry-regression.json): red 2 failed / 9 passed; green registry + prawdziwy factory 15/15.

F5 pozostaje PENDING do wyniku HTTP, aktualny runtime jest ponownie uruchamiany.
Poprawki źródeł identyfikuje [manifest](../evidence/phase-1/final-source-manifest.json).

## Końcowa weryfikacja HTTP

Automatyczne kryteria tej fazy zaliczone: końcowa wersja fixture 4/4, fazy 2–4
łącznie 45/45 unikalnych przypadków z pokryciem aktualnych źródeł (38 z pełnego
przebiegu + 7 z celowanego retestu zmienionych plików). To nie jest jeden bezbłędny
pierwszy przebieg: wcześniejsze błędy fixture zachowano w historii. Brak retry
Playwright, skip i flaky. [Aktualny manifest](../evidence/verification-current.json)
wiąże raporty, źródła i wynik cleanup. Nie jest to pełny gate repo ani live WordPress.

Końcowy status F5: FIXED dla automatycznych kryteriów HTTP 1.1/1.2. Wcześniejsze
PENDING opisuje historię prób. Manualne 1.3 pozostaje odrębnym odbiorem.
