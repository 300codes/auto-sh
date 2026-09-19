# Stan przed implementacją QA

Data: 2026-09-19. Analizowany commit: `68740781186420bd7952a52bd9c597fce53d02d0`.
Metoda: odczyt kodu, specyfikacji i testów; dwa niezależne badania OSS oraz WP/EXEC.
Nie uruchomiono testów aplikacji, nie utworzono danych w bazie, nie wykonano Studio.

## Ustalenia

| Zakres | Kod / dowód statyczny | Wniosek |
|---|---|---|
| R1–R19 | `packages/core/src/modules/delivery_os/api/`; tabela w `context/changes/delivery-os-oss-domain/handover/OSS-01-api-and-tests.md` | Dostępne do testów HTTP po przygotowaniu środowiska. |
| R20–R22 | Brak katalogów deploy-decisions, release-decisions i report | Zależność OSS-05; nie nazywać braku wykonania błędem działającego API. |
| API / komendy | `delivery_os/api/__tests__/routeTestKit.ts`, `manualFlow.route.test.ts`, `evidence.route.test.ts` | Mockowane auth/ACL/ORM. Manual flow kończy się awaiting_review; review pokryto osobno. Brak dowodu realnej izolacji i transakcji DB. |
| Integracje | `delivery_os/__integration__/TC-DELIVERY-UI-001.spec.ts` | Jedyny istniejący test delivery HTTP/UI; używa admina, tworzy projekt, reload, archive. Nie zastępuje QA-02. |
| Fixture | `delivery_os/lib/fixtures/builders.ts` | `buildResultManifest` tworzy jawnie sztuczne rewizje, czasy i hashe; dobry fake executor testów domeny, niedozwolony jako dowód live. |
| Review | `delivery_os/api/projects/[id]/evidence/route.ts`, `commands/evidence.ts:760` | R19 przenosi awaiting_review do verified albo changes_requested. PUT zadania nie zastępuje review. |
| AC | `delivery_os/lib/acProof.ts`, `resultChecks.ts` | Dowód wymaga właściwego baseline i rewizji. Sam poprawny manifest nie dowodzi wykonania testów ani kompletności raportu. |
| Restart | `delivery_os/commands/__tests__/executorFlow.test.ts` | Jest fake flow i pending/delivered; nie jest to restart rzeczywistego workera. |
| EXEC | Brak `packages/enterprise/src/modules/delivery_agents/` | Scenariusze można określić; realne park/restart/signal/two-run czekają na EXEC-02/04. |
| WP | `delivery-wordpress/src/{contracts,tools,snapshot,cli-support}.ts` | Jest snapshot SQLite + plików motywu, scoped site handle i lokalny caller. Brak mapowania do OSS oraz hosta wykonania. |
| Granica WP/OSS | `delivery_os/lib/__tests__/wordpressStudioContract.test.ts` | Obecny test potwierdza zgodność snapshot revision i ścieżek, odrzuca standalone report oraz ToolCheck jako manifest/dowód AC. Rozszerzyć, nie powielać. |
| Runner | `package.json`, `packages/core/package.json`, `.ai/qa/tests/playwright.config.ts` | Jest `test delivery_os --runInBand`; Playwright ma domyślnie retry=1 i reports pod `.ai/qa/test-results/`. Plan wymaga osobnej próby bez retry. |

Ścieżki `delivery_os/...` w tabeli oznaczają `packages/core/src/modules/delivery_os/...`,
a `delivery-wordpress/...` — `packages/delivery-wordpress/...`.

## Fixture i cleanup

Wzorce: `packages/core/src/helpers/integration/{authFixtures,api,generalFixtures,attachmentsFixtures,dbFixtures}.ts`
oraz `packages/core/src/modules/directory/__integration__/TC-DIR-002.spec.ts`.
Tenant provisioning wymaga uprawnień superadmina, ale aktorzy wykonujący asercje muszą być zwykłymi użytkownikami.
Potrzebne A/A1, A/A2 i B/B1: same dwa tenanty nie wykrywają przecieku między organizacjami jednego tenantu.
Helper `apiRequestWithSelectedOrg` nie przyjmuje dowolnych nagłówków, więc lokalny wrapper testowy musi zachować cookie scope, optimistic lock i Idempotency-Key.

DELETE projektu i tenantu oznacza soft delete; baseline/evidence/decisions nie mają DELETE.
Cleanup po scenariuszu powinien zamknąć własne próby, zarchiwizować zasoby i zweryfikować brak aktywnych skutków.
Pełne fizyczne sprzątanie zapewni usunięcie dedykowanego środowiska testowego, wraz z jego storage/cache/DB;
nie wprowadzać ogólnego SQL purge ani zmieniać retencji produktu na potrzeby QA.
Helpery `delete*IfExists` ignorujące błędy nie są dowodem skutecznego cleanup.

`dbFixtures.ts:18–29` ma fallback DATABASE_URL do plików `.env`; BASE_URL go nie wiąże.
Użytkownik zatwierdził dla nowego wrappera obowiązek jawnego testowego DATABASE_URL
i dopasowania losowego rekordu kontrolnego utworzonego przez API, przed licznikami SQL.

## Ograniczenia mapowania WP

`creationAttemptId` opisuje utworzenie witryny, nie bieżącą próbę OSS. `toolExecutionId` identyfikuje operację narzędzia,
a nie automatycznie run wykonawcy. `baselineId: null` w standalone report nie może otrzymać wartości bez pakietu OSS.
Zmiany ścieżek wymagają dwóch snapshotów, także dla usuniętych plików. `databaseHash` wpływa na contentHash,
lecz `allowedPaths` obejmuje motyw, nie bazę; test musi ujawnić tę granicę, bez dorabiania fikcyjnej ścieżki SQLite.
`wordpress-theme@1` wymaga playwright-smoke i php-lint; lokalny HTTP 200 nie jest żadną z tych kontroli.
Status gotowości komend na przyszłym hoście pozostaje nieznany.

Deep review ujawnił dodatkową granicę: `resultAcceptance.ts:39–50` koreluje baseRevision,
a `contracts.ts:447–460` wiąże checks z resultRevision, ale nie porównuje workspace
wyniku z bazowym. To obserwacja kodu do przekazania OSS, jeszcze bez reprodukcji runtime.
Użytkownik zatwierdził osobny guard w mapperze testowym i brak zmian API w tym zakresie.

## Decyzje wejściowe

- Użytkownik: najpierw plan i `10x-plan-review`, implementacja później.
- Istniejący plan nadrzędny: kontrakty v1, OSS-only manual flow, osobne decyzje publikacji/release, brak starego runtime WP.
- Użytkownik w tej sesji: budżet WP 1 h wykorzystana / 5 h pozostało; rejestrować dalszy czas od tej deklaracji.
- Nie zmieniać zaznaczeń Progress planu nadrzędnego na podstawie analizy lub fixture.
