# WP-M02 — projekt mapowania do OSS

Status: mapper testowy i fixture zaimplementowane; focused Jest 36/36 PASS i wąski TS7 PASS.
Dowód: [phase-6/wp-mapper-unit.json](evidence/phase-6/wp-mapper-unit.json). Nie wykonano live WP/Preview.
Źródła: `packages/delivery-wordpress/src/{contracts,tools,snapshot,cli-support}.ts`,
`packages/core/src/modules/delivery_os/lib/{contracts,resultAcceptance,resultChecks,targetProfiles}.ts`.
Kontrakt docelowy: `delivery.result-manifest/v1`, profil `wordpress-theme@1`.

## Pochodzenie danych

| Pole / relacja | Źródło | Kontrola |
|---|---|---|
| tenantId / organizationId | Uwierzytelniony host, poza manifestem OSS | Scope narzędzi musi być taki sam; wartości z raportu nie nadają uprawnień |
| projectId/taskId/attemptId | Zarezerwowany TaskPackage | Dokładna korelacja, brak domyślnych UUID |
| baselineId/baselineHash | Pakiet zatwierdzonego baseline | Nie pobierać z null w standalone report ani bieżącego draftu |
| targetProfileVersion | Pakiet `wordpress-theme@1` | Profil i revisionKind muszą się zgadzać |
| baseRevision | Pakiet, odpowiadający snapshotowi sprzed pracy | Ta sama witryna i faktyczny contentHash |
| resultRevision | Nowy snapshot.sourceRevision | kind=snapshot, contentHash z bytes, externalWorkspaceId=siteId |
| baseCommit/resultCommit | Nieobecne | themeCommit nie zastępuje hasha motywu i danych |
| externalRunId | Rejestr wykonania hosta | Powiązać z attempt i operacjami; w fixture jawnie `fixture-run-…` |
| toolExecutionId | Konkretne create/snapshot/etc. | Osobny identyfikator operacji w ledger dowodów |
| creationAttemptId | Provenance utworzenia witryny | Może być różny od bieżącego attemptId; użyć istniejącego scoped site handle |
| changedPaths | Porównanie base.themeFiles i result.themeFiles | Dodane, zmienione i usunięte; ścieżki względne, przecięcie task.allowedPaths i profilu |
| artifacts | Zapisane pliki i hashe | Dla attachmentId również zgodność bytes i scope; prywatnego SQLite nie publikować |
| checks | Faktyczny runner zatwierdzonego profilu | Pełne pola ResultCheck; ToolCheck nie wystarcza |
| agentDeclaration | Opis agenta/fixture | Nigdy nie dowodzi AC |
| findings | Rzeczywiste wyniki kontroli albo jawna fixture | Brak findingów nie znaczy security PASS |
| usage | Faktyczny pomiar, inaczej values=unknown | Nie generować czasu/kosztu/tokenów jako wyniku live |

## Snapshot i hashe

Algorytm obecnego narzędzia: SHA256 z JSON obiektu `{schemaVersion:1,databaseHash,themeFiles}`,
z themeFiles posortowanym po ścieżkach; databaseHash oraz hashe plików pochodzą z zamrożonych bytes.
Test odtwarza dokładny format `snapshot.ts`, nie arbitralną kolejność kluczy nowego serializera.
Fixture używa małych jawnych danych, a nie eksportu prawdziwej bazy.

Zmiana samego databaseHash zmienia SourceRevision. `allowedPaths` nie obejmuje polityki
mutacji danych WP. Nie dopisywać `database.sqlite` do changedPaths motywu i nie twierdzić,
że test paths udowadnia kontrolę wszystkich zmian bazy. Przed live host musi mieć zatwierdzony
zakres pracy na danych; brak tego warunku jest blockerem live, nie zmianą OSS v1 w tej fazie.

## ResultCheck

Obowiązkowe: checkId, testId, acIds, commandProfileId, validationProfileVersion,
testDefinitionHash, status, exitCode, durationMs, sourceRevision, rawReportHash.
Test przypina AC→requiredTestIds z pakietu, definicję testu i surowy raport.
Narzędziowe `http.local:passed`, `studio.create:passed` i `snapshot.capture:passed`
nie stają się `playwright-smoke` ani `php-lint`.

Składniowo poprawny failed/not_run może być wynikiem importu, lecz nie dowodzi AC.
Brak kontroli = missing w ocenie QA; awaria uruchomienia narzędzia = not_run/tool_error;
uruchomiona kontrola wykrywająca defekt = failed. Nie mapować ogólnego partial na passed.
Profile scan/build/lint bez AC pozostają kontrolami profilu, bez dopisywania fikcyjnych AC.

## Macierz testów do rozszerzenia

| Przypadek | Oczekiwanie |
|---|---|
| Pełny pakiet + dwa snapshoty + checks | Schema i korelacja przechodzą; fixture jawna |
| Niepełny standalone report / ToolCheck | Odrzucenie jak w istniejącym wordpressStudioContract.test.ts |
| Obcy project/task/attempt/baseline/hash | Odrzucenie właściwą kontrolą korelacji |
| Zły baseRevision / bazowy workspace | Odrzucenie przez obecną korelację OSS z zarezerwowanym pakietem |
| Obcy wynikowy workspace, także w checks | Nowy mapper testowy odrzuca przez jawny guard zgodności witryny; obecny OSS sam tej reguły nie egzekwuje |
| Inna wersja profilu / revisionKind git | Odrzucenie |
| Unknown test/AC, duplicate checkId | Odrzucenie |
| Add/change/delete theme path | Dokładny diff; path escape odrzucone |
| Zmienione bytes przy starym sha | Weryfikacja pliku wykrywa różnicę; samo Zod nie jest verifierem bytes |
| failed/not_run lub brak required test | Brak proof/verified; rozdzielić import od odbioru |
| Historyczny/wygasły preview | Nie zalicza świeżego deploymentu; brak implementacji report API pozostaje zależnością |
| Tylko zmiana databaseHash | Nowa revision, brak fikcyjnej ścieżki motywu, jawna granica kontroli scope |

## Warunek przejścia do live

Ograniczenie obecnego OSS do przekazania właścicielowi: korelacja porównuje baseRevision,
ale nie wiąże wynikowego externalWorkspaceId z witryną bazową. Poprawny schema result
z innym workspace i zgodnymi checks może przejść. Guard mappera w tej fazie jest
przygotowaniem wymagań dla przyszłego hosta, nie wdrożoną ochroną produkcyjną.

Host enterprise, aktualny zatwierdzony pakiet, scoped ownership witryny, rzeczywiste
profile checks, base i result snapshot, import do OSS i pozostały budżet WP.
Użytkownik potwierdził 1 h zużytą / 5 h pozostało; dalszy czas WP należy dopisywać.
Fixture nie zalicza parent Progress 5.3/5.5 ani nowej próby OM→WP→OM.

Cel publikacji demo wskazany przez użytkownika: **Studio Preview**.
[Probe i wzorce starego orchestratora](studio-preview-readiness.md) nie są wynikiem wdrożenia.
