# WordPress Studio tools — plan wykonania

## Overview

Zrealizować autoryzowane rozwinięcie WP-M01: samodzielne narzędzia Studio oraz
nową lokalną witrynę w limicie 6 godzin łącznie z analizą, review i testami.
Nie używać runtime, API, bazy, sesji ani projektów starego orchestratora.

## Current State Analysis

[Badanie](research.md) wskazuje niezależny CLI Studio i referencje techniczne.
Pakiety domenowe delivery i provider jeszcze nie istnieją. Nowy pakiet
`packages/delivery-wordpress/` jest planowaną ścieżką, nie istniejącą implementacją.
Konwencje pakietów: `packages/web-research-searxng/package.json`, `tsconfig.base.json`.
Node 24 pozwala użyć `node:sqlite` i natywnych testów `node:test` bez nowego runnera.
Walidacja Zod korzysta z biblioteki już używanej w monorepo.

## Desired End State

Zaufany host wywołuje typowane narzędzia create/status/start/stop, scaffold/activate
i captureSnapshot. Dostarczony lokalny caller faktycznie używa tego interfejsu,
tworzy nową witrynę i przekazuje manifest dowodów bez sekretów. Pakiet buduje się
i działa bez starego orchestratora. Nie deklarujemy integracji z nieistniejącymi
modułami OM; gotowy kontrakt oraz lista call sites są przekazaniem do ich autorów.

## Scope and decisions

- Własna implementacja na podstawie zachowania Studio; brak importów z prywatnego repo.
- Jeden zaufany lokalny host, nowe demonstracyjne witryny, SQLite, Node 24.
- Brak adoptowania/edycji istniejących witryn, publikacji produkcyjnej, nowych płatnych
  usług, nowej inferencji AI, ogólnego shella ani zmian w pipeline/release.
- Publiczny preview, klonowanie, Apply/Rollback i silnik budowania agenta pozostają
  późniejszą integracją; nie są warunkiem samodzielnych narzędzi i lokalnej witryny.
- Wykonanie enterprise pozostaje właścicielem lifecycle i zatwierdzeń. Pakiet nie
  nadaje verified/release, nie zawiera tabel biznesowych ani kolejki.
- Limit 6 godzin obejmuje wcześniejszą analizę. Po limicie raportujemy stan i braki.

## Implementation Approach

### API and ownership

`createWordPressStudioTools(config, dependencies?)` przyjmuje zaufane `sitesRoot`,
`stateRoot`, ograniczony timeout oraz wstrzykiwany runner. Create przyjmuje kontekst
`tenantId`, `organizationId`, `projectId`, `attemptId` i idempotencyKey oraz nazwę
nowego projektu; pozostałe metody przyjmują scope/handle. Scope w integracji OM musi pochodzić z backendu, nigdy z modelu.
Zod odrzuca nieznane pola, ścieżki/shell od klienta i nadmiarowe dane.
siteId jest hashem tenantId/organizationId/projectId; attemptId służy korelacji,
nie zmienia katalogu witryny. Klucz operacji create obejmuje siteId, nazwę operacji
i idempotencyKey. Hash payloadu obejmuje scope oraz wszystkie efektywne opcje.
Create jest jedną operacją obejmującą scaffold i aktywację; tych dwóch mutacji
nie wystawiamy osobno do dowolnego ponawiania. Start/stop są idempotentnymi
operacjami owned site i przyjmują scope/handle bez nowego klucza create.
Snapshot jest append-only: nowy toolExecutionId i creationAttemptId przypisują
pomiar do witryny i jej utworzenia; nie jest to nowa próba delivery_os.
Gotowy journal publikujemy przez atomic rename. Błąd mutacji zachowuje lock
do uzgodnienia, także po niepotwierdzonym stop; nie wykonujemy wtedy auto-startu.
sitesRoot/stateRoot są rozłączne, prywatne i bez symlinków.

Ścieżkę site wylicza host z scope; rezerwacja atomowa w prywatnym stateRoot zawiera
hash żądania i ownership, zapisany przed `studio site create`. Równoległe wywołanie
nie wykonuje drugiego create. Identyczne zakończone żądanie zwraca ten sam rezultat;
inny payload daje konflikt. Niedokończona rezerwacja zwraca reconciliation_required.
Nie wznawiamy skutku automatycznie, nie kasujemy obcych katalogów ani starych witryn.
Przed każdą mutacją sprawdzić ownership, realpath i symlinki, również ścieżki rodziców.
Lokalny dziennik nie jest zamiennikiem rezerwacji/claim w delivery_os.
Wszystkie operacje zmieniające witrynę i captureSnapshot dzielą atomową blokadę
własnej witryny; istniejącej blokady nie przejmujemy na podstawie samego czasu.
Snapshot zatrzymuje działającą witrynę, zamraża motyw i bazę, po czym odtwarza
poprzedni stan uruchomienia. Niepotwierdzone zatrzymanie blokuje snapshot.
Caller nie może jednocześnie uruchamiać zewnętrznych zapisów do plików targetu.

### Commands and evidence

Runner wykonuje tylko argumenty ustalonych operacji Studio/Git przez execFile/spawn
bez powłoki; bounded output, timeout, ograniczone raportowanie błędów. Żadne stdout,
stderr, tokeny ani pola konta nie trafiają do publicznego błędu/manifestu.
Tworzenie używa jawnego `studio site create --runtime sandbox` i flag
`--skip-browser --skip-log-details`; nie zależy od domyślnego runtime CLI.
Nie wyłączać zabezpieczeń CLI, commit hooks ani podpisów Git. Repo tworzyć tylko
w nowym motywie; ewentualny problem Git jest błędem kontroli, nie fikcyjnym SHA.

Każda kontrola ma tool/check ID, wynik passed/failed/not_run, czas i kod błędu
bez raw output. Manifest lokalnego narzędzia ma własne `schemaVersion: 1`,
`provenance: live|fixture`, ownership/correlation, sourceRevision i hashe artefaktów.
Nie udaje jeszcze zaakceptowanego ResultManifest delivery_os. Mapowanie zostanie
podłączone, kiedy wspólne DTO powstaną; brakujące baseline/AC mają być jawne.

Snapshot obejmuje manifest regularnych plików motywu i kopię SQLite wykonaną
przez backup API z WAL. Hashe bazują na rzeczywistych bajtach; manifest określa
algorytm i zakres. Prywatny snapshot danych pozostaje poza repo. Publiczne dowody
nie zawierają rekordów DB ani absolutnych prywatnych ścieżek.
Obsługiwana baza to `wp-content/database/.ht.sqlite`; hashowane są zamrożone
kopie plików oraz backup bazy, nie pliki zmieniające się podczas odczytu.

## Phase 1: Kontrakt i bezpieczne wykonanie narzędzi

### Changes Required

**Files (new):** `packages/delivery-wordpress/{package.json,tsconfig.json,tsconfig.build.json}`,
`src/{contracts,runner,paths,index}.ts`, `src/__tests__/`, wygenerowany wpis workspace w `yarn.lock`.

**Intent:** Zbudować osobny pakiet bez zależności od modułów delivery i starego runtime.
**Contract:** Walidowane wejścia, zaufana konfiguracja, redakcja błędów, ograniczone
procesy i walidacja ścieżek. Publiczny zakres eksportów obejmuje tylko własne narzędzia.
Build używa NodeNext i przepisania względnych rozszerzeń `.ts` do `.js`; smoke
importuje rzeczywisty `dist/index.js`, a nie tylko źródła TypeScript.

### Success Criteria

#### Automated Verification

- Testy runnera odrzucają błędy/timeout bez ujawnienia raw output i wykonują argumenty bez shella.
- Testy kontraktów i ścieżek odrzucają obcy scope, traversal, symlinki i nieznane pola.
- Typecheck i build pakietu przechodzą na udokumentowanej wersji lokalnego toolchainu.

## Phase 2: Nowa witryna i rzeczywisty snapshot

### Changes Required

**Files (new):** `src/{tools,ownership,scaffold,snapshot}.ts`, testy w `src/__tests__/`.

**Intent:** Tworzyć wyłącznie własne nowe witryny, aktywować własny motyw i zbierać dowody.
**Contract:** Trwała rezerwacja przed skutkiem, konflikt na innym payloadzie i obcym
ownership; niepewny create blokuje retry. Status/start/stop dotyczą tylko owned site.
Scaffold stosuje modularne CSS/PHP i standardowe tłumaczenia WP; teksty demonstracyjne
są częścią nowego motywu, nie hardcoded UI OM. Snapshot jest spójny i prywatny.

### Success Criteria

#### Automated Verification

- Testy idempotencji, równoległego create, kolizji katalogu i restartu po niepewnym skutku przechodzą.
- Testy scaffold/aktywacji i snapshotu wykrywają zmianę pliku/danych oraz odrzucają symlinki i sekrety.
- Testy z fałszywym Studio tworzą własne fixture i sprzątają je bez dostępu do istniejących witryn.

## Phase 3: Lokalny caller, live próba i przekazanie

### Changes Required

**Files (new):** `src/{cli,cli-support}.ts`, `README.md`, `hackathon/delivery-demo/wordpress-reuse.md`,
`hackathon/delivery-demo/adapters/wordpress/fixtures/`,
`.ai/specs/2026-09-19-wordpress-studio-tools.md`.

**Intent:** Dostarczyć realny caller i nową witrynę, a autorom OM przekazać gotowy
interfejs, jego ograniczenia i testy. CLI jest lokalnym narzędziem operatora,
nie publicznym endpointem ani gotowym enterprise workerem.
**Contract:** Jeden nowy target w dedykowanym podkatalogu Studio; smoke sprawdza
aktywację motywu, odpowiedź lokalnego HTTP i snapshot. Zachować demonstracyjną
witrynę jako wynik użytkownika; testy automatyczne sprzątają własne fixture.
Świeże dowody mają provenance live; syntetyczne przypadki są oznaczone fixture.
Sprawdzić brak runtime odwołań do starego projektu; test wykona ścieżkę narzędzi
z odmową wszystkich wywołań HTTP do starego serwera. Jeśli serwer już nie działa,
zapisać dodatkowo ten fakt przy live smoke. Nie przerywać cudzych runów dla testu.

### Success Criteria

#### Automated Verification

- Lokalny caller tworzy nową witrynę przez publiczne narzędzia pakietu i weryfikuje aktywny motyw oraz HTTP.
- Powtórzenie tej samej operacji nie tworzy drugiej witryny; manifest zawiera rzeczywiste hashe i jawne pochodzenie.
- Cały zestaw testów, typecheck i build pakietu przechodzi; zapisano dowód niezależności od starego orchestratora.
- Readiness, spec i bezpieczne fixture opisują dostępy oraz brakujące podłączenie do delivery_os/delivery_agents.

#### Manual Verification

- Użytkownik ogląda nową lokalną witrynę i potwierdza przekazanie narzędzi do dalszej integracji OM.

## Testing Strategy

Runner: lokalny — probe compose nie wskazał działającego app. Node native test runner
obejmuje subprocess, pliki, SQLite i fake Studio; to pakiet narzędzi bez tras HTTP/UI OM.
Komendy pakietowe: `npm test`, `npm run typecheck`, `npm run build` z katalogu pakietu.
W razie niepełnej instalacji monorepo wolno użyć odizolowanych zależności developerskich
i zapisać wersje; nie wolno deklarować pełnego gate OM bez jego wykonania.
Brak modyfikacji discovery oznacza brak potrzeby `yarn generate`.
Live smoke uruchamia wyłącznie autoryzowane tworzenie nowego lokalnego targetu.
Publiczne preview/upload nie jest częścią smoke.

## Migration & Backward Compatibility

Nowy pakiet i dokumentacja; brak zmian istniejących API, encji, DI, kolejek,
konfiguracji app i official-modules. Bez migracji bazy OM. Brak nowej produkcyjnej
biblioteki: używamy Node oraz obecnego Zod. Publikacja npm nie jest częścią zadania.
Zakończenie eksperymentu nie usuwa witryny bez ownership; usuwanie demonstracyjnego
wyniku pozostaje osobną operacją operatora.

## Risks & Dependencies

Pełne OM→WP E2E zależy od nieistniejących dziś modułów delivery i nie jest zaliczone
przez CLI. Limit 6 h może zakończyć pracę z blockerem Studio; nie omijamy go
ponownym użyciem starego orchestratora. Timeout po create wymaga ręcznego uzgodnienia.
Pakiet jest narzędziem zaufanego hosta, nie izolacją dowolnego obcego kodu ani SaaS.

## References

- [Research](research.md), [brief](plan-brief.md).
- [Plan nadrzędny](../autonomous-software-delivery/plan.md), WP-M01 i późniejszy WP-M02.
- `BACKWARD_COMPATIBILITY.md`, `AGENTS.md`, `.ai/specs/AGENTS.md`.
- Referencje techniczne wymienione w research; nie są zależnościami pakietu.

## Progress

### Phase 1: Kontrakt i bezpieczne wykonanie narzędzi

#### Automated

- [x] 1.1 Testy runnera odrzucają błędy/timeout bez ujawnienia raw output i wykonują argumenty bez shella.
- [x] 1.2 Testy kontraktów i ścieżek odrzucają obcy scope, traversal, symlinki i nieznane pola.
- [x] 1.3 Typecheck i build pakietu przechodzą na udokumentowanej wersji lokalnego toolchainu.

### Phase 2: Nowa witryna i rzeczywisty snapshot

#### Automated

- [x] 2.1 Testy idempotencji, równoległego create, kolizji katalogu i restartu po niepewnym skutku przechodzą.
- [x] 2.2 Testy scaffold/aktywacji i snapshotu wykrywają zmianę pliku/danych oraz odrzucają symlinki i sekrety.
- [x] 2.3 Testy z fałszywym Studio tworzą własne fixture i sprzątają je bez dostępu do istniejących witryn.

### Phase 3: Lokalny caller, live próba i przekazanie

#### Automated

- [x] 3.1 Lokalny caller tworzy nową witrynę przez publiczne narzędzia pakietu i weryfikuje aktywny motyw oraz HTTP.
- [x] 3.2 Powtórzenie tej samej operacji nie tworzy drugiej witryny; manifest zawiera rzeczywiste hashe i jawne pochodzenie.
- [x] 3.3 Cały zestaw testów, typecheck i build pakietu przechodzi; zapisano dowód niezależności od starego orchestratora.
- [x] 3.4 Readiness, spec i bezpieczne fixture opisują dostępy oraz brakujące podłączenie do delivery_os/delivery_agents.

#### Manual

- [ ] 3.5 Użytkownik ogląda nową lokalną witrynę i potwierdza przekazanie narzędzi do dalszej integracji OM.
