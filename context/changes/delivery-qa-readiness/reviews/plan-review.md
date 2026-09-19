<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Delivery QA readiness

- **Plan**: [plan.md](../plan.md)
- **Mode**: Deep
- **Date**: 2026-09-19
- **Verdict**: SOUND po zatwierdzonym triage; początkowo REVISE
- **Findings**: 0 critical, 2 warnings — oba FIXED; 0 nierozstrzygniętych
- **Zakres**: ocena planu i kodu, nie wykonanie testów produktu

## Verdicts

| Dimension | Przed triage | Po poprawkach |
|---|---|---|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

Potwierdzono istniejące pliki referencyjne: `authFixtures.ts`, `attachmentsFixtures.ts`,
`wordpressStudioContract.test.ts`, `executorFlow.test.ts`, `reconcile.test.ts`,
`acProof.test.ts` oraz katalog `delivery_os/__integration__`. Nowe ścieżki testów/helperów
są jawnie oznaczone jako nowe; nie przedstawiono ich jako istniejącej implementacji.
Symbole `buildResultManifest`, `checkResultCorrelation`, `evaluateResultAcceptance`
istnieją. Skrypty Jest/Playwright odpowiadają package.json i konfiguracji testów.
Brief i plan mają zgodny zakres. Kontrola mechaniczna: 7 faz, 16 kryteriów, jeden
końcowy Progress, wszystkie kryteria oczekujące i zgodne z częściami faz.

Niezależny przegląd sprawdził provisioning i cleanup, R19 review, mapowanie WP,
wybór testów, granicę fake/live i wpływ zmian na istniejące wywołania. Produkcyjne
API, publiczne profile i pozostałe moduły nie wymagają modyfikacji w tym planie.

## Findings

### F1 — Wskazać właściciela kontroli wynikowego workspace

- **Severity**: WARNING
- **Impact**: LOW — lokalne doprecyzowanie oczekiwań testu
- **Dimension**: Plan Completeness
- **Location**: Phase 6; `wordpress-mapping.md`
- **Detail**: `packages/core/src/modules/delivery_os/lib/resultAcceptance.ts:39–50`
  porównuje baseRevision z pakietem. `lib/contracts.ts:447–460` porównuje rodzaj rewizji
  i zgodność checks z resultRevision. Nie wiąże wynikowego workspace z bazowym.
  Początkowy plan mówił ogólnie o odrzucaniu obcego workspace, co mogło prowadzić
  do wymagania nieistniejącej odmowy OSS albo nieautoryzowanej zmiany API.
- **Fix**: Rozdzielić bazowy workspace (istniejąca korelacja OSS) i wynikowy workspace
  (jawny guard nowego mappera testowego). Ograniczenie obecnego OSS przekazać właścicielowi.
- **Decision**: FIXED — użytkownik zatwierdził doprecyzowanie bez zmian API.
- **Weryfikacja poprawki**: Faza 6, dokument mapowania, research i evidence-index opisują
  tę samą granicę. Nie twierdzą, że guard testowy jest wdrożoną ochroną produkcyjną.

### F2 — Powiązać dowody SQL z testowaną aplikacją

- **Severity**: WARNING
- **Impact**: LOW — lokalne zabezpieczenie preflight wrappera
- **Dimension**: Blind Spots
- **Location**: Phase 2, SQL liczniki
- **Detail**: `packages/core/src/helpers/integration/dbFixtures.ts:18–29` szuka
  DATABASE_URL także w plikach `.env`, a `withClient` nie zna Playwright BASE_URL.
  Właściwy HTTP URL nie gwarantuje więc, że liczniki pochodzą z tej samej bazy.
- **Fix**: Nowy wrapper wymaga jawnego DATABASE_URL, a przed licznikami potwierdza
  losowy rekord utworzony przez API wraz z project/tenant/org/run IDs. Brak zgodności
  daje not_run/environment; bez zmian istniejącego helpera i bez wypisywania sekretów.
- **Decision**: FIXED — użytkownik zatwierdził kontrolę zgodności środowiska.
- **Weryfikacja poprawki**: Faza 2, runbook i research wymagają tego samego preflight.

## Ograniczenia werdyktu

SOUND oznacza gotowość planu do implementacji. Nie jest potwierdzeniem działania
dwóch tenantów, DB concurrency, restartu workera, poprawności hosta WP ani odbioru AC.
R20–R22, UI obu wejść, realny wykonawca i świeży PoC WP pozostają jawnie odłożonymi
odbiorami zależnymi. Wąskie testy QA nie zastępują pełnego gate końcowej rewizji.
Cleanup fizyczny pozostaje warunkiem zamknięcia własnego disposable środowiska,
nie skutkiem archiwizacji danych przez API.
