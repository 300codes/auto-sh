# UI-06 — domknięcie raportu, próba obu wejść i demonstracja — Implementation Plan

> Data: 2026-09-19. Status: planned. Dokument nie potwierdza implementacji ani odbioru.
> [Brief](plan-brief.md) · [zadanie UI-06](../03-design-ui.md#ui-06--próba-obu-wejść-i-demonstracja) · [README strumieni](../README.md).
> Pierwszeństwo produktowe: [dodatek z 2026-09-19](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) i [aktualny podział zespołu](../../flow-handoff/README.md).

## Overview

Domknąć klienta raportu UI-05 po dostawie zależności OSS, usunąć potwierdzone błędy UX i przeprowadzić obie ścieżki wejścia. Główna próba oraz prezentacja prowadzą fikcyjny projekt od briefu do rzeczywistego wdrożenia WordPress i osobnego odbioru. Podczas prezentacji agent tworzy od zera cały UX → Key Visual → Design System/UI, a operator zapisuje osobne decyzje dla aktualnych wersji.

To plan prac UI oraz współodbioru. Backend, wykonanie, provider komentarzy, ustawienia procesu i narzędzia WP mają swoich właścicieli w F0–F4. Nie zamieniamy brakujących dostaw w dodatkowe zadania implementacyjne UI-06 bez uzgodnienia zakresu.

## Current State Analysis

Ścieżki modułowe poniżej są względne wobec `packages/core/src/modules/delivery_os/`. Stan odczytano z kodu i handoffów; nie uruchamiano runtime, integracji ani usług zewnętrznych podczas planowania.

| Obszar | Stan i znaczenie dla UI-06 |
|---|---|
| UI-03 | Import wymagań/planu, renderów, wersji baseline i decyzji v1 jest dostarczony. Handoff nie potwierdza wykonania TC-DELIVERY-UI-003 ani ręcznej próby. Uwagi w OM nie dowodzą pobierania rzeczywistych komentarzy Figmy. |
| UI-04 | Widok prób, rezerwacja, import, cancel/reconcile i manual_handoff są dostarczone. TC-DELIVERY-UI-004 i kontrole przeglądarkowe pozostały niewykonane według handoffu. Fixture nakładających się prób nie dowodzi dwóch runów live. |
| UI-05 | Istnieje server route raportu i klient v1 z testami. `EvidenceSources.tsx:11` i `EvidenceDetailDialog.tsx:20` pokazują brak API. `ReleaseDecisionActions.tsx:24–25` ma wyłączone przyciski. |
| D1 | `api/projects/[id]/evidence/route.ts:27–31` udostępnia wyłącznie POST. Lista/szczegóły źródeł i autoryzowany dostęp do powiązanych plików wymagają dostawy OSS. |
| D2 | `commands/reportQueries.ts:24` zwraca `DeliveryReportV1`; `:113–150` buduje raport v1. `commands/decisions.ts:177–189,350–372` sprawdza dotychczasowe gates, nie pełne etapowe zgody. Typ rozszerzenia nie oznacza gotowego runtime. |
| D3 | Brak odczytu wskazania aktualnego kandydata odbiorowego i jego wersji w sprawdzonych call sites raportu/decyzji. Latest-result jest podglądem, nie finalną rewizją integracyjną. |
| Odczyt UI | `components/report/useDeliveryReport.ts:74` parsuje tylko v1; istnieją zabezpieczenia scope, historii i pollingu, które trzeba zachować podczas integracji. |
| Nowy proces | Dodatek wymaga WordPress E2E, odrębnych zgód, Figma → staff Kanban i wersji procesu w Workflows Studio. UI-03–05 samodzielnie nie dowodzą gotowości F0–F4. |
| Gate i środowisko | Handoffy opisują pominięte pełne kontrole oraz historyczne problemy środowiska. Readiness trzeba sprawdzić ponownie; nie przenosić tych obserwacji jako aktualnego stanu bazy ani zgody na pomijanie testów. |

Źródła szczegółowe: [UI-03 handoff](../ui-03/handoff.md), [UI-04 handoff](../ui-04/handoff.md), [UI-05 handoff](../ui-05/handoff.md), [D1–D3](../ui-05/oss-dependencies.md). Niezależny podagent potwierdził pierwszeństwo dodatku i utrzymanie braków D1–D3 w sprawdzonych call sites.

## Desired End State

Operator otwiera źródłowe dowody i załączniki, rozpoznaje bieżący baseline oraz wskazaną rewizję odbiorową, widzi bramki etapów i osobno podejmuje decyzję deploy/release. Stare, brakujące i niewykonane kontrole pozostają widoczne; raport nie nadaje im PASS.

Wcześniejsza pełna próba dostarcza dowodów poprawnego procesu. Następnie podczas prezentacji agent ponownie tworzy cały design od zera dla nowego projektu demonstracyjnego; zgody, wykonanie WP i wynik odnoszą się do tego nowego przebiegu. FROM_DESIGN jest odrębnym sprawdzeniem importu zatwierdzonych ekranów i ręcznych AC do zatwierdzonego baseline.

### Decyzje użytkownika

| Decyzja | Przyjęty wariant |
|---|---|
| Zakres UI-06 | Także domknięcie klienta UI-05 po dostawie D1–D3; backend pozostaje własnością OSS. |
| Materiał demo | Nowy projekt fikcyjnego klienta, realistyczny brief i treści. |
| FROM_DESIGN | Import istniejącego designu i ręcznych AC do zatwierdzonego baseline; bez drugiego pełnego WP E2E. |
| Awaria podczas pokazu | Działająca część live i pozostałe materiały jawnie jako replay; pełny odbiór pozostaje zablokowany. |
| Generowanie podczas prezentacji | Cały UX → KV → DS/UI od zera live, z wszystkimi wymaganymi zgodami. |
| Fazy | Gotowość → domknięcie UI-05 → stabilizacja i pełna próba → prezentacja i przekazanie. |

## What We're NOT Doing

- Nie implementujemy backendowych D1–D3, nowego lifecycle, providerów wykonania, brakującego wizarda, sync Figmy ani buildera w ramach tego zadania. Ich implementacja pozostaje w pakietach F0–F4; UI-06 konsumuje gotowe funkcje i zgłasza blockery.
- Nie reinterpretujemy pojedynczej zgody v1 `design` jako UX/KV/DS/UI i nie tworzymy frontendowych DTO zastępujących kontrakty OSS.
- Nie zastępujemy WP publikacją React, lokalnym Studio, snapshotem ani historycznym URL. React/OM i legacy v1 pozostają chronione regresją.
- Nie dodajemy selektora dowolnej rewizji, eksportu PDF, nowego Kanbana, edytora grafu ani zmian DS platformy.
- Nie wykonujemy automatycznych zakupów, migracji lokalnej bazy, publikacji produkcyjnej, push/PR/Issues/etykiet. Wykonanie live korzysta z uzgodnionych dostępów i osobnej zgody publikacji konkretnej rewizji/celu.
- Nie przenosimy starego PASS po zmianie kodu lub designu i nie traktujemy materiału replay jako wyniku obecnej próby.

## Implementation Approach

Rozszerzyć istniejące client islands raportu zamiast tworzyć drugi ekran. D1 dostarcza źródła i załączniki; D2 identyfikuje legacy/flow oraz projekcję i serwerowe bramki; D3 wskazuje finalną rewizję. Odbiór każdego kontraktu wymaga SHA dostawcy, schema/fixture, rzeczywistego endpointu i testów, nie samego typu TypeScript.

Prace nad briefem, runbookiem i regresjami mogą ruszyć niezależnie. Integracja mutacji czeka na komplet wymaganych dostaw. Brak zależności blokuje odpowiednie kryterium, nie cały możliwy research czy przygotowanie testów. Testy funkcji powstają razem ze zmianą.

### Własność i zależności

| Właściciel | Dostawa / granica |
|---|---|
| UI / Adam | `backend/`, `components/`, `i18n/`; poprawki własnych powierzchni, klient raportu, materiały lokalne `workstreams/ui-06/`, design i przekazanie tokenów. |
| OSS / Mateusz | `api/`, `commands/`, `data/`, publiczne `lib/contracts`, spec OSS i rejestry; D1–D3, etapowe zgody i prawda domenowa. UI przekazuje potrzeby/patch, nie edytuje ich jednostronnie. |
| EXEC / Marcin | Workflow, agent scoping, wykonanie, recovery, ustawienia procesu i enterprise. |
| WP / Michał | Narzędzia Studio, nowa witryna, mapowanie tokenów, publikacja i walidacja WP. |
| QA / Michał i autorzy funkcji | Integracje `__integration__/TC-DELIVERY-*`, finalny gate oraz `hackathon/delivery-demo/{runbook,acceptance,evidence-index}.md`. UI dostarcza uzgodniony patch zamiast równoległej edycji wspólnych plików. |
| Operator / odbierający | Osobne decyzje aktualnych wersji. Przy fikcyjnym kliencie jawnie zapisana rola symulowanego klienta; bez twierdzenia o zgodzie rzeczywistej firmy. |

Wymagania D1–D3 pozostają w [dokumencie właściciela potrzeb UI-05](../ui-05/oss-dependencies.md). Nie tworzymy konkurencyjnej specyfikacji API. Ustawienia, komentarze oraz odrębne zgody muszą spełnić [pakiet UI](../../flow-handoff/03-adam-ui-figma.md) i FLOW-01…09 przed pełnym odbiorem demo.

## Critical Implementation Details

### Przedmiot decyzji i wyścigi

Przed otwarciem formularza oraz każdym submit/guarded retry odczytać świeży projekt, raport i kandydata D3. Przypiąć baseline/hash, sourceRevision, wersję kandydata, projectUpdatedAt, aktualne dowody/gate oraz dla release deploymentEvidenceId. Zmiana któregokolwiek przedmiotu unieważnia potwierdzenie; zachować powód, lecz wymagać ponownego przeglądu. Evidence może zmienić się bez zmiany projectUpdatedAt. Serwer pozostaje ostatecznym strażnikiem, preflight klienta nie zapewnia atomowości.

### Nowy design podczas prezentacji

Próba i prezentacja mają różne project/run/artifact refs. Nowe snapshoty wymagają nowych zgód oraz wykonania i testów na ich podstawie; gotowy WP z próby można pokazać tylko jako replay. Oczekiwanie na człowieka nie kończy się automatyczną akceptacją. Timeout usługi oznacza blocker/reconcile, nie zgodę na powtórzenie efektu w ciemno.

## Phase 1: Scenariusz i gotowość

### Overview

Przygotować powtarzalny scenariusz, rozdział ról i mierzalne warunki rozpoczęcia integracji oraz live. Dokumentacja może powstać przed D1–D3.

### Changes Required

#### 1. Brief i przebiegi

**Files:** nowe `workstreams/ui-06/demo-scenario.md`, `readiness.md`.

**Intent:** Opisać konkretny materiał próby i uporządkować bramki bez tworzenia drugiej checklisty odbioru.

**Contract:** Fikcyjna firma „Pracownia Forma”, mała witryna usługowa PL/EN: strona główna z usługami i CTA oraz kontakt. Treści, zdjęcia demonstracyjne o znanym pochodzeniu, nagłówki, menu, stopka i SEO są edytowalne w WP. CTA prowadzi do kontaktu; nie dodawać CRM, płatności ani wysyłki formularza bez wymagania. Scoping agenta proponuje kompletne AC i wybór WP/Figma; człowiek zatwierdza. Design obejmuje desktop/mobile i potrzebne stany obu ekranów. FROM_DESIGN używa zatwierdzonych artefaktów wcześniejszej próby i ręcznych AC w oddzielnym projekcie, bez reverse specification. Dla projektu nowego flow respektuje wymagane etapowe zgody; nie obchodzi ich decyzjami v1.

#### 2. Przyjęcie dostaw i środowiska

**Files:** `workstreams/ui-06/readiness.md`; propozycja zmian wspólnego runbooka dla QA.

**Intent:** Udokumentować faktyczne dostawy i operacyjne blockery przed integracją oraz prezentacją.

**Contract:** Tabela faktów bez checkboxów: owner, commit, schema/profile/fixture version, wynik testów, dowód, ograniczenia. Osobne readiness write/read/render Figmy i realnych komentarzy; sesja operatora; dostęp klientowski jako symulacja; istniejące środowisko QA, aktywne moduły/ACL; D1–D3; F0–F4; cel publikacji WP; zgodność WP/PHP/Tailwind/Yoast/ACF Pro/Polylang i dostęp do wymaganych licencji bez sekretów. Brak dostawy ma wskazanego właściciela i warunek odblokowania. Nie wpisywać fikcyjnego URL ani deklarować gotowej sesji na podstawie historycznego probe.

### Success Criteria

#### Automated Verification

- Pliki scenariusza i readiness mają poprawne linki; wskazane API/schema i pliki testów istnieją albo są jawnie oznaczone jako dostawa oczekiwana, nie implementacja.
- Przyjęcie D1–D3 obejmuje zgodne fixture/schema i wyniki testów dostawcy, w tym odmowę decyzji bez aktualnych etapowych zgód oraz brak podmiany kandydata późniejszym wynikiem taska.

#### Manual Verification

- QA/operator potwierdzają fikcyjny brief, role i warunki próby; dostęp Figmy, komentarzy i celu WP jest sprawdzony lub pozostaje blockerem live.

## Phase 2: Domknięcie klienta UI-05

### Overview

Podłączyć rzeczywiste źródła, flow i kandydata, następnie bezpieczne formularze decyzji. Nie usuwać obecnych blokad przed przyjęciem odpowiednich API.

### Changes Required

#### 1. Lista źródeł i załączniki D1

**Files:** `components/report/EvidenceSources.tsx`, `EvidenceDetailDialog.tsx`, `DeliveryReport.tsx`; nowe `useEvidenceDetail.ts` i niewielki hook listy, jeśli potrzebny; `components/report/__tests__/evidenceDetail.test.tsx`, `evidenceTable.test.tsx`; `i18n/{en,pl,de,es,ko}.json`.

**Intent:** Zastąpić komunikaty niedostępności realnym odczytem rekordu, screenshotów i dostępnych plików.

**Contract:** Opublikowane schema D1, `apiCall`, paginacja do 100 i brak N+1. Odczyt kluczowany tenant/org/project/baseline/revision/evidence; zmiana scope czyści poprzedni wynik i ignoruje spóźnione odpowiedzi. Screenshoty baseline bez rewizji mają osobną grupę i nie dowodzą konkretnego buildu. Załączniki przez istniejący autoryzowany mechanizm, bez nieprzejrzanego HTML i rekonstrukcji treści z hasha. Osobne stany brak API, brak rekordu/pliku, odmowa i błąd; Escape i powrót fokusu.

#### 2. Projekcja procesu i rewizja odbiorowa D2/D3

**Files:** `components/report/useDeliveryReport.ts`, `reportView.ts`, `ReportSummary.tsx`, `DecisionHistory.tsx`, `DeploymentSummary.tsx`; istniejące testy hooka/helpers/strony i locale.

**Intent:** Oprzeć bieżący raport na zatwierdzonym wskazaniu rewizji i pokazać rzeczywiste bramki nowego procesu.

**Contract:** Parser dostawcy zachowuje rozszerzenie flow i zgodność v1. Brak flow nie jest domyślnym dowodem legacy. Latest-result może pozostać nazwanym podglądem bez aprobaty. Kandydat B nie zmienia się na późniejszy wynik taska C. Historia pozostaje readonly i przypina baseline/revision. Gate flow jest odrębny od v1; frontend nie wylicza pełnego FLOW/WP PASS z niepełnego profilu. Zachować scope guards, jeden odczyt naraz, visibility/backoff i jawne stale dane.

#### 3. Deploy i release

**Files:** `components/report/ReleaseDecisionActions.tsx`; nowe `ReleaseDecisionDialog.tsx`, `decisionInput.ts`; `__tests__/releaseDecisions.test.tsx`; `DeliveryReport.tsx`, locale.

**Intent:** Włączyć osobne decyzje dopiero po przyjęciu D2/D3, z jednoznacznym przedmiotem i kontrolą konfliktu.

**Contract:** Istniejące endpointy deploy/release oraz opublikowane uzupełnienia dostawcy; nie zgadywać nowych payloadów. `CrudForm` embedded, shared DS, i18n, wildcard ACL, guarded mutation/context retryLastMutation i scoped optimistic header projektu. Następna operacja używa zweryfikowanego projectUpdatedAt z odpowiedzi. Historia/archiwum bez mutacji. Akceptacja wymaga świeżych danych, właściwego kandydata/gate; odrzucenie wymaga powodu i rzeczywistego przedmiotu, nawet przy czerwonym gate. Brak wiarygodnego D2/D3 nie włącza również odrzucania.

409 wymaga ponownego przeglądu i `surfaceRecordConflict` dla konfliktu rekordu; 422 pokazuje nazwane blokery, 428 nie jest sukcesem. Timeout/nieczytelna odpowiedź po POST powoduje odczyt historii i wersji, bez automatycznego ponowienia append-only decyzji. Cmd/Ctrl+Enter zatwierdza, Escape anuluje, podwójny submit jest zablokowany. Zgoda nie wywołuje executora ani publikacji z klienta.

#### 4. Integracje dostarczane razem z funkcją

**File:** `__integration__/TC-DELIVERY-UI-005.spec.ts`, w uzgodnieniu z QA.

**Intent:** Zastąpić blokady/skips D1–D3 rzeczywistymi testami po dostawie, zachowując dotychczasowe scenariusze.

**Contract:** Własne projekty, załączniki, baseline i evidence; cleanup po własnych ID. Test source → screenshot → kandydat → deploy → deployment evidence → verify → release oraz negatywne ACL/scope/stale stage/candidate. Nie wpisywać arbitralnych endpointów ani wyłączać testu tylko po to, by raport był zielony. Test z kontrolowanym adapterem nie zalicza publikacji live.

### Success Criteria

#### Automated Verification

- Testy komponentowe i TC-DELIVERY-UI-005 potwierdzają realny D1, oddzielne bramki D2 oraz kandydat A/B/C i snapshot WP; fixture nie zastępuje integracji API.
- Testy decyzji obejmują osobne/wildcard ACL, zmianę evidence bez projectUpdatedAt, zmianę kandydata/etapu, guarded retry, 409/422/428 i niepewny POST bez duplikacji.
- Typecheck, i18n, lint zmienionych plików i check:client-boundaries przechodzą; brak nowych client page roots, globalnego SDK i nieuzasadnionych client blobów ponad 300 LOC.

#### Manual Verification

- Operator otwiera screenshot i źródło, rozpoznaje historię, zatwierdza publikację, a po zweryfikowanym deployment evidence osobno odbiera wydanie; konflikt nie nadpisuje decyzji.

## Phase 3: Stabilizacja i pełna próba

### Overview

Poprawić udokumentowane błędy UX, wykonać regresje i pełną próbę na nowym projekcie. Nie dopisywać nowych funkcji po freeze pod nazwą naprawy.

### Changes Required

#### 1. Naprawy wynikające z QA

**Files:** konkretne pliki `backend/`, `components/detail/`, `components/task/`, `components/report/`, locale i odpowiadające testy; lista ustalana wyłącznie z odtworzonych findingów w `workstreams/ui-06/handoff.md`.

**Intent:** Usunąć błędy blokujące nawigację, czytelność stanu, klawiaturę, mobile, hydration i obsługę konfliktów bez spekulacyjnego refaktoru.

**Contract:** Każdy finding ma kroki reprodukcji, plik/właściciela, wpływ, poprawkę i dowód ponownego testu. Błąd backendu/enterprise/WP trafia do właściciela. Każda poprawka zachowuje API helpers, guarded mutations, i18n i DS; dotknięte status colors migrują na tokeny. Brak rekordu korzysta ze wspólnego stanu not-found zgodnie z aktualnymi zasadami UI. Nowy route, jeśli okaże się konieczny i zostanie uzgodniony, wymaga server root, generacji i hydration smoke.

#### 2. Regresje obu wejść i raportu

**Files:** `__integration__/TC-DELIVERY-UI-003.spec.ts`, `TC-DELIVERY-UI-004.spec.ts`, `TC-DELIVERY-UI-005.spec.ts`; dodatkowy `TC-DELIVERY-UI-006.spec.ts` tylko dla brakującego scenariusza przekrojowego, w uzgodnieniu z QA.

**Intent:** Wykazać spójny przepływ przez prawdziwe API, działanie OSS-only i brak regresji bezpieczeństwa/wersji.

**Contract:** FROM_DESIGN z ręcznymi AC do aktualnego zatwierdzonego baseline; FROM_BRIEF przez nowy flow na kontrolowanych adapterach w zwykłym CI. Własne fixture, dwa scope i rozdzielone ACL, cleanup. Pokrycie stale approvals, błędnych manifestów, manual_handoff, unknown/stop_unconfirmed, braku security check i niezweryfikowanego deploymentu. Testy duplikatu callbacku/restartu pozostają po stronie OSS/EXEC, UI konsumuje i pokazuje ich wynik; nie tworzymy publicznego callbacku klienta.

#### 3. Pełna próba z QA

**Files:** `workstreams/ui-06/rehearsal.md`, `handoff.md`; patch scenariusza i wyników do wspólnych dokumentów QA.

**Intent:** Zmierzyć rzeczywisty czas, sprawdzić wszystkie zależności i zebrać świeże dowody przed publicznym pokazem.

**Contract:** Pełna sekwencja opisana w fazie 4 na oddzielnym nowym projekcie. Zapis SHA platformy oraz osobno rewizji/snapshotu generowanej witryny, wersji profili/kontraktów, zgód, hashów, czasu i wyników. Testy po poprawce dotyczą finalnej rewizji; stare raporty pozostają historyczne. QA wykonuje gate według aktualnej konfiguracji; niewykonana komenda pozostaje not_run.

### Success Criteria

#### Automated Verification

- Właściwe testy komponentów oraz TC-DELIVERY-UI-003/004/005 i ewentualny UI-006 przechodzą na końcowym stanie; self-contained fixture nie wymaga sekretów live.
- QA dostarcza finalne wyniki OSS-only, tenant/org/ACL, stale approval, duplicate/restart/manual_handoff, pełnego gate i testów AC dla właściwych rewizji. Każdy brak pozostaje nazwany.
- Hydration smoke istniejących dotkniętych routów i build/bundle mają zapisany wynik; po poprawkach wykonano ponownie dotknięte kontrole.

#### Manual Verification

- FROM_DESIGN kończy się zatwierdzonym baseline, FROM_BRIEF rzeczywistym WP z poprawką, QA, publikacją i raportem. Desktop/mobile, klawiatura i dostęp do źródeł zostały sprawdzone.
- Próba dostarcza zmierzonego czasu live designu i oczekiwania na zgody; QA/odbierający potwierdzają gotowość albo zapisują konkretne blockery.

## Phase 4: Pełny design live i przekazanie

### Overview

Przeprowadzić pokaz na nowym projekcie, bez przejmowania zgód i wyników wcześniejszej próby. Materiały replay pozostają oddzielnie oznaczone.

### Changes Required

#### 1. Przebieg demonstracji

**Files:** `workstreams/ui-06/demo-scenario.md`, `rehearsal.md`, `handoff.md`; wspólny runbook/evidence-index/acceptance aktualizuje QA na podstawie przekazania UI.

**Intent:** Umożliwić operatorowi i odbierającemu przejście przez wymagany proces oraz odróżnienie aktualnego wyniku od historii.

**Contract:** Następujący porządek jest warunkiem odbioru:

1. W wydzielonym pustym portfolio demonstracyjnym utworzyć nowy projekt fikcyjnego klienta, zapisać i wznowić brief. Nie usuwać istniejących projektów użytkownika.
2. Agent doprecyzowuje Scope i rekomenduje narzędzia; człowiek potwierdza WordPress/Figma i aktualny Scope.
3. Agent tworzy nowy UX w Figmie. Rzeczywisty komentarz i odpowiedź trafiają po synchronizacji do jednej karty i komentarza natywnego staff Kanbana; retry nie duplikuje. Agent poprawia UX, powstaje nowy snapshot/bytes/hash, człowiek zatwierdza wersję. Done/resolve nie jest approval.
4. Agent tworzy Key Visual od zera na zatwierdzonym UX. Operator zapisuje oddzielną zgodę symulowanego klienta, wskazując osobę i dowód tej decyzji.
5. Agent tworzy DS/UI od zera z zatwierdzonego UX/KV: tokeny, komponenty/stany i ekrany responsywne. Powstaje oddzielnie zatwierdzony pakiet DS/UI. Tokeny mają file/node/version/hash i mapowanie; macierz ekran/sekcja → blok/pole WP → miejsce edycji → tłumaczenie → test trafia do Michała.
6. EXEC/WP wykonują zaakceptowany pakiet w nowej witrynie. Niezależny review prowadzi do rzeczywistej poprawki i ponownej weryfikacji końcowej rewizji. UI pokazuje pochodzenie automatic/manual_handoff i nieznane usage bez fikcyjnej automatyzacji.
7. QA sprawdza FLOW/WP, Tailwind/theme.json, natywny edytowalny WP, Yoast/ACF Pro/Polylang, edycję treści/sekcji/menu/SEO w dwóch językach oraz zachowanie zmian po redeploy. Tokeny designu i frontend/edytor są spójne; samo obejrzenie screenshotu nie dowodzi tych kontroli.
8. Raport wskazuje kandydata finalnej rewizji. Człowiek udziela zgody na publikację uzgodnionego celu; WP/QA publikują i weryfikują URL/build/snapshot. Dopiero potem operator zapisuje osobny release verdict.
9. Osobno pokazać wersjonowanie procesu w istniejącym Workflows Studio: zmiana grafu i warunku, publikacja v2, nowy projekt v2 i poprzedni na v1 także po restarcie. Ten test współprowadzi właściciel workflow.
10. Pokazać wynik oddzielnej próby FROM_DESIGN do baseline, jasno wskazując kiedy go wykonano. Odbierający zapisuje verdict oraz pozostałe niewykonane wymagania.

Przy niedostępnym dostępie/API zatrzymać zależne operacje, zapisać etap i blocker. Pokazać dostępny fragment live oraz wcześniejsze materiały z widocznym oznaczeniem „replay”, identyfikatorem i czasem wcześniejszej próby. Nie odtwarzać starego WP jako wyniku nowego designu. Nieprzeprowadzone etapy pozostają blocked/not_run, pełny odbiór jest niespełniony; ponowna próba po usunięciu przyczyny wraca do właściwych aktualnych wersji i zgód.

#### 2. Dowody i przekazanie

**File:** `workstreams/ui-06/handoff.md`; referencje do kanonicznego indeksu QA.

**Intent:** Pozostawić jednoznaczny wynik techniczny i manualny bez duplikowania rejestru odbioru.

**Contract:** SHA platformy, lista zmienionych plików, schema/profile/fixture versions, project/baseline/artifact refs, sourceRevision witryny, test IDs/komendy/exit codes/runner, daty, hashe surowych dowodów, live/replay/fixture i ograniczenia. Brak tokenów, licencji i sekretów. Jedna osoba wskazana przez zespół aktualizuje nadrzędny Progress po dowodach wszystkich właścicieli; manualne wyniki wymagają potwierdzenia człowieka.

### Success Criteria

#### Automated Verification

- Zachowane artefakty mają istniejące referencje i weryfikowalne hashe; design, wyniki testów, zgody i deployment korelują do aktualnego projektu/baseline/rewizji. Do renderów użyć istniejącego capture/verify UI-01 po sprawdzeniu jego bieżącego kontraktu.
- Raport prezentacji nie zalicza wcześniejszego wyniku, not_run ani brakującego FLOW/WP jako PASS; QA dostarcza indeks wyników końcowej wersji.

#### Manual Verification

- Publiczność i odbierający widzą cały UX → KV → DS/UI utworzony od zera live, poprawkę i osobne zgody; gotowy design ani replay nie zastępują tej pozycji.
- Operator przechodzi do działającego WP URL i źródłowych dowodów oraz osobno zapisuje release; częściowy pokaz jest opisany jako niepełny odbiór.
- Zespół zna role, manual_handoff i fallback replay; odbierający zapisuje końcowy verdict z niespełnionymi kryteriami.

## Testing Strategy

Przy implementacji wybrać runner raz na sekwencję według `.ai/docs/agent-instructions.md`: `DOCKER_COMPOSE_FILE` lub pierwszy działający compose app → Docker; w przeciwnym razie local. W Docker `yarn X` zastępuje `node scripts/docker-exec.mjs X`. Najpierw sprawdzić `.ai/qa/ephemeral-env.json` i reuse środowiska. Obecne planowanie używa tylko lokalnych odczytów i kontroli dokumentów; nie potwierdza gotowości aplikacji/bazy.

Kontrole przyrostowe:

```bash
yarn workspace @open-mercato/core test --runInBand --testPathPatterns='delivery_os/components/report|delivery_os/components/detail|delivery_os/components/task|delivery_os/backend/delivery/projects'
yarn check:client-boundaries
yarn i18n:check-hardcoded
yarn i18n:check-values
yarn test:integration --grep 'TC-DELIVERY-UI-00[3456]'
```

Zakres rozszerzyć o konkretne testy zmienionych call sites. Lint uruchomić dla zmienionych plików zgodnie z konfiguracją repo. Typy i build obejmuje gate poniżej. Generacja jest obowiązkowa przy zmianach auto-discovery; UI-06 nie planuje nowego routa. QA uruchamia również integracje OSS/EXEC i testy FLOW/WP pod ich rzeczywistymi nazwami po dostawie, nie przez wymyślony grep.

Pełny gate odbiorowy według `.ai/agentic.config.json` w chwili planowania:

```bash
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
yarn test:integration --grep 'TC-DELIVERY'
```

Pierwsze osiem poleceń to uporządkowany gate repo; ostatnie jest dodatkową integracją. QA zapisuje runner, SHA i rezultaty. Dawne wyjątki w handoffach nie stanowią zgody na pominięcie tych kontroli w UI-06. Nie uruchamiać live Figma/WP w zwykłym CI wymagającym cudzych sekretów; kontrolowane adaptery dowodzą zachowania, jawna próba dowodzi usług live. Brak środowiska/migracji zapisuje blocker; lokalne zastosowanie migracji wymaga osobnej zgody.

Macierz regresji obejmuje: D1 403/404 i obce attachment IDs; źródła bez rewizji; brak/stary stage approval; brak/zmianę kandydata; snapshot WP bez fikcyjnego git SHA; timeout POST; historię readonly; utratę scope; unknown usage; brak skanu; upload bez verify; retry komentarzy bez duplikacji i Done bez approval. Stan niepewnego zatrzymania nie dopuszcza nowej próby. Dowody retry/restart są dostarczane z warstwy odpowiedzialnej za wykonanie.

## Performance Considerations

Zachować pojedynczą pętlę raportu na widok, backoff i wstrzymanie w ukrytej karcie; szczegóły/obrazy na żądanie. Strona tabeli 50, maksymalnie 100. Nie dodawać globalnego SDK Figmy ani cache między scope. Zmierzyć odczyt, hydration/build oraz czas pełnego designu podczas próby; nie deklarować SLA z samych timerów. Limity usług sprawdzać na stanowisku przed live, nie zakładać aktualności historycznych limitów UI-01.

## Migration & Backward Compatibility

UI-06 nie zmienia schema DB, publicznych DTO v1, event IDs, ACL ani routów. Konsumuje addytywne kontrakty OSS po BC review dostawcy. Legacy FROM_DESIGN, ręczna domena OSS-only i raporty historyczne pozostają dostępne. Wycofanie poprawek UI nie usuwa evidence, zgód ani projektów. Generatorów nie edytujemy ręcznie. Nie włączamy etapowych mutacji bez ochrony backendu również przed legacy API.

## Nakład i warunki rozpoczęcia

Orientacyjny nowy nakład UI: **16–24 h aktywnej pracy**, do kalibracji w fazie 1: gotowość 2–3 h, domknięcie raportu 6–9 h, stabilizacja/próba 5–7 h, prezentacja/handoff 3–5 h. To estymata zakresu, nie potwierdzony budżet ani gwarancja terminu. Nie obejmuje implementacji D1–D3, pozostałych F0–F4, pracy innych właścicieli ani nieprzewidywalnego oczekiwania na API/generacje/zgody. Czas kalendarzowy prezentacji ustalić na podstawie zmierzonej pełnej próby; nie skracać jej niejawnie do jednego ekranu.

Historyczne H30–32/H34–36 i 4 h UI-06 nie wyceniają rozszerzonego zadania. Przed zobowiązaniem harmonogramowym zespół akceptuje nowy przydział; brak czasu daje blocker/przeplanowanie, nie usunięcie wymagania. Faza 1 i niezależne regresje mogą ruszyć od razu; integracja fazy 2 wymaga API, pełna próba i live wymagają F0–F4, dostępów i odbierającego.

## Risks & Assumptions

| Ryzyko | Ustalona reakcja |
|---|---|
| D1–D3 opóźnione lub tylko na fixture | Zachować jawne blokady, kontynuować niezależne przygotowanie, odebrać realny kontrakt przed mutacjami. |
| Nowe funkcje procesu niegotowe | Właściciel F0–F4 dostarcza brak; UI-06 nie przejmuje implementacji ani nie zalicza pełnego demo. |
| Nowy design live różni się od próby | Nowe snapshoty, zgody, wykonanie i QA; poprzednia witryna tylko replay. |
| Brak sesji, komentarzy, licencji lub publikacji | Oznaczony częściowy pokaz i ponowna próba po usunięciu przyczyny. |
| Późniejszy wynik taska zmienia raport | D3 przypina kandydata; backend i formularz odrzucają nieaktualny przedmiot. |
| Niepełne testy po poprawce | Unieważnić dotknięte wcześniejsze wyniki i powtórzyć walidację właściwej rewizji. |

Wybory produktowe są rozstrzygnięte. Dane operacyjne (konto/pliki/URL/konkretny odbierający) są rezultatami readiness o opisanej bramce, nie założeniami o istniejących dostępach. Szczegóły request/response D1–D3 dostarcza OSS; ich brak nie upoważnia klienta do zgadywania kontraktu.

## References

- [README — harmonogram, własność i odbiór](../README.md), zwłaszcza pierwszeństwo dodatku i zakaz drugiej checklisty.
- [UI-06](../03-design-ui.md), [QA-06](../04-quality-preview.md), [plan główny](../../plan.md), [research historyczny](../../research.md).
- [Plan UI-05](../ui-05/plan.md), [jego handoff](../ui-05/handoff.md) i [zależności D1–D3](../ui-05/oss-dependencies.md).
- [Dodatek](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md), [pakiet UI](../../flow-handoff/03-adam-ui-figma.md), [pakiet zespołu](../../flow-handoff/README.md).
- `.ai/specs/2026-09-18-delivery-os-hackathon.md`: F15 i Frontend Architecture Contract; `.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md`: własność wykonania.
- `packages/core/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`, `.ai/qa/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/docs/agent-instructions.md`, `.ai/agentic.config.json`.

## Progress — odwołanie do rejestru kanonicznego

Zgodnie z README nie tworzymy drugiej checklisty. Żadne kryterium nie zostaje zaliczone przez zapis tego planu. Kryteria faz powyżej są instrukcją weryfikacji; stan odbioru prowadzi wyłącznie [Progress planu głównego](../../plan.md#progress), z uwzględnieniem pierwszeństwa dodatku.

| Kryterium | Wkład UI-06 | Pozostały współodbiór |
|---|---|---|
| 5.1, 5.4 / FLOW-07 | Domknięcie źródeł raportu, rewizji, decyzji i ich UI testów | D1–D3 OSS, WP publikacja i QA, człowiek. |
| 6.2 | Regresje wejść, stale approvals, manual_handoff i widoczne stany niepewności | OSS/EXEC dowodzą duplicate/restart/izolacji; QA integruje wyniki. |
| 6.4 | Oba wejścia, cały nowy design live, poprawka i raport | Aktualny główny odbiór to WP E2E według dodatku; stary zapis React nie zastępuje go. |
| 6.5 | Role, fallback, ograniczenia i końcowy handoff | Verdict zapisuje obecny odbierający. |
| 6.1, 6.3 | Testy i dowody zmian UI na końcowym SHA | Pełny gate i komplet AC prowadzi QA z wszystkimi właścicielami. |
| FLOW-01…09, WP-01…05 | UI pokazuje rzeczywisty proces; współodbiera m.in. tokeny/edycję WP-02/04/05 | Wszystkie wymagania pozostają warunkiem pełnego PASS; żaden lokalny wynik UI-06 nie zamyka ich sam. |

Nowych wymagań FLOW/WP nie ukrywać pod starym checkboxem. QA wiąże dowody z ID dodatku w istniejącym indeksie, a wyznaczony właściciel prowadzi wspólny odbiór bez konkurencyjnego lokalnego rejestru.
