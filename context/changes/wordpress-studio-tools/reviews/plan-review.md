<!-- PLAN-REVIEW-REPORT -->
# Plan Review: WordPress Studio tools

- Plan: [plan.md](../plan.md)
- Mode: Deep
- Date: 2026-09-19
- Verdict: SOUND po doprecyzowaniach
- Findings: 1 CRITICAL, 4 WARNING; wszystkie FIXED przed implementacją

## Verdicts

| Dimension | Verdict |
|---|---|
| End-State Alignment | PASS — samodzielne narzędzia i nowa witryna; bez fałszywego OM E2E |
| Lean Execution | PASS — limit 6 h, bez portowania engine/Apply/preview |
| Architectural Fitness | PASS — osobny provider, bez enterprise w OSS |
| Blind Spots | PASS po poprawkach blokad, snapshotu i restartu |
| Plan Completeness | PASS — fazy i Progress zgodne |

## Grounding

5 istniejących referencji potwierdzonych; nowy pakiet jawnie oznaczony jako nowy.
3 fazy i 11 kryteriów mają mechanicznie zgodne odpowiedniki w Progress.
Niezależny reviewer sprawdził Node 24.13.1, DatabaseSync/backup, Studio help,
domyślny runtime i ograniczenia istniejącego adaptera. Brakujące delivery_os,
delivery_agents i root node_modules zostały potwierdzone, nie założone jako gotowe.

## Findings

### F1 — Snapshot bazy nie zamraża jednocześnie motywu

- Severity: CRITICAL
- Impact: MEDIUM — wymaga świadomej kolejności efektów
- Dimension: Blind Spots
- Detail: Sam SQLite backup nie gwarantuje wspólnej wersji z plikami motywu.
- Fix: Blokada wszystkich mutacji, potwierdzone zatrzymanie witryny, prywatne
  kopie plików i DB, hashowanie kopii oraz odtworzenie poprzedniego stanu.
- Decision: FIXED w planie, wymagane testy współbieżności i WAL.

### F2 — Klucz ownership i zakres journal

- Severity: WARNING
- Impact: MEDIUM — skutki idempotencji i kolizji między projektami
- Dimension: Plan Completeness
- Fix: siteId z tenant/org/project, attempt jako korelacja, hash wszystkich opcji,
  atomic completion, blokady per site; create obejmuje scaffold i aktywację.
- Decision: FIXED; niepewny efekt pozostaje reconciliation_required.

### F3 — Domyślny runtime Studio

- Severity: WARNING
- Impact: LOW — jawne argumenty polecenia
- Dimension: Blind Spots
- Fix: Create używa `--runtime sandbox --skip-browser --skip-log-details`;
  stała ścieżka SQLite, bounded parser JSON z bannerem.
- Decision: FIXED.

### F4 — Typecheck nie gwarantuje uruchamialnego ESM

- Severity: WARNING
- Impact: LOW — lokalna konfiguracja build
- Dimension: Plan Completeness
- Fix: NodeNext, przepisywanie rozszerzeń i smoke importu dist; jawne wersje toolchainu.
- Decision: FIXED.

### F5 — Test niezależności nie może zatrzymać cudzego runa

- Severity: WARNING
- Impact: LOW — bezpieczny dowód negatywny
- Dimension: Blind Spots
- Fix: Test z zabronionym HTTP oraz kontrola importów; niedostępny stary serwer
  jest dodatkowym dowodem live, nie wymaganiem zabicia cudzych procesów.
- Decision: FIXED.

Triage wykonano autonomicznie zgodnie z instrukcją użytkownika. Ręczny odbiór
pozostanie niezaznaczony do faktycznej oceny człowieka; nie blokuje prac automatycznych.
