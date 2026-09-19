# UI-02 — przekazanie

> Szkielet założony na starcie Fazy 2, uzupełniany w trakcie. Ten plik **nie zalicza** żadnego kryterium
> [planu głównego](../../plan.md#progress) — 2.3 i 2.4 są współodbiorem OSS-02, EXEC-02, UI-02 i QA-02
> i zaznacza je jedna wyznaczona osoba po dowodach od wszystkich czterech stron.

- **Rewizja:** _(uzupełniane w Fazie 3)_
- **Runner walidacji:** local (brak działającego kontenera `app`; w `docker ps` tylko `mercato-postgres` i `mercato-meilisearch`).
- **Uwaga o środowisku:** drzewo nie miało `node_modules` — wykonano `yarn install --immutable` przed pierwszą bramką.

## Zależność zapisana z góry: fixture domenowy

Kryteria **2.10** i **2.11** w Progress tego planu są **warunkowe**. Oba wymagają projektu z **aktywnym**
baseline i co najmniej jednym zadaniem. UI-02 takiego fixture'a **nie tworzy** i nie będzie tworzyć:

- `baselineContentV1Schema` żąda niepustych `acceptanceCriteria`, każdego `requirementId` rozwiązującego się
  do wymienionego wymagania, plus `tokens`, `acTestMap`, `manualChecks` i `declaredTests`,
- zamrożenie draftu wymaga `delivery_os.projects.manage` i nagłówka blokady,
- zadanie potrzebuje `acIds` i `allowedPaths` w rootach profilu,
- aktywacja baseline to **dwie** decyzje przez `POST /baselines/[id]/decisions` (`requirements` i `design`).

**Dostawca fixture'a: OSS-02 / QA-02.** Do czasu jego dostarczenia 2.10 i 2.11 zostają niezaznaczone,
a pokrycie wyboru zadania i sekcji wymagań/designu opiera się na testach komponentowych
(`components/detail/__tests__/sections.test.tsx`, `backend/delivery/projects/[id]/__tests__/page.test.tsx`).

## Zakres dostarczony

_(uzupełniane w Fazie 3)_

## Zakres świadomie pominięty

_(uzupełniane w Fazie 3)_

## Prośby do OSS

_(uzupełniane w Fazie 3)_

## Wynik walidacji, ograniczenia i luki pokrycia

_(uzupełniane w Fazie 3)_
