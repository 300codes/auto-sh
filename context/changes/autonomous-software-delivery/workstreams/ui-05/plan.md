# UI-05 — Raport dowodów i decyzje wydania — Implementation Plan

> Data: 2026-09-19. Status: planned, bez implementacji i bez zaliczonego odbioru.
> [Brief](plan-brief.md) · [UI-05](../03-design-ui.md#ui-05--pokazać-raport-i-decyzję-wydania) · [README strumieni](../README.md) · [zależności OSS](oss-dependencies.md).
> Pierwszeństwo: [dodatek produktowy](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) i [pakiet UI](../../flow-handoff/03-adam-ui-figma.md). WordPress E2E jest obowiązkowym głównym demo. UI-05 dostarcza część jego odbioru, nie cały proces.

## Overview

Dostarczyć osobną stronę raportu projektu z powiązaniami wymaganie → AC → task → rewizja → test → deployment, szczegółami źródłowych dowodów i dwiema oddzielnymi decyzjami człowieka: zgodą na publikację oraz odbiorem zweryfikowanego wdrożenia. Operator musi rozumieć braki, widzieć wersję ocenianego wyniku i móc otworzyć dostępne załączniki.

Plan dotyczy frontendowego UI-05. Domena, publiczne DTO i brakujący odczyt dowodów pozostają własnością OSS. Publikację i sprawdzenie adresu wykonują odpowiednie strumienie; zapis zgody nie uruchamia deploymentu.

## Current State Analysis

Stan ustalono z kodu bieżącego checkoutu, a nie z historycznych godzin H24–H26.

| Powierzchnia | Stan i konsekwencja |
|---|---|
| Report GET | Istnieje `api/projects/[id]/report/route.ts:19`; przyjmuje baseline, rewizję i limit. Domyślnie wybiera aktywny baseline oraz najnowszy zapisany wynik. Nie daje gwarancji, że ten wynik jest finalną rewizją integracyjną. |
| DeliveryReport v1 | `lib/contracts.ts:725–855`: AC, testy, skany, traceability rows, usage, decyzje, deployment i blokery. Źródłowe rekordy są wskazywane przez ID/hash; jedyny URL to adres deploymentu. |
| Evidence UI | `components/detail/EvidenceSection.tsx:124` pokazuje komunikat o niedostępnej liście. Aktualnie są agregaty i deklarowane mapowania, a nie pełny raport. |
| Evidence API | `api/projects/[id]/evidence/route.ts:34`: tylko POST. Brak publicznego GET list/detail. Dane istnieją w `data/entities.ts:277–328`, lecz frontend nie może ich odczytać. |
| Deploy/release | Istnieją osobne POST, ACL i backendowe gate. Wymagają wersji projektu, odpowiedź niesie `projectUpdatedAt`; odrzucenie wymaga powodu. |
| Wzorzec mutacji | `components/detail/DecisionActions.tsx:64–106`: `useGuardedMutation`, scoped optimistic header, `surfaceRecordConflict`, walidacja odpowiedzi. Nie kopiować braków tego komponentu, np. braku Escape, do nowych formularzy. |
| Nawigacja i scope | `backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx` oraz `components/detail/useProjectSections.ts` mają ochronę request sequence i odświeżanie po zmianie organizacji. |
| Nowy flow | Spec OSS opisuje F15, opcjonalne `report.flow`, lecz obecny `commands/reportQueries.ts` buduje wyłącznie raport v1. Sama deklaracja typu ani zielony gate v1 nie dowodzą spełnienia nowych etapów i WP-01…05. |
| Testy | Istnieją testy buildera i report/deploy/release API. Nie pokrywają nowej strony, odświeżania, decyzji w trakcie zmiany danych ani przeglądania załączników. |

Wszystkie ścieżki modułu w tym planie mają prefiks `packages/core/src/modules/delivery_os/`, jeśli nie podano inaczej. `commands/reportQueries.ts` zawiera importy ORM — jego formattera rewizji nie wolno importować do klienta. Niewielki formatter URL należy do lokalnego modułu prezentacyjnego i używa typu `SourceRevision` z kontraktu.

## Desired End State

Operator otwiera raport ze szczegółów projektu lub bezpośredniego linku. Widzi baseline/hash, dokładną rewizję git albo snapshot WP, profil i czas odczytu. Rozwija powiązania i źródłowe dowody, ogląda screenshoty oraz dostępne pliki; brak pliku nie jest błędem testu ani dowodem PASS.

Bieżący raport automatycznie odświeża się podczas oczekiwania na publikację/weryfikację, tylko na widocznej karcie. Zmiana danych nie zatwierdza niczego automatycznie. Historyczny link przypina baseline i rewizję, pokazuje oznaczenie historii i nie udostępnia mutacji.

Uprawniony operator oddzielnie zatwierdza/odrzuca publikację oraz odbiór konkretnego deployment evidence. Backend ponownie sprawdza warunki. Wynik decyzji, konflikt i brak aktualnych danych są widoczne; żadna odpowiedź nie uruchamia publikacji z poziomu tego klienta.

### Decyzje zatwierdzone przez użytkownika

| Decyzja | Wybór |
|---|---|
| Brakujące API dowodów | Zależność od OSS; UI opisuje wymagania i czeka na realny kontrakt przed integracją. |
| Umiejscowienie | Osobna strona raportu, podsumowanie i link w szczegółach projektu. |
| Historia | Bieżący raport domyślnie; historyczny przez link, jawnie oznaczony, bez akcji zatwierdzania. |
| Źródłowy dowód | Rekord z pochodzeniem, rewizją, wynikiem i hashem oraz dostępnymi załącznikami; jawny brak pliku. Bez obowiązkowego raw report download. |
| Odświeżanie | Automatyczne odpytywanie podczas oczekiwania, tylko na widocznej karcie, z obsługą błędów. |
| Fazy | Strona i dane → dowody → decyzje → weryfikacja i przekazanie. |

## What We're NOT Doing

- UI-05 nie implementuje API/komend/encji OSS, ingestu i magazynu surowych raportów, adapterów enterprise ani narzędzi Studio.
- Nie buduje zgód Scope/UX/KV/DS/UI, synchronizacji Figmy, Kanbana ani ustawień procesu. Zachowuje ich znaczenie jako zależności nowego odbioru.
- Nie publikuje WordPressa, nie weryfikuje adresu przez klientowy fetch i nie zastępuje backendowego gate lokalną kalkulacją.
- Nie dodaje selektora wszystkich rewizji, PDF/CSV exportu, drugiego silnika workflow ani nowych zależności produkcyjnych.
- Nie zmienia DTO v1, profili targetów ani DS platformy, nie uruchamia migracji i nie tworzy PR/Issues/etykiet.
- Nie przenosi wcześniejszych wyjątków od testowania z planu UI-04: ta rozmowa nie wyłącza walidacji UI-05.

## Implementation Approach

Nowy server page root `/backend/delivery/projects/[id]/report` składa małe client islands. Hook raportu konsumuje istniejący GET i projektowe `updatedAt`; tabela, deployment, historia decyzji i formularze korzystają ze wspólnego zestawu danych. Przeglądarka nie pobiera osobno każdego taska/testu w tabeli.

`DataTable` prezentuje traceability. Szczegóły dowodu są ładowane na żądanie w dialogu. Dodatkowa paginowana lista dowodów pozwala znaleźć screenshoty i review, których nie ma w wierszach testów. Dwa osobne przyciski otwierają formularze decyzji o jednoznacznie wskazanym przedmiocie.

Formularze używają `CrudForm embedded`, a wywołania custom endpoints przechodzą przez `useGuardedMutation` i scoped optimistic header projektu. Dane/komunikaty mają i18n we wszystkich pięciu locale. Reuse `Page`, `FormHeader`, `SectionHeader`, `StatusBadge`, `Alert`, `LoadingMessage`, `ErrorMessage`, dialogów i załączników OM; brak nowej biblioteki tabel lub podglądu.

### Zależności i granice integracji

- **D1 — odczyt evidence, OSS/Mateusz:** szczegóły po ID oraz możliwość odnalezienia screenshot/review/załączników dla wybranego baseline i rewizji. Wymagania w [oss-dependencies.md](oss-dependencies.md). UI nie ustala jednostronnie URL ani publicznego DTO; przyjęty schema/fixture i commit dostawcy są warunkiem podłączenia.
- **D2 — nowy flow i pełny WP odbiór, OSS/EXEC/WP/QA:** działająca projekcja etapów i serwerowe blokady zgodne z F15/dodatkiem, wraz z dowodami FLOW/WP. Zielony v1 report opisuje tylko v1 AC/profil. Bez D2 ekran nie deklaruje gotowości całego nowego procesu ani nie udostępnia zatwierdzania nowych projektów flow przez niezabezpieczone legacy API. Włączenie ich akcji wymaga potwierdzonego kontraktu identyfikacji projektu flow i gate po stronie serwera. Legacy ścieżka pozostaje działająca.
- **D3 — rewizja odbiorowa, OSS/QA:** zaufane wskazanie finalnej rewizji integracyjnej/snapshotu dla bieżącego baseline, dostępne przez kontrakt odczytu i respektowane przy decyzji. Raport domyślny może pokazywać latest-result jako podgląd, lecz dopóki D3 nie wskazuje kandydata odbiorowego, aprobata jest zablokowana. Po przekazaniu D3 bieżący widok pobiera raport tej rewizji; późniejszy wynik pojedynczego taska nie przełącza kandydata. Szczegóły przekazania w dokumencie zależności.
- Praca nad tabelą/stanami jest możliwa na fixture. Integracja D1 i D2 wymaga realnych API, a live FLOW-07 wymaga rzeczywistej publikacji i weryfikacji URL. Brak zależności jest blockerem odpowiedniego odbioru, nie zgodą na usunięcie wymagania.
- API/schemas/commands/data oraz wspólny spec OSS edytuje ich właściciel. UI przygotowuje wpis do frontend ledger i mapę testów w handoff, do włączenia przez OSS. Testy UI w `__integration__` uzgodnić z QA i dostarczyć z funkcją.

## Critical Implementation Details

### Tożsamość raportu i decyzji

Klucz danych obejmuje scope, projectId, baselineId i rewizję. Link historyczny używa `baselineId` oraz `revision=git:…` albo `revision=snapshot:…`; oba parametry muszą być obecne. Niepełny/niepoprawny link pokazuje błąd zamiast cicho wracać do aktualnej wersji. Każdy link przypięty do wersji jest tylko do odczytu, nawet jeśli obecnie wskazuje bieżącą wersję; osobny link „Bieżący raport” otwiera widok z akcjami.

Przed otwarciem decyzji oraz przy każdym submit/guarded retry pobrać świeży raport i projekt, z potwierdzeniem kandydata D3. Formularz przypina projectUpdatedAt, baseline/hash, rewizję, a dla release także evidenceId/buildId i treść blockerów. Porównać również identyfikatory dowodów i aktualnych decyzji, nie tylko `gate.ok`; evidence może się zmienić bez aktualizacji project.updatedAt. Zmiana przedmiotu, danych dowodowych, gate lub wersji projektu unieważnia zatwierdzenie; tekst powodu pozostaje, ale operator musi ponownie przejrzeć dane. Nie podmieniać samoczynnie nagłówka otwartego formularza na nowsze updatedAt. 409 nie jest automatycznie ponawiane. Preflight ogranicza wyścig w UI, nie daje atomowego snapshotu — ostateczna ponowna kontrola należy do backendu.

### Odświeżanie podczas oczekiwania

Po odczycie wykonać kolejne zapytanie po 5 s, bez nakładania requestów. Odpytywać bieżący raport po zatwierdzonej zgodzie deploy, gdy deployment nie istnieje lub nie jest verified; uwzględnić także `upload/verification failed`, ponieważ nowy wynik może przyjść później. Po verified deployment albo późniejszym odrzuceniu zgody zatrzymać tę pętlę. Nie wywodzić „publikacja trwa” z samej zgody — ekran mówi „Oczekiwanie na dowód publikacji/weryfikacji”.

W ukrytej karcie anulować timer i zignorować spóźniony wynik; po powrocie odczytać raz natychmiast, następnie ocenić warunek pętli. Po zatwierdzonym finalnym odbiorze oraz dla historii brak ciągłego pollingu; pozostaje ręczne odświeżenie i odczyt po powrocie. Błędy sieci/5xx: ostatni poprawny raport zostaje z oznaczeniem nieaktualności, akcje decyzji zablokowane, retry 10/20/40/60 s maksymalnie. 401/403/404, zmiana scope/projektu i unmount czyszczą dane wrażliwe i zatrzymują pętlę; brak dostępu nie pozostawia starej tabeli. Sukces resetuje backoff. Timer nie oznacza zgody ani ukończenia procesu.

### Ograniczenia danych

`report.rows` jest ograniczone do 1000, nie ma offsetu. Pobierać do 1000 i stronicować lokalnie po 50 (maks. 100); `truncated` oznacza niepełną tabelę, nie następne strony serwera. Backend gate pozostaje źródłem prawdy, ale UI nie komunikuje pełnego audytu z uciętej listy. Widok starych decyzji filtruje/oznacza `appliesToRevision`; release dodatkowo wiąże `subjectId` z aktualnie pokazywanym deployment evidence, aby decyzja innego builda nie oznaczała odbioru tego builda.

## Phase 1: Strona raportu i podłączenie API

### Overview

Utworzyć trasę, podsumowanie/link oraz spójny odczyt bieżących i historycznych danych wraz z pollingiem. D1 nie blokuje tej fazy.

### Changes Required

#### 1. Server route i wejście z projektu

**Files:** nowe `backend/delivery/projects/[id]/report/page.tsx`, `page.meta.ts`; istniejące `backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx`, `components/detail/EvidenceSection.tsx`.

**Intent:** Dać raportowi własny adres i wejście ze szczegółów projektu. Zachować istniejące agregaty jako podsumowanie projektu, bez przedstawiania ich jako statusu konkretnej rewizji raportu.

**Contract:** Page root bez `use client`; metadata `requireAuth`, `delivery_os.projects.view`, `navHidden`, tłumaczone breadcrumbs. Link do bieżącego raportu; linki historyczne zawsze przypinają baseline i revision. Usunąć ogólny komunikat o niedostępnym raporcie, a ewentualny brak D1 pokazać tylko w powierzchni dowodów. Po discovery uruchomić generację.

#### 2. Client islands i odczyt

**Files:** nowe `components/report/DeliveryReport.tsx`, `useDeliveryReport.ts`, `reportView.ts`, `ReportSummary.tsx`, `DeploymentSummary.tsx`, `components/report/__tests__/reportView.test.ts`, `useDeliveryReport.test.tsx`, `reportPage.test.tsx`.

**Intent:** Walidować odpowiedzi, prezentować wersję/AC/skany/usage/deployment oraz utrzymywać raport podczas zewnętrznej publikacji. Oddzielić logikę tożsamości, timerów i mapowania statusów od JSX.

**Contract:** Początkowo `deliveryReportV1Schema`, `projectDetailSchema`, `apiCall`; po przekazaniu D2 obowiązkowo opublikowany rozszerzony parser zachowujący `flow`, z testem prezentacji `flow.gate`. Bez ORM w client bundle. Historyczny 404 nie wraca do bieżącego raportu. Brak aktywnego baseline to nazwany stan z linkiem do projektu; brak rewizji to raport missing, nie błąd ani 0% wykonania. `usage.values = 'unknown'` pozostaje nieznane. Polling według sekcji Critical Implementation Details. D2/D3 konsumowane przez opublikowane kontrakty OSS, bez domyślania się etapów z v1 `design` i bez utożsamiania latest-result z kandydatem odbiorowym.

#### 3. Teksty i test routa

**Files:** `i18n/{en,pl,de,es,ko}.json`; nowy `__integration__/TC-DELIVERY-UI-005.spec.ts` rozwijany w kolejnych fazach.

**Intent:** Dostarczyć działające etykiety, loading/empty/error i test wejścia na stronę razem z funkcją.

**Contract:** Klucze `delivery_os.report.*`; test tworzy własny projekt/baseline i sprawdza hydration oraz link z detalu, bez polegania na danych demo.

### Success Criteria

#### Automated Verification

- Testy `reportView`, hooka i strony wykazują prawidłową tożsamość git/snapshot, błędy parametrów, historię bez mutacji, brak PASS z missing oraz ignorowanie odpowiedzi innego scope.
- Fake timers potwierdzają widoczność karty, jeden request naraz, backoff, zakończenie oczekiwania, cleanup oraz brak niejawnego „publikacja trwa”.
- TC-DELIVERY-UI-005 przechodzi dla routa i wejścia z projektu; `yarn generate` i `yarn check:client-boundaries` nie wprowadzają nowego client page root.

#### Manual Verification

- Operator otwiera raport z projektu i bezpośredniego linku; rozpoznaje wersję, historię, brak danych oraz opóźniony/błędny odczyt na desktop i mobile.

## Phase 2: Tabela powiązań i szczegóły dowodów

### Overview

Zbudować czytelną traceability oraz podgląd źródłowego evidence. Część prezentacyjna może powstać wcześniej; podłączenie szczegółów i odbiór wymagają D1.

### Changes Required

#### 1. Powiązania i lista źródeł

**Files:** nowe `components/report/EvidenceTable.tsx`, `EvidenceSources.tsx`, `evidenceView.ts`, `__tests__/evidenceTable.test.tsx`.

**Intent:** Pokazać łańcuch od wymagania do wdrożenia i umożliwić znalezienie screenshotów/review niezależnie od wierszy testów.

**Contract:** `DataTable`, lokalna strona 50 i limit 100, stabilne klucze z pełnej krotki relacji (evidenceId nie jest unikalnym kluczem wiersza). Wiersze ze wspólnym dowodem pozostają osobnymi powiązaniami. Etykiety wymagania/taska tylko z już dostępnych, zweryfikowanych danych; brak nazwy zachowuje czytelne ID. Task link używa istniejącego routa detalu zadania. Nie ma przycisku „następna strona API” dla `report.truncated`. Źródła screenshot/review pobierane paginowanym kontraktem D1, bez zapytań N+1.

Screenshoty z `sourceRevision: null` są legalne w obecnym kontrakcie. Lista D1 udostępnia je w osobnej, jawnie nazwanej grupie „Dowody baseline bez przypisanej rewizji”; można je obejrzeć, ale nie przypisać do proof oglądanej rewizji. Nie ukrywać ich przez filtr exact revision ani nie dopisywać rewizji lokalnie.

#### 2. Szczegóły dowodu i załączniki

**Files:** nowe `components/report/EvidenceDetailDialog.tsx`, `useEvidenceDetail.ts`, `__tests__/evidenceDetail.test.tsx`; uzupełnienie locale i TC-DELIVERY-UI-005.

**Intent:** Otworzyć źródłowy rekord i dostępne załączniki, zachowując korelację projektu/baseline/rewizji.

**Contract:** Konsument publicznego schema/fixture D1, z jawnie odróżnionymi stanami loading, brak API, błąd/dostęp, brak pliku i rekord z plikami. Pochodzenie manual/adapter, wynik, hash, czas i korelacja; tylko pola bezpiecznego DTO, bez renderowania arbitralnego payload HTML/sekretów. Istniejący mechanizm autoryzowanych załączników, preview obrazów i pobranie dozwolonych typów; URL otwierany tylko jako dozwolony http(s) lub zatwierdzony lokalny adres załącznika. Brak pliku nie powoduje rekonstrukcji raportu z hasha. Escape zamyka dialog, fokus wraca do wyzwalacza.

### Success Criteria

#### Automated Verification

- Testy tabeli odróżniają missing/not_run/failed/manual_pending/unverified, scan `reportedStatus` i deployment `verificationStatus`; null nie przechodzi do PASS.
- Testy D1 wykazują zgodność fixture z opublikowanym schema, odnajdywanie screenshotów spoza traceability rows, osobną prezentację screenshotu bez rewizji, brak załącznika, 403/404 i ignorowanie obcej/spóźnionej odpowiedzi.
- TC-DELIVERY-UI-005 otwiera rzeczywisty rekord oraz własny screenshot testowy przez API i UI; brak D1 oznacza nieukończony odbiór, a nie pozytywny test mocka.

#### Manual Verification

- Operator przechodzi od wymagania przez test i rewizję do źródłowego rekordu i URL, ogląda screenshot oraz rozumie brak surowego pliku.

## Phase 3: Zgoda publikacji i końcowy odbiór

### Overview

Podłączyć istniejące append-only decyzje z oddzielnymi ACL i zabezpieczeniem przed zatwierdzeniem zmienionego przedmiotu.

### Changes Required

#### 1. Akcje i historia decyzji

**Files:** nowe `components/report/ReleaseDecisionActions.tsx`, `ReleaseDecisionDialog.tsx`, `DecisionHistory.tsx`, `decisionInput.ts`, `__tests__/releaseDecisions.test.tsx`; zmiany `DeliveryReport.tsx`, locale i TC-DELIVERY-UI-005.

**Intent:** Oddzielić zgodę na publikację od odbioru konkretnego deploymentu oraz pokazać decyzje historyczne bez sugerowania ich aktualności.

**Contract:** Deploy POST `{ baselineId, sourceRevision, verdict, reason? }`; release POST `{ deploymentEvidenceId, verdict, reason? }`. `hasFeature` obsługuje wildcard dla `delivery_os.deploy.approve` i `delivery_os.release.approve`; read-only nie wymaga tych cech. Archiwum i historia bez akcji. `CrudForm embedded`, `useGuardedMutation`, `retryLastMutation` w context; custom call z `buildOptimisticLockHeader(projectUpdatedAt)`. Odpowiedź zweryfikowana przez istniejący schema, nowa wersja przekazana do następnej operacji. Cmd/Ctrl+Enter submit, Escape cancel, blokada podwójnego kliknięcia.

Zatwierdzenie jest aktywne wyłącznie przy świeżych danych, potwierdzonym kandydacie D3 i odpowiednim gate. Odrzucenie z powodem pozostaje dostępne mimo czerwonego gate, gdy istnieje właściwy przedmiot i uprawnienie; release bez deploymentId nie tworzy fikcyjnego przedmiotu. Brak D2 blokuje akcje nowych projektów flow, nie reinterpretując legacy `design`.

422 wyświetla nazwane blokery i linki do dostępnych AC/skanów/deploymentu; 409 używa `surfaceRecordConflict`, zachowuje wpisany powód i wymaga ponownego przeglądu. 428 nie jest sukcesem. Timeout/nieczytelna odpowiedź po POST oznacza niepewny wynik: odczytać historię i wersję przed kolejną świadomą decyzją, nie automatycznie powtarzać append-only POST. Sam polling nigdy nie zapisuje decyzji.

### Success Criteria

#### Automated Verification

- Testy rozróżniają ACL deploy/release (również wildcard), approved/rejected, wymagany powód, brak deploymentu, czerwony gate i brak mutacji historii/archiwum.
- Zmiana baseline, rewizji, deploymentu, dowodów, gate lub projectUpdatedAt w otwartym formularzu blokuje stary submit i guarded retry; test zmienia evidence bez zmiany projectUpdatedAt i sprawdza preflight. Timeout nie duplikuje decyzji.
- Późniejszy wynik pojedynczego taska nie zastępuje kandydata D3; brak wskazania rewizji odbiorowej lub jej zmiana blokuje aprobatę do ponownego przeglądu.
- TC-DELIVERY-UI-005 wykonuje deploy consent → zewnętrzny zapis niezweryfikowanego i zweryfikowanego deploymentu → release; testuje 409/422 oraz brak jakiegokolwiek wywołania executora z akcji zgody.
- Test nowego projektu flow wymaga D2 i dowodzi, że brak aktualnych zgód etapowych nie jest obchodzony przez legacy przyciski/API. Test v1 działa nadal bez enterprise.

#### Manual Verification

- Operator zatwierdza publikację, widzi wynik odpytywania po pojawieniu się verified deploymentu, następnie osobno zatwierdza albo odrzuca odbiór; po konflikcie ponownie ocenia aktualne dane.

## Phase 4: Weryfikacja i przekazanie

### Overview

Zebrać wykonane testy poszczególnych faz, sprawdzić całą ścieżkę i udokumentować rzeczywisty zakres. Ta faza nie odkłada pisania testów funkcji na koniec.

### Changes Required

#### 1. Integracja i regresje

**Files:** `__integration__/TC-DELIVERY-UI-005.spec.ts`, lokalne helpers tylko jeśli potrzebne, istniejące testy `components/detail/__tests__/sections.test.tsx` i backend project detail oraz nowe `components/report/__tests__/*`.

**Intent:** Potwierdzić działanie nowego widoku bez regresji detalu i dowieść, że negatywne wyniki nie zmieniają się w pozytywne decyzje.

**Contract:** Self-contained fixture przez API/helpers OM, własny baseline i evidence, sprzątanie w finally. Dwa scope/tenant oraz użytkownicy z rozdzielonymi feature. Git i snapshot WP, zmiana rewizji A→B, późniejsze odrzucenie zgody, brak security check, niewłaściwy build, utrata dostępu, ukryta karta, klawiatura, desktop/mobile. Zwykłe CI nie wymaga live Figmy/Studio. API mock nie zastępuje integracji z działającym OSS.

#### 2. Handoff, spec i granice klienta

**Files:** przyszły `workstreams/ui-05/handoff.md`; przekazany właścicielowi patch do `.ai/specs/2026-09-18-delivery-os-hackathon.md` (Frontend Architecture Contract/ledger, API/UI coverage, changelog); indeks dowodów prowadzony przez QA.

**Intent:** Pozostawić sprawdzalne przekazanie z zakresem, wersjami kontraktów, testami i blockerami.

**Contract:** SHA i lista plików, schema/profile/fixture versions, runner, komendy/exit codes, wyniki hydration/build i czasy odczytu, rozróżnienie fixture/live. Ledger: server `report/page.tsx` → `components/report/DeliveryReport.tsx`; lokalne islands/hooki tabeli, odczytu dowodu i dialogów decyzji; bez globalnego providera/SDK oraz bez nieuzasadnionych client blobs >300 LOC. Nie edytować cudzego specu bez przekazania/uzgodnienia.

### Success Criteria

#### Automated Verification

- Komponenty modułu, istniejące report/deploy/release API regression tests i TC-DELIVERY-UI-005 przechodzą na finalnym stanie; wyniki pending/skipped/blocked są opisane osobno.
- `check:client-boundaries`, typecheck, i18n i sygnał build/bundle potwierdzają nowy route bez naruszenia granic; pełny gate według poniższej sekcji ma zapisany wynik.
- Zmienione pliki mieszczą się w uzgodnionej własności; D1/D2/D3 mają dowód rzeczywistej integracji albo pozostają jawnie niespełnioną zależnością odbioru.

#### Manual Verification

- QA i operator współodbierają wkład w 5.1/5.4; live FLOW-07 dopiero z realnym WP URL, dowodami właściwej wersji i zgodami. Sam snapshot, localhost ani fixture nie zalicza live demo.

## Testing Strategy

### Komendy i runner

Przed pierwszą sekwencją implementer wybiera raz Docker/local według `.ai/docs/agent-instructions.md`; sprawdza istniejące `.ai/qa/ephemeral-env.json`. W Docker każdy `yarn X` zamienia na `node scripts/docker-exec.mjs X`. Handoff zapisuje runner i compose. Bieżące planowanie nie uruchamia aplikacji ani bazy i nie twierdzi, że środowisko jest gotowe.

Testy przyrostowe, z repo root:

```bash
yarn workspace @open-mercato/core test --runInBand --testPathPatterns='delivery_os/components/report|delivery_os/components/detail|delivery_os/backend/delivery/projects'
yarn workspace @open-mercato/core test --runInBand --testPathPatterns='delivery_os/api/__tests__/(report|deployDecision|releaseDecision)\.route|delivery_os/lib/__tests__/deliveryReport'
yarn check:client-boundaries
yarn i18n:check-hardcoded
yarn i18n:check-values
yarn test:integration --grep 'TC-DELIVERY-UI-005'
```

Nowy route wymaga `yarn generate`. Końcowa uporządkowana bramka z `.ai/agentic.config.json`:

```bash
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```

Lint zmienionego zakresu zgodnie z dostępną konfiguracją repo (`yarn lint` gdy brak węższego tasku); nie dopisywać nieistniejącego skryptu workspace core. Nowe problemy naprawić, zastane lub środowiskowe udokumentować. Brak tabel/użytkownika testowego jest blockerem integracji do przygotowania środowiska przez właściwy workflow; nie uzasadnia lokalnego `db:migrate` bez zgody. Nie przenosić automatycznie dawnych informacji UI-04 o stanie bazy do tej sesji.

### Kluczowe rozróżnienia testowe

| Przypadek | Wymagany wynik |
|---|---|
| AC bez testu / test not_run / failed | Trzy różne stany, żaden nie udaje PASS. |
| Scan missing + reportedStatus not_run | Widoczny niewykonany skan, nie ogólne zielone AC. |
| Upload succeeded, brak verify | Unverified; brak release approval. |
| Verification failed | Jawny błąd weryfikacji mimo nadrzędnego statusu unverified. |
| Manual pending | Może pozwalać na deploy według backendu, nadal blokuje release. |
| Nowy wynik na rewizji B | Testy i zgody A nie zaliczają B. |
| Release decision innego evidenceId na tej samej rewizji | Nie oznacza akceptacji obecnego deploymentu. |
| Brak pliku przy poprawnym evidence | Rekord dostępny, plik niedostępny; bez zmiany domenowego wyniku. |
| Report truncated | Widoczny limit i liczba; brak pozornej kompletności tabeli. |
| Błąd pollingu | Stary odczyt oznaczony, mutacje niedostępne do udanego odświeżenia. |
| Brak D2 dla nowego flow | Brak pełnego PASS i brak niechronionych akcji aprobaty. |

## Performance Considerations

Jedna współdzielona pętla raportu na widok; szczegóły i źródła evidence pobierane na żądanie. Nie odpytywać każdego wiersza. Timer 5 s daje najwyżej 12 cykli/minutę na aktywny oczekujący widok; odczyt projektu do wersji/scopingu może dodać jedno zapytanie w cyklu. Ocenić koszt rzeczywistego GET przed zwiększeniem liczby równoległych operatorów — obecny backend czyta evidence batchowo, a limit rows nie ogranicza wszystkich kosztów zapytania.

W tabeli renderować 50 wierszy; załączniki ładować dopiero po otwarciu, nigdy base64 w cyklicznym raporcie. Nie dodawać cache między scope ani dodatkowego globalnego client providera. Zmierzony build/hydration jest dowodem; plan nie obiecuje niezmierzonego SLA.

## Migration & Backward Compatibility

UI nie wymaga migracji ani zmiany publicznych v1 DTO, enumów, ACL czy komend. Zachowuje istniejącą stronę projektu, linki tasków i działanie OSS bez enterprise. D1 jest addytywnym kontraktem właściciela OSS, z własnym BC review, OpenAPI i testami scope/attachments. D2 zachowuje legacy approvals i wprowadza etapowe reguły zgodnie z istniejącym specem; UI ich nie replikuje.

Wycofanie UI usuwa nową nawigację i route, ale nie cofa ani nie kasuje zapisanych decyzji/evidence. Nie zmieniać wygenerowanych plików ręcznie, nie aplikować migracji podczas planowania.

## Nakład i warunki rozpoczęcia

Szacunek UI-05: **10–14 h aktywnej pracy** (faza 1: 3–4 h, 2: 2–3 h, 3: 3–4 h, 4: 2–3 h), bez czasu oczekiwania na OSS, kosztu implementacji D1/D2/D3 i live WP demo. Historyczne 2 h nie są aktualną wyceną tego zakresu. To estymata, nie zgoda na przekroczenie budżetu zespołu.

Faza 1 może ruszyć na istniejącym API. Faza 2 może przygotować prezentację, ale integruje wyłącznie opublikowany D1. Faza 3 konsumuje istniejące v1 API, wymaga D3 do aprobaty i D2 dla nowych projektów flow. UI/QA zapisują wyniki po każdej fazie bez automatycznego zaznaczania manualnych kryteriów; niezależne prace mogą trwać podczas oczekiwania na zależności.

## Risks & Assumptions

| Ryzyko | Działanie |
|---|---|
| D1 nie dostarczy screenshotów spoza report rows | Wymaganie listowania jest częścią handoff; sam GET po znanym evidenceId nie zamyka 5.4. |
| Schemat flow istnieje, ale brak runtime | Integracja D2 wymaga endpointu i testu odmowy, nie importu samego typu. |
| Najnowszy result nie jest finalną rewizją integracyjną | D3 wskazuje kandydata; brak/niezgodność blokuje aprobatę. Nie wybierać ostatniego zielonego runu. |
| Polling zmienia dane podczas decyzji | Przypięty przedmiot, invalidation formularza, wersja projektu i ponowne sprawdzenie serwera. |
| Brak raw report | Jawny brak pliku; wymaganie użytkownika dopuszcza rekord z opcjonalnymi załącznikami. |
| Brak readiness środowiska | Testy komponentowe nie zastępują integracji; handoff zachowuje blocker. |
| Nowe wymagania WP poza starym profilem v1 | Zielone v1 nie oznacza FLOW/WP PASS; właściciel OSS dostarcza właściwą projekcję i walidację D2. |

Nie pozostają otwarte wybory produktowe. D1/D2/D3 są nazwanymi zależnościami o określonym warunku odbioru, a nie zgodą na zgadywanie payloadów lub ograniczenie zakresu.

## References

- [README — własność, przekazania, pojedynczy Progress](../README.md), w szczególności linie 84, 114–118 i 133–143.
- [Opis UI-05](../03-design-ui.md), linie 49–55; [plan główny](../../plan.md), Progress 5.1/5.4.
- [Dodatek — FLOW-07 i WP odbiór](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md); [pakiet UI i frontend contract](../../flow-handoff/03-adam-ui-figma.md).
- `.ai/specs/2026-09-18-delivery-os-hackathon.md`: R20–R22, F15; `.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md`: granica wykonania enterprise.
- `lib/contracts.ts:725–855`, `commands/reportQueries.ts:73–151`, `lib/deliveryReport.ts`: rzeczywisty raport v1.
- `api/projects/[id]/{report,deploy-decisions,release-decisions,evidence}/route.ts`; `data/validators.ts:498–515`; `commands/decisions.ts:163–187,308–370`.
- `packages/core/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`, `.ai/qa/AGENTS.md`, `.ai/docs/agent-instructions.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/ds-rules.md`.

## Progress — odwołanie do rejestru kanonicznego

Zgodnie z README nie powstaje druga checklista. Niniejszy plan i jego review nie zaliczają żadnego kryterium implementacji.

| Kryterium nadrzędne | Wkład UI-05 | Pozostały współodbiór |
|---|---|---|
| 5.1 | Prezentacja dowodów właściwej wersji, blockerów i bezpiecznych akcji; testy negatywne | OSS zapewnia prawdę domenową i finalny raport, QA weryfikuje. |
| 5.4 | Przejście wymaganie→test→rewizja→URL, screenshoty, aprobata/odrzucenie | D1 i rzeczywiste artefakty; człowiek potwierdza manualnie. |
| FLOW-07 | UI zgody→dowód publikacji→verify→odbiór | D2, realne WP wykonanie/publikacja, QA i człowiek; sam UI nie zamyka FLOW-07. |

Jedna wyznaczona osoba aktualizuje [Progress planu głównego](../../plan.md#progress) po zebraniu dowodów wszystkich właścicieli. Pozostałe FLOW-01…09 i WP-01…05 nadal warunkują pełny odbiór nowego demo; nie są ukryte pod statusem UI-05.
