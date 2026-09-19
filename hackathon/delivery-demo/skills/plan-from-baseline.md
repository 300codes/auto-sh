# Skill — `plan-from-baseline`

Wynik jest **propozycją planu**. Import tworzy scalony baseline v+1 **i** zadania w jednej
transakcji — ale scalony baseline **nie jest aktywny**: wymaga ponownych dwóch decyzji
(`requirements` i `design`) dla nowego hasha. Zadania czekają. To projekt, nie błąd.

Kontraktowe źródło prawdy: `planProposalV1Schema`
(`packages/core/src/modules/delivery_os/lib/contracts.ts`).

## Warunek wejścia

Plan odnosi się do **aktywnego** baseline'u. `delivery_os.tasks.import_plan` żąda, żeby
`manifest.baselineId` był aktywnym baseline'em projektu, a `manifest.baselineHash` jego
`contentHash`. Baseline staje się aktywny dopiero po obu zatwierdzeniach. Bez tego import
zwróci `baseline_mismatch` albo `baseline_not_active` — nie zgaduj, przeczytaj wartości z UI.

## Wejście

Z paska wersji baseline'u w UI projektu:

- `baselineId` — UUID wersji oznaczonej **aktywna**,
- `baselineHash` — pełny `contentHash` tej wersji (skrócony w UI; pełny jest w odpowiedzi
  `GET /api/delivery_os/projects/<projectId>/baselines`),
- lista kryteriów akceptacji (`AC-*`) z sekcji *Wymagania*,
- profil docelowy projektu — decyduje o dozwolonych rootach ścieżek.

## Wyjście

```json
{
  "schemaVersion": "delivery.plan-proposal/v1",
  "projectId": "<UUID projektu>",
  "baselineId": "<UUID aktywnego baseline'u>",
  "baselineHash": "<contentHash tego baseline'u>",
  "manifestId": "plan-<slug>-<n>",
  "architectureSummary": "…",
  "tasks": [
    {
      "proposalTaskKey": "T-1",
      "title": "…",
      "description": "…",
      "acIds": ["AC-1"],
      "dependsOn": [],
      "allowedPaths": ["src/features/catalogue"]
    }
  ],
  "acTestMap": { "AC-1": ["tests/catalogue.spec.ts"] },
  "declaredTests": [{ "testId": "tests/catalogue.spec.ts", "file": "tests/catalogue.spec.ts" }],
  "producedBy": { "tool": "claude-code", "sessionRef": null }
}
```

## Reguły

- `schemaVersion` dosłownie. Inna wartość → `unsupported_schema_version`.
- `acIds` wskazują **istniejące** AC zatwierdzonego baseline'u. Nieznane → `unknown_ac`
  ze ścieżką `tasks.<i>.acIds.<j>`.
- `acTestMap` kluczuje się po AC baseline'u, a wartości muszą występować w `declaredTests`.
  Rozjazd → `unknown_test_id`; AC bez wymaganego pokrycia → `missing_required_tests`.
- `proposalTaskKey` jest unikalny. Duplikat → `duplicate_stable_id`.
- `dependsOn` wskazuje **inne** `proposalTaskKey` z tego samego manifestu. Odniesienie do samego
  siebie albo cykl → `cycle`; nieznany klucz → `foreign_dependency`.
- `allowedPaths` mieszczą się w rootach profilu docelowego projektu. Ścieżka poza profilem →
  `path_not_allowed` ze ścieżką `tasks.<i>.allowedPaths.<j>`. Ścieżki są repo-relative, bez `..`,
  bez `.`, bez wiodącego `/` i **bez końcowego `/`** — pusty segment jest traktowany jak traversal.
- Zakres docelowy demo: **4–6 zadań**, każde z 1–3 AC. Zadanie bez AC nie przejdzie walidacji
  (`acIds` ma minimum jeden element).
- Zadania są rozłączne po `allowedPaths` tam, gdzie to możliwe — dwa zadania piszące w ten sam
  katalog nie mogą iść równolegle.

## Po imporcie

Powiedz wprost: **scalony baseline v{n} nie jest aktywny**. Zanim zadania będą wykonywalne,
człowiek musi zatwierdzić wymagania i design na **nowej** wersji. Import, który tego nie mówi,
zostawia operatora z przekonaniem, że praca może ruszyć.
