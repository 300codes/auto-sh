# UI-06 — przekazanie implementacji D1–D3

Data: 2026-09-19. Po przygotowaniu materiałów w `74aa7fb33d` użytkownik rozszerzył
zakres o brakujący backend. D1–D3 oraz integracja raportu są zaimplementowane.
Pełna próba i prezentacja Figma/WP pozostają `not_run`; nie zaliczono ręcznego
odbioru ani wspólnego [Progress](../../plan.md#progress).

## Dostawa

- D1: paginowane GET evidence, detail i autoryzowane bytes powiązanego załącznika;
  osobne źródła baseline bez rewizji. Dialog używa bezpiecznej projekcji, preview
  rastrowego i pobierania przez `apiCall`, z ochroną zmiany scope.
- D2: jawne `legacy`/`flow`, aktualne etapy i bramki w raporcie. Deploy, release
  i zapis deployment evidence sprawdzają stan na serwerze pod blokadami.
- D3: immutable `DeliveryReleaseCandidate`, GET/POST release-candidate, wersja
  nominacji i evidence integracyjne. Nowy wynik taska nie podmienia kandydata.
  Ponowna nominacja lub zmiana zgód etapowych unieważnia poprzedni consent.
- UI: odrębne formularze deploy/release, uprawnienia wildcard, świeży preflight,
  optimistic lock i fingerprint dowodów; niepewny POST wymaga ponownego przeglądu.
  Historia/archiwum pozostają bez mutacji. Tłumaczenia en/pl/de/es/ko.
- Migracja dodaje tabelę kandydatów i opcjonalne powiązania decyzji, wraz ze snapshotem.
  Nie zastosowano jej lokalnie. Brak nowych zależności produkcyjnych.
- Publiczny attachment service ma opcjonalne `describeScoped`; stare implementacje
  interfejsu pozostają zgodne. Własny provider bez tej metody nie udostępni nowych
  bytes D1 (503) — trzeba wdrożyć scoped metadata read.

Kontrakty i zakres: [spec D1–D3](../../../../../.ai/specs/2026-09-19-delivery-report-readiness.md).
Kod znajduje się w `packages/core/src/modules/delivery_os/` oraz minimalnym rozszerzeniu
`packages/core/src/modules/attachments/`. Commit ustalisz przez
`git log -1 --format=%H -- packages/core/src/modules/delivery_os/lib/reportContracts.ts`.
To rewizja platformy, nie wygenerowanej witryny.

## Weryfikacja

Runner: **local**, wybrany po probe opisanym w [readiness](readiness.md).
Zgodnie z poleceniem uruchomiono wyłącznie nowe testy i TS nowych plików.

- 12 nowych plików Jest, 73 testy: PASS. Polecenie:
  `node_modules/.bin/jest --config packages/core/jest.config.cjs --runInBand --runTestsByPath <nowe pliki>`.
  Obejmują scoped evidence/attachment, routes, nominację, aktualność decyzji,
  publication gate, wybór B wobec C, hooks i komponenty. Po poprawce kolejności
  komunikatu błędu powtórzono tylko nowy `releaseDecisionSafety.test.tsx`.
- TS: `node_modules/.bin/tsc -p /tmp/ui06-tsconfig.json --pretty false`;
  konfiguracja obejmuje wyłącznie nowe pliki wejściowe, `noEmit`, bez incremental.
- `yarn generate`: exit 0. Rejestry odkryły nowe endpointy i encję. Ostrzeżenie:
  Node 26.5.1 / `language-subtag-registry` zgłasza `ERR_IMPORT_ATTRIBUTE_MISSING`;
  OpenAPI zastosowało static fallback bez request/response schemas. Schematy
  źródłowe endpointów są w kodzie; pełną generację OpenAPI należy potwierdzić
  w wspieranym środowisku przed publikacją dokumentacji API.
- Dodano self-contained integracje `TC-DELIVERY-UI-007` (D1 + screenshot UI)
  i `TC-DELIVERY-UI-008` (Git/snapshot, A/B/C, stale fingerprint, consent,
  niezweryfikowane/zweryfikowane wdrożenie, release i ponowna nominacja).
  **Nie uruchomiono** ich bez przygotowanej bazy/migracji. UI-005 zachowuje
  dotychczasowe przypadki i korzysta ze źródeł; usunięto przestarzałe puste skips.
- Pełne testy, lint, build, globalny typecheck, browser smoke i live: **not_run**.

## Pozostały odbiór operacyjny

QA musi zastosować migrację w uzgodnionym środowisku, uruchomić nowe integracje
oraz sprawdzić aktualne F0–F4, dostęp Figmy, operatora i cel WP. Scenariusze
z kontrolowanymi dowodami nie dowodzą rzeczywistej publikacji. Profil
`wordpress-theme@1` nie stanowi pełnego PASS FLOW-01…09/WP-01…05.

Materiały wszystkich faz: [scenariusz](demo-scenario.md), [readiness](readiness.md),
[protokół próby](rehearsal.md), [plan](plan.md). Próba, nowy design live,
rzeczywista publikacja i końcowy verdict wymagają ich wykonania przez właściwe role.
Nie wykonano push, PR ani publikacji zewnętrznej.
