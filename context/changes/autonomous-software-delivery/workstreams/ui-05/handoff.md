# UI-05 — przekazanie implementacji

Data: 2026-09-19. Baza checkoutu: `658a7b4f63`. Zakres zatwierdzony w tej sesji: **UI z jawnymi blokadami D1/D2/D3**, bez przejmowania API/komend OSS. Nie jest to pełny odbiór UI-05 ani FLOW-07. `change.md` pozostaje `implementing`; kanoniczny Progress planu głównego nie został zaliczony.

## Dostarczone zachowanie

| Faza | Dostarczony zakres | Pozostałe warunki |
|---|---|---|
| 1 | Server route raportu, metadata view ACL, link z projektu, walidacja projektu/raportu, historia git/snapshot, jawne loading/error/no-baseline, podsumowanie AC/skanów/usage/deploymentu | Browser hydration i manualny odbiór desktop/mobile nieuruchomione |
| 2 | DataTable po 50 lokalnych wierszy, pełne klucze relacji, ostrzeżenie truncated, linki tasków, dialog ID dowodu z jawną niedostępnością źródła; Escape i powrót fokusu | D1: lista źródeł, rekord, screenshoty/review, grupa baseline bez rewizji i autoryzowane załączniki |
| 3 | Historia decyzji z dopasowaniem baseline/hash/rewizji/evidence; osobne ACL deploy/release z wildcard; ukrycie akcji dla historii/archiwum, jawna blokada zapisu | D2 + D3: prawdziwy przedmiot i gate; dopiero potem formularze, guarded mutations, optimistic lock, preflight i obsługa 409/422/428/niepewnego POST |
| 4 | Nowe testy hooka/komponentów/helpers, spec integracyjny, wąskie TS i niniejsze przekazanie | Wykonanie integracji, pełny gate, pomiary build/hydration/latencji, ręczny i live WP odbiór |

Raport pokazuje v1 gates jako v1, bez twierdzenia o pełnym PASS procesu. Latest-result jest nazwany podglądem, nie kandydatem odbiorowym. Brak rewizji nie daje procentu wykonania; unknown usage nie staje się zerem. Status skanu i zgłoszony wynik są osobne, podobnie status deploymentu i nieudana weryfikacja.

Odczyt: aktywny baseline jest przypinany do zapytania, historia wymaga obu poprawnych parametrów. Klucz zawiera scope/projekt/query. Zmiana scope/projektu usuwa poprzedni snapshot, a spóźnione odpowiedzi są ignorowane. Jeden cykl odczytu naraz; 5 s po sukcesie wyłącznie przy aktualnej zgodzie deploy i braku verified deploymentu. Ukryta karta zatrzymuje timer; powrót odczytuje ponownie. Błędy odczytu zachowują stale snapshot z retry 10/20/40/60 s; 401/403/404 czyszczą dane i zatrzymują automatyczne próby. Ręczne odświeżenie jest dostępne.

## Kontrakty i zależności OSS

- Użyte: `delivery.report/v1`, `deliveryReportV1Schema`, `projectDetailSchema`, `SourceRevision`; fixture `lib/fixtures/delivery-report.v1.json` z checkoutu bazowego. Profile raportu są prezentowane dokładnie według odpowiedzi. Fixture nie jest dowodem live.
- **D1 niedostarczone:** `api/projects/[id]/evidence/route.ts` nadal ma tylko POST. Brak opublikowanego list/detail/attachment schema; UI nie wymyśla routów ani DTO. Komunikat mówi „API niedostępne”, nie „brak dowodów/pliku”.
- **D2 niedostarczone:** typy flow istnieją, ale report query zwraca v1, a decyzje nie sprawdzają etapowych zgód. Publiczny projekt nie rozróżnia wiarygodnie legacy i flow. Z tego powodu UI nie uruchamia żadnego zapisu decyzji, także odrzucenia. Nie zmieniono istniejących API ani wcześniejszych przycisków baseline.
- **D3 niedostarczone:** brak publicznego wskazania końcowej rewizji oraz walidacji jej aktualności przy decyzji. Nie wolno zastąpić go latest-result.
- Szczegółowy warunek dostawy nadal definiuje [oss-dependencies.md](oss-dependencies.md). Brak tych zależności został sprawdzony w kodzie i zaakceptowany przez użytkownika jako granica bieżącej implementacji UI.

Nie dodano martwych formularzy z nieosiągalnym POST ani hooków do nieistniejącego API. Ich rzeczywiste podłączenie pozostaje pracą po dostawie OSS.

## Walidacja

Runner: **local**. `DOCKER_COMPOSE_FILE` nieustawione; brak lokalnych compose override; `compose.fullapp.dev.yml` nie miał uruchomionego `app`; `compose.fullapp.yml` wymaga niedostępnej konfiguracji JWT. Brak `.ai/qa/ephemeral-env.json`. Nie uruchamiano środowiska ani migracji.

| Komenda / czynność | Wynik |
|---|---|
| `yarn workspace @open-mercato/core test --runInBand --testPathPatterns='delivery_os/components/report/__tests__/'` | Exit 0, 6 nowych suites, 63 testy |
| `node node_modules/typescript/bin/tsc --project /tmp/ui05-tsconfig.json --pretty false` | Exit 0; pliki wejściowe ograniczone do nowych komponentów/hooks/helpers raportu i server route/meta; `noEmit`, `incremental: false`, bazowa konfiguracja repo |
| `yarn generate` | Exit 0, route widoczny w wygenerowanym backend registry. OpenAPI bundler zgłosił `ERR_IMPORT_ATTRIBUTE_MISSING` dla `language-subtag-registry/.../registry.json` na Node 26.5.1 i użył statycznego fallbacku; nie jest to pełny sukces ekstrakcji OpenAPI |
| `git diff --check` | Exit 0 |
| TC-DELIVERY-UI-005 | Dodany, **nieuruchomiony**. Trzy scenariusze realnego API/UI: no-baseline/link, git desktop, WP snapshot mobile. Własne fixtures i cleanup; D1/D2/D3 osobno skipped z powodami |
| Istniejące testy / pełny gate / build / lint / check:client-boundaries / i18n checks | Nieuruchomione zgodnie z ograniczeniem użytkownika. Istniejące asercje `sections.test.tsx` dostosowano do przeniesienia komunikatu D1 do raportu, bez uruchamiania starego suite |
| Hydration, pomiar odczytu, build/bundle, live WP | Nie zmierzono; bez deklaracji PASS |

Pierwszy przebieg nowego testu strony miał 3 błędne asercje: wspólny ErrorMessage humanizuje nieprzetłumaczony klucz. Test poprawiono i pełen nowy zakres przeszedł. Wąski TS znalazł import `ColumnDef` z nowego TanStack API; poprawiono na `LegacyColumnDef`, zgodnie z DataTable, i TS przeszedł. Początkowy pomocniczy root Jest miał błąd TS5011; kanoniczna komenda workspace powyżej działa bez obejścia konfiguracji.

## Frontend ledger i tekst do włączenia przez OSS

Nowy server root: `backend/delivery/projects/[id]/report/page.tsx` → Suspense → `components/report/DeliveryReport.tsx`. Client islands: odczyt `useDeliveryReport`, summary/deployment/history, `EvidenceTable`, `EvidenceSources`, `EvidenceDetailDialog`, `ReleaseDecisionActions`. Helpers `reportView` i `evidenceView` są bez ORM. Zero nowych globalnych providerów/SDK/dependencies; każdy nowy plik produkcyjny jest poniżej 300 LOC. Metadata wymaga wyłącznie `delivery_os.projects.view`; zapis pozostaje niedostępny bez D2/D3.

Proponowany wpis do changelog specu OSS: „2026-09-19 — UI-05: dodano stronę raportu v1, traceability, historię i polling z ochroną scope. D1/D2/D3 pozostają blokadami odczytu źródeł i zapisu decyzji. Dostarczono nowe testy komponentowe i spec integracyjny; pełny gate i live odbiór nie zostały wykonane.”

Mapa API/UI coverage do włączenia przez właściciela specu: GET projektu + GET report w bieżącym/historycznym widoku; git/snapshot, noBaseline, history 404 bez fallbacku; hook tests scope/auth/visibility/backoff. Evidence GET, screenshot bytes, deploy/release POST z 409/422/428 i kandydatem: **blocked**, nie covered.

## Pliki i kontynuacja

Zmiany funkcjonalne: nowy folder `components/report/` z sześcioma nowymi plikami testów; `backend/delivery/projects/[id]/report/{page.tsx,page.meta.ts}`; link w `DeliveryProjectDetailClient.tsx` i `components/detail/EvidenceSection.tsx`; dostosowane `components/detail/__tests__/sections.test.tsx`; 113 kluczy w pięciu locale; `__integration__/TC-DELIVERY-UI-005.spec.ts`. Dokumentacja wyłącznie w bieżącym `workstreams/ui-05/`.

Po przekazaniu OSS podłączyć rzeczywiste D1/D2/D3, uzupełnić formularze i testy mutacji oraz wykonać integrację. Operator/QA muszą jeszcze potwierdzić na desktop/mobile: wejście z projektu i historii, szczegóły źródeł/screenshot, rozdzieloną zgodę i odbiór, konflikt oraz właściwą rewizję live WP. Brak tych potwierdzeń nie zalicza 5.1/5.4/FLOW-07. Wspólny spec i główny Progress aktualizuje wyznaczony właściciel.
