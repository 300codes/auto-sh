# UI-03 — Doprowadzić dwa wejścia do zatwierdzonego baseline

> **Korekta kierunku — 2026-09-19:** [dodatek produktowy](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) i [pakiet dla Adama](../../flow-handoff/03-adam-ui-figma.md) mają **pierwszeństwo** w zakresie kolejności etapów, osobnych akceptacji UX/KV/DS/UI, importu komentarzy Figma do Kanbana, ustawień procesu i WordPressa jako głównego demo. Ten plan powstał na wcześniejszym ramowaniu i **nie pokrywa całego nowego zakresu UI** — pokrycie i luki opisuje sekcja „Pozycja wobec korekty kierunku" niżej. To zmiana wymagań, nie potwierdzenie implementacji.

> Zadanie ze strumienia [UI](../03-design-ui.md). Kryteria odbioru i ich status należą do [planu głównego](../../plan.md#progress) — ten plik opisuje wykonanie, nie zalicza bramek.
> Punkt wyjścia: [przekazanie UI-02](../ui-02/handoff.md) i [review wdrożenia UI-02](../ui-02/reviews/impl-review.md). Dowody Figmy: [plan UI-01](../ui-01/plan.md).

## Overview

H6–H10 i H12–H15, 7 h. Doprowadzić oba wejścia do jednego zatwierdzonego baseline'u w OM: agent proponuje wymagania i AC, tworzy ekrany w Figmie, człowiek komentuje snapshot i zatwierdza wymagania oraz design na konkretnej wersji, agent proponuje architekturę i plan, człowiek zatwierdza scalony baseline. FROM_DESIGN przechodzi tym samym torem, zaczynając od zatwierdzonych ekranów i ręcznie napisanych wymagań — bez rekonstrukcji specyfikacji z obrazów.

Zadanie współodbiera **3.1–3.6** razem z OSS-03 i QA-03. UI-03 nie zalicza ich samo; 3.4 i 3.5 wymagają dodatkowo obecnego człowieka zatwierdzającego.

## Pozycja wobec korekty kierunku

Dodatek produktowy z 2026-09-19 wszedł po ustaleniu zakresu tego planu. Rozliczenie jest jawne, żeby nikt nie przeczytał tego dokumentu jako pokrycia bieżących wymagań.

**Co z tego planu zostaje bez zmian.** Dodatek utrzymuje istniejące endpointy jako kontrakt v1 i zachowuje FROM_DESIGN, React i OM jako dostępne ścieżki. Cała mechanika Fazy 2 — render → attachment → sha256 liczony w przeglądarce → `draftSpec.screens` → zamrożenie z serwerową weryfikacją bajtów — jest tą samą mechaniką, której będą potrzebowały osobne artefakty UX, Key Visual i DS/UI; nie powstaje na wyrzucenie. To samo dotyczy miniatur, naprawy F1, wyboru oglądanej wersji i wzorca rozłącznych komunikatów per kod błędu.

**Co ten plan realizuje w wersji v1, a czego dodatek żąda docelowo inaczej.** Faza 3 buduje dwie zgody `requirements` i `design` na jednym baseline. Dodatek wymaga **osobnych** wersjonowanych artefaktów i bramek dla UX, Key Visual oraz DS/UI i wprost zabrania wciskania trzech zgód w jedną decyzję oraz zmiany znaczenia istniejącego `design`. Mechanizm etapowych zgód nie istnieje — jest pierwszym deliverable F0 po stronie domeny. Faza 3 jest więc ścieżką v1, nie docelowym modelem.

**Czego ten plan nie pokrywa, a należy do pakietu UI.** To są zadania, nie braki do cichego uzupełnienia:

- **F0: osobny probe odczytu komentarzy Figmy.** Pakiet mówi wprost, żeby nie utożsamiać działającego `use_figma` write z dostępem do API komentarzy. Dowody UI-01 nie rozstrzygają tej kwestii. To pozycja blokująca FLOW-03 i powinna być wykonana **przed** jakąkolwiek pracą nad synchronizacją.
- **Brief Wizard ze wznowieniem i ScopingConversation** z rekomendacją platformy oraz jawnym wyborem człowieka przed akceptacją Scope.
- **Osobne widoki UX, Key Visual i DS/UI** z własnymi wersjami, akceptacją klienta i utratą aktualności zgód po zmianie upstream.
- **Provider komentarzy Figma** w dedykowanym pakiecie integracji, przycisk „Synchronizuj komentarze" z cursorem/postępem/błędami oraz karty w **natywnym** Kanbanie `staff` — bez budowania drugiego Kanbana w delivery.
- **Wejście „Proces realizacji projektów" w ustawieniach** z edycją w istniejącym Workflows Studio i przypięciem wersji do projektu.
- **Handoff tokenów do WordPressa w F2** — semantyczne tokeny i macierz `ekran/sekcja → blok/pole WP → miejsce edycji → tłumaczenie → test`, nie same rendery.
- **Frontend Architecture Contract** z pakietu: server-side page roots, nazwane client islands, ledger `use client`, `yarn check:client-boundaries`, hydration smoke i test kluczowej interakcji dla każdego nowego route'u. Ten plan dodaje wyłącznie komponenty wewnątrz istniejących route'ów, ale kontrakt obowiązuje od teraz i jest dopisany do bramki Fazy 4.

**Budżet i obowiązek F0.** Dodatek stwierdza, że dawne 36 h i limit WP 6 h nie są estymatą nowego zakresu i że właściciele przekazują nową estymatę oraz blokery przed zobowiązaniem terminowym. [README zespołu](../../flow-handoff/README.md) czyni to deliverable'em F0: „pozostali podają potrzebne operacje, wyniki probe i estymaty". Od strony UI oznacza to trzy osobne rzeczy, z których ten plan dostarcza **żadnej**: wynik probe odczytu komentarzy, listę operacji API potrzebnych UI (draft/scoping, artefakty etapów, decyzje etapowe, sync komentarzy) uzgodnioną z Mateuszem oraz estymatę i blokery całego pakietu UI. 7 h tego planu dotyczy wyłącznie jego własnego zakresu i nie jest wyceną pakietu.

**Mapowanie na nowe ID odbioru.** Odbiór liczy się teraz w FLOW-01…09 i WP-01…05, a pakiet UI odpowiada za FLOW-01…05, 07 i 09. Ten plan **nie zamyka żadnego z nich samodzielnie**. Wnosi wkład cząstkowy do trzech: FLOW-02 w części dotyczącej decyzji związanej z hashem i wersją oraz odmowy przy starym hashu (ale na parze `requirements`/`design`, nie na osobnych bramkach UX/KV/DS/UI), FLOW-08 w części regresji v1 i utrzymania tenant/org/ACL, oraz FLOW-09 w części „zmiana tworzy nową wersję, stara zgoda traci aktualność". `TC-DELIVERY-UI-003` jest spec'em ścieżki v1 i nie zastępuje żadnego FLOW.

**Zgodność z Frontend Architecture Contract.** Plan nie dodaje **żadnego** nowego page root — wszystkie komponenty wchodzą do istniejących route'ów `/backend/delivery/projects` i `/backend/delivery/projects/[id]`. Konsekwencje, które trzeba utrzymać: zero nowych client page roots; żaden z sześciu nowych komponentów klienckich (`ProposalImportDialog`, `ScreenImportDialog`, `ScreenComments`, `DecisionActions`, `BaselineVersionBar`, `FreezeBaselineAction`) nie przekracza 300 LOC bez uzasadnienia — logika parsowania i hashowania mieszka w czystych modułach (`proposalImport.ts`, `screenUpload.ts`), nie w komponencie; **nie dodajemy globalnego SDK Figmy** ani żadnej ciężkiej biblioteki do bootstrapu — render pochodzi z pliku uploadowanego przez operatora, a `crypto.subtle` jest API przeglądarki. Ledger `use client` uzupełnia się w F0 razem z resztą pakietu.

## Current State Analysis

- **Kontrakt OSS dla obu wejść jest gotowy i wdrożony, nie „roboczy do H14".** Zapis specyfikacji strumienia „realne baseline API od H14" jest nieaktualny — tak samo jak przy UI-02 pracujemy na żywych endpointach wszędzie, gdzie istnieją, a brak nazywamy brakiem.
  - `POST /api/delivery_os/projects/{id}/baselines` (`api/projects/[id]/baselines/route.ts:69`) przyjmuje `source: 'manual'` (cecha `delivery_os.projects.manage`, wymaga renderu) albo `source: 'requirements_proposal'` (cecha `delivery_os.results.import`, render opcjonalny).
  - `POST /api/delivery_os/baselines/{id}/decisions` (`api/baselines/[id]/decisions/route.ts:25`) zapisuje decyzję `requirements`/`design` związaną z `subjectHash` i `subjectVersion`.
  - `POST /api/delivery_os/projects/{id}/tasks` z `source: 'plan_proposal'` (`api/projects/[id]/tasks/route.ts:73`) tworzy w jednej transakcji **scalony, nieaktywny** baseline v+1 i zadania kluczowane `proposalTaskKey`.
- **Import designu nie ma komendy OSS i nie powstanie w tym oknie.** `validateDesignManifest` (`lib/designReview.ts:241`) nie ma produkcyjnego wywołania, a `baselineCreateSchema` (`data/validators.ts:203`) zna wyłącznie `manual` i `requirements_proposal`. Ekrany wchodzą do baseline'u jedyną istniejącą drogą: przez `draftSpec.screens` (`PUT /api/delivery_os/projects`) i późniejsze zamrożenie `source: 'manual'`.
- **`Attachment` nie przechowuje sha256** (`attachments/data/entities.ts:52` — są `mime_type`, `file_size`, `storage_path`, nie ma kolumny hasha). Serwer natomiast **weryfikuje bajty przy zamrożeniu**: `checkAttachmentBytes` (`lib/designReview.ts:345`) odrzuca render, którego sha256 nie zgadza się z zadeklarowanym, a `checkRawScreenRenders` (`:130`) odrzuca ekran mający tylko URL (`temporary_url_only`).
- **Sekcje szczegółów są prezentacyjne i patrzą wyłącznie na aktywny baseline.** `resolveActiveBaseline` (`components/detail/baselineContent.ts:15`) wybiera wpis z `isActive`; świeżo zamrożona, jeszcze niezatwierdzona wersja jest dla ekranu niewidoczna. Bez wyboru wersji nie da się jej zatwierdzić.
- **Historia decyzji jest read-only.** `DecisionHistory` (`components/detail/decisions.tsx`) nie ma żadnego przycisku — UI-02 świadomie odłożyło to do UI-03.
- **`DesignSection` jest metadanowy.** Nazwa, `nodeId`, viewport, `figmaVersion`, skrócony sha256, `capturedAt` — bez podglądu renderu. UI-02 przypisało miniatury do UI-03.
- **Otwarty finding F1 z review UI-02.** `TasksSection` zwija `hasActiveBaseline === null` do gałęzi negatywnej, więc przy trwałym błędzie `GET /baselines` sekcja zadań podaje **nieprawdziwą przyczynę** braku zadań. UI-02 przyjęło to jako ryzyko i wskazało UI-03 jako miejsce naprawy.
- **UI-01 zostawiło działającą sekwencję Figmy do ponownego użycia:** plik `5wOkFtN959W4MFmgRuaU8S`, `prompts.md` z sekwencją `create → read → update → read` w języku naturalnym oraz `capture.sh`/`verify.sh`, które utrwalają render z bytes/hash. Zmierzone ograniczenia: tier `starter` daje 10 odczytów na minutę (zapis poza limitem), a autoryzacja MCP wymaga jednorazowego logowania interaktywnego.
- **Środowisko lokalne nie jest zainicjalizowane.** Baza `open-mercato` nie ma tabel `delivery_*`, tabela `users` jest pusta, serwer dev nie działa. `AGENTS.md` zabrania `yarn db:migrate` i `yarn initialize` bez zgody, więc `TC-DELIVERY-UI-002` nigdy nie został uruchomiony.

### Key Discoveries

- **Kolejność zgód jest wymuszona przez domenę, nie przez UX.** `delivery_os.tasks.import_plan` żąda, żeby manifest planu wskazywał **aktywny** baseline (`proposal.baselineId === baseline.id` i `baselineHash === contentHash`, `lib/proposals.ts:203`), a aktywny staje się dopiero po **obu** decyzjach (`commands/decisions.ts:160`, `resolveActiveBaseline`). Bez działających decyzji nie ma czego importować jako plan.
- **Scalony baseline planu **nie** jest aktywowany.** `POST /tasks` z `plan_proposal` tworzy wersję v+1 z `parentBaselineId`, ale aktywacja wymaga **ponownych** dwóch decyzji dla nowego hasha. Zadania czekają — to nie jest błąd, to jest projekt.
- **`PUT /api/delivery_os/projects` zastępuje cały `draftSpec`.** `projectUpdateSchema.draftSpec` (`data/validators.ts:160`) to pełny obiekt `draftSpecV1Schema`, nie patch. Dopisanie jednego ekranu wymaga odczytu bieżącego draftu z `GET /projects/{id}`, sparsowania go schematem i odesłania całości — inaczej kasujemy cudze pola.
- **Każda mutacja zwraca `projectUpdatedAt`.** `baselineCreateResponseSchema`, `decisionCreateResponseSchema` i `planImportResponseSchema` (`api/schemas.ts`) zwracają nową wersję projektu. To jest nagłówek do następnego żądania — czytanie jej z odpowiedzi eliminuje wyścig „mutacja → refetch → druga mutacja".
- **Replay importu nie wymaga nagłówka wersji.** `importRequirementsCommand` sprawdza `findImportedManifest` **przed** `requireLockHeader` (`commands/baselines.ts:283`): ten sam `manifestId` z tą samą treścią daje `200 duplicate: true`, ta sama nazwa z inną treścią daje `409 idempotency_conflict`. UI musi rozróżnić te dwa wyniki — pierwszy jest sukcesem, drugi twardym błędem.
- **Otwarte uwagi nie blokują zamrożenia.** `buildBaselineContent` (`lib/baseline.ts:146`) przenosi do baseline'u wyłącznie `resolvedComments`, a nierozstrzygnięte zwraca jako `openCommentIds`. Zamrożenie z otwartymi uwagami się uda — UI musi o tym powiedzieć, nie przemilczeć.
- **Zamrożenie ręczne żąda renderu, import wymagań nie.** `checkDraftFreezable` (`commands/baselines.ts:72`) z `requireRender: true` dla `manual` i `false` dla `requirements_proposal`. Stąd realna kolejność: wymagania mogą powstać przed designem, design nie może powstać bez wymagań i AC.
- **Pojemność jest ograniczona na dwa sposoby.** Ciało żądania baseline'u: 8 MB (`MAX_BASELINE_BODY_BYTES`), manifest: 2 MB znaków (`MAX_MANIFEST_BODY_CHARS`), pojedynczy załącznik: 10 MB, suma załączników baseline'u: 64 MB (`lib/designReview.ts:27`).
- **`crypto.subtle` wymaga bezpiecznego kontekstu.** Liczenie sha256 w przeglądarce działa na `https` i na `localhost`; pod `http://` na innym hoście `window.crypto.subtle` jest `undefined`. To musi być wykrytym stanem błędu, nie cichym `NaN`.

## Desired End State

Operator zakłada projekt z briefu, wkleja manifest wymagań z sesji agenta i widzi baseline v1 z wymaganiami i AC. Wgrywa render ekranu wyprodukowanego przez agenta w Figmie, widzi jego miniaturę, zostawia uwagę przypiętą do tego ekranu, zamraża baseline v2 z designem. Przełącza się na wersję v2, zatwierdza wymagania i design — baseline staje się aktywny. Wkleja manifest planu, dostaje scalony baseline v3 i zadania; zatwierdza v3. Drugi projekt startuje od zatwierdzonych ekranów i ręcznie napisanego manifestu wymagań i przechodzi tym samym torem.

Każde odrzucenie ma powód. Zatwierdzenie nieaktualnej wersji zwraca konflikt nazwany jako konflikt wersji, a nie jako błąd zapisu. Import z obcą referencją, nieznaną wersją schematu, ścieżką poza profilem albo mapowaniem AC na nieistniejący test jest odrzucany z komunikatem wskazującym **które** pole zawiodło. Render, którego bajty nie zgadzają się z deklaracją, nie wchodzi do baseline'u.

Weryfikacja: testy komponentowe obu wejść przechodzą, `TC-DELIVERY-UI-003` jest napisany i samosprzątający, `yarn i18n:check-sync` i `check-usage` są czyste, a `git status --porcelain -- .../delivery_os/{api,commands,data,lib}` jest pusty.

## What We're NOT Doing

- **Nie dotykamy `api/`, `commands/`, `data/` ani `lib/`** w `delivery_os` — to powierzchnia OSS prowadzona równolegle. Potrzebna zmiana idzie do OSS jako prośba, nie jako commit UI.
- **Nie prosimy OSS o `source: 'design_manifest'`** i nie czekamy na niego. Ekrany składa klient — decyzja zapisana niżej w Implementation Approach.
- **Nie budujemy edytora wymagań ani formularza edycji projektu.** Ręczne wymagania FROM_DESIGN wchodzą tym samym dialogiem importu, jako manifest napisany przez człowieka. `DeliveryProjectForm` zostaje nietknięty.
- **Nie budujemy kotwic x/y na renderze.** Uwaga wiąże się z ekranem (`screenAttachmentId`), `anchor` zostaje `null`. Canvas z zoomem jest wykluczony przez plan główny.
- **Nie rekonstruujemy specyfikacji z obrazów.** FROM_DESIGN nie wyprowadza AC z ekranów — wymagania podaje człowiek.
- **Nie dodajemy pixel diff Figma–przeglądarka** ani automatycznego re-anchoringu uwag między wersjami.
- **Nie konsumujemy `GET /projects/{id}/evidence`** — endpoint nie istnieje, należy do OSS, a `EvidenceTable` należy do UI-05. Sekcja dowodów zostaje z komunikatem UI-02.
- **Nie dodajemy paginacji baseline'ów po stronie klienta.** Prośba (c) UI-02 czeka w OSS; sztuczne cięcie bez `total` z serwera kłamałoby o reszcie.
- **Nie tworzymy ekranu zadań ani UI wykonania/manual handoff** — to UI-04.
- **Nie uruchamiamy `yarn db:migrate` ani `yarn initialize`** bez osobnej zgody.

## Implementation Approach

**Ekrany składa klient, nie serwer.** Decyzja wynika z granicy własności: import designu wymagałby nowej komendy w `commands/` i nowego wariantu w `data/validators.ts` — obu UI-03 nie wolno dotknąć, a czekanie na cudzy commit w środku 7-godzinnego okna jest ryzykiem, którego nie ma czym pokryć. Klient wgrywa render przez `POST /api/attachments`, liczy sha256 bajtów przez `crypto.subtle`, dopisuje wpis do `draftSpec.screens` i zamraża baseline. To czyni sha256 **deklaracją klienta** — i dlatego serwerowa weryfikacja bajtów przy zamrożeniu jest jedynym miejscem, w którym ta deklaracja staje się prawdą. Konsekwencja dla UI jest twarda: błąd `attachment_hash_mismatch` / `sha256_mismatch` musi być pokazany jako **niezgodność renderu z deklaracją**, nigdy jako ogólny „błąd zapisu". Zatarcie tej różnicy zamieniłoby weryfikację w dekorację.

**Manifesty wchodzą przez wklejenie z podwójną walidacją.** Dialog parsuje treść schematem z `lib/contracts` **przed** wysłaniem i pokazuje ścieżkę błędu (`tasks.2.allowedPaths.0`), a odpowiedź serwera mapuje na osobne komunikaty per kod. Walidacja klientowa nie zastępuje serwerowej — skraca pętlę, gdy agent zwróci manifest z literówką, zamiast zmuszać operatora do czytania gołego 400 na demo.

**Wybór wersji jest warunkiem zatwierdzania, nie ozdobą.** Sekcje patrzą dziś na `isActive`, a zatwierdza się wersję, która aktywna jeszcze nie jest. `baselineContent.ts` dostaje `resolveBaseline(baselines, selectedId)` zachowujące te same trzy rozłączne stany (`none` / `unreadable` / `ready`); `resolveActiveBaseline` staje się przypadkiem `selectedId === null`. Wybrana wersja żyje w query param `?baselineId=`, tak samo jak `?taskId=` — przeżywa reload, daje deep-link do konkretnego snapshotu i po refetchu jest weryfikowana względem listy.

**Wersję projektu bierzemy z odpowiedzi, nie z kolejnego GET.** Każdy z trzech endpointów zwraca `projectUpdatedAt`. Sekwencja demo to cztery mutacje pod rząd na tym samym projekcie; refetch między nimi wprowadzałby okno, w którym nagłówek jest nieaktualny. Odświeżenie ekranu nadal następuje — ale dla oczu operatora, nie dla poprawności następnego żądania.

**Uwagi są stanem draftu, nie baseline'u.** `draftSpec.comments` z `status: 'open' | 'resolved'`; przy zamrożeniu rozstrzygnięte trafiają do `content.resolvedComments`, otwarte wracają w `openCommentIds`. Zamrożenie z otwartymi uwagami **się udaje** — UI mówi wprost ile ich zostało, zamiast sugerować, że snapshot jest czysty.

## Critical Implementation Details

**`draftSpec` jest zastępowany w całości.** Każda operacja na ekranach i uwagach to cykl odczyt → parse `draftSpecV1Schema` → mutacja → `PUT` całości z nagłówkiem wersji. Draft, którego nie da się sparsować, **nie** może zostać nadpisany „czystym" obiektem — to skasowałoby dane, których UI nie rozumie. Nieparsowalny draft blokuje edycję designu i mówi dlaczego.

**Kolejność kroków wymuszona przez walidację serwera.** Zamrożenie `manual` żąda równocześnie wymagań, AC **i** co najmniej jednego renderu (`checkDraftFreezable` z `requireRender: true`). Próba zamrożenia designu na pustym draftcie zwróci `missing_acceptance_criteria`, nie `missing_render` — priorytet kodów jest po stronie serwera i UI nie może go zgadywać, tylko pokazać to, co przyszło.

**Import planu ma sześć różnych powodów odmowy.** `unknown_ac`, `unknown_test_id`, `duplicate_stable_id`, `missing_required_tests`, `path_not_allowed`, `cycle` — priorytet ustala `CONTENT_PROBLEM_PRIORITY` (`lib/proposals.ts:107`), a `details[]` niosą ścieżki wszystkich problemów naraz. Pokazanie samego `error` zgubi to, co jest najbardziej użyteczne: listę pól do poprawy w manifeście.

**`crypto.subtle` może nie istnieć.** Przed pierwszym uploadem sprawdzić dostępność; brak bezpiecznego kontekstu to jawny, nazwany błąd („liczenie sha256 niedostępne — otwórz aplikację przez https albo localhost"), nie cicha awaria uploadu.

## Phase 1: Skills agentowe i import propozycji wymagań

### Overview

H6–H7:30. Doprowadzić do stanu, w którym agent ma zapisaną instrukcję, a operator zamienia jej wynik na baseline v1 bez curl-a.

### Changes Required

#### 1. Trzy skille agentowe

**Pliki:** `hackathon/delivery-demo/skills/{requirements-from-brief,plan-from-baseline,design-from-brief}.md` (nowe)

**Intent:** Zapisać instrukcje, które agent wykonuje w swojej sesji, żeby wynik dało się zaimportować bez ręcznego przepisywania. Każdy skill kończy się manifestem gotowym do wklejenia.

**Contract:** `requirements-from-brief` produkuje `RequirementsProposal v1` (3–5 wymagań, 6–8 AC, `projectId` z adresu projektu, `manifestId` stabilny w obrębie sesji, `producedBy.tool`); zawiera osobną sekcję o manifeście pisanym ręcznie dla FROM_DESIGN. `plan-from-baseline` produkuje `PlanProposal v1` — czyta `baselineId`/`baselineHash` z UI, mapuje AC na `acTestMap`, trzyma `allowedPaths` w rootach profilu i `dependsOn` bez cyklu. `design-from-brief` powtarza sekwencję UI-01 (`create → read → update → read`) na pliku próby, kończy `capture.sh` i nazywa oba zmierzone ograniczenia: 10 odczytów/min na tierze `starter` i konieczność interaktywnego logowania MCP. Wszystkie trzy podają `schemaVersion` dosłownie — nieznana wersja jest odrzucana przez `parseVersioned`.

#### 2. Fixture demonstracyjny designu

**Plik:** `hackathon/delivery-demo/fixtures/design-manifest.v1.json` (nowy)

**Intent:** Dać skillowi `design-from-brief` konkretny przykład wyniku i dać testom UI wejście do mapera ekranów.

**Contract:** `DesignManifest v1` z realnymi wartościami z próby UI-01 (`fileKey` `5wOkFtN959W4MFmgRuaU8S`, `nodeId` `3:2`, viewport 1440×1024, sha256 z `SHA256SUMS`). Kontraktowym źródłem prawdy pozostaje fixture OSS `lib/fixtures/design-manifest.v1.json` — ten plik jest przykładem demo, nie drugą definicją schematu. Test mapera w `components/detail/__tests__/` konsumuje go i tym samym pilnuje, że nie rozjedzie się ze schematem.

#### 3. Dialog importu propozycji wymagań

**Pliki:** `packages/core/src/modules/delivery_os/components/detail/ProposalImportDialog.tsx` (nowy), `.../components/detail/proposalImport.ts` (nowy)

**Intent:** Zamienić manifest z sesji agenta na baseline jednym wklejeniem, z błędem wskazującym pole, a nie samym kodem HTTP.

**Contract:** `proposalImport.ts` — czysta funkcja parsująca treść: JSON → `requirementsProposalV1Schema` → `{ ok, manifest }` lub `{ ok: false, path, code }`. Dialog: textarea z licznikiem znaków i limitem 2 MB, podgląd przed wysłaniem (liczba wymagań i AC, `producedBy.tool`, `manifestId`), `Cmd/Ctrl+Enter` zatwierdza, `Escape` anuluje. Wysyłka: `POST /api/delivery_os/projects/{id}/baselines` z `{ source: 'requirements_proposal', manifest }`, owinięta `useGuardedMutation(...).runMutation(...)` i `withScopedApiRequestHeaders(buildOptimisticLockHeader(project.updatedAt), …)`. Rozłączne wyniki: `201` → baseline utworzony; `200 duplicate: true` → **sukces**, komunikat „ten manifest był już zaimportowany jako v{version}"; `409 idempotency_conflict` → twardy błąd nazywający kolizję nazwy manifestu; `409 optimistic_lock_conflict` → `surfaceRecordConflict`; `422 foreign_project` / `unsupported_schema_version` → komunikat per kod; `413` → przekroczony limit ciała.

#### 4. Osadzenie w sekcji wymagań

**Pliki:** `.../components/detail/RequirementsSection.tsx`, `.../backend/delivery/projects/[id]/DeliveryProjectDetailClient.tsx`

**Intent:** Udostępnić import z miejsca, w którym operator ogląda wymagania, i odświeżyć ekran po powodzeniu.

**Contract:** Akcja widoczna tylko przy cesze `delivery_os.results.import`. Po sukcesie: `projectUpdatedAt` z odpowiedzi zastępuje lokalną wersję projektu, po czym `refresh()` odświeża projekt i sekcje. Nowe klucze i18n dopisane do **pięciu** plików locale w porządku alfabetycznym.

### Success Criteria

#### Automated Verification

- `yarn workspace @open-mercato/core test --testPathPatterns='delivery_os'` przechodzi, w tym nowe testy `proposalImport` (poprawny manifest, zła wersja schematu, obcy `projectId`, AC wskazujące nieistniejące wymaganie, treść niebędąca JSON-em).
- Test dialogu rozróżnia `200 duplicate` od `409 idempotency_conflict` — dwa różne komunikaty, nie jeden.
- `yarn i18n:check-sync` i `yarn i18n:check-usage` są czyste; `yarn i18n:check-hardcoded` nie zgłasza `delivery_os`.
- Fixture `hackathon/delivery-demo/fixtures/design-manifest.v1.json` parsuje się `designManifestV1Schema` w teście.
- `git status --porcelain -- packages/core/src/modules/delivery_os/{api,commands,data,lib}` jest pusty.

#### Manual Verification

- Agent wykonuje `requirements-from-brief` i zwraca manifest; operator wkleja go i widzi baseline v1 z wymaganiami i AC.
- Powtórne wklejenie tego samego manifestu mówi „już zaimportowany", nie tworzy drugiej wersji.

**Implementation Note:** Po zakończeniu fazy i przejściu weryfikacji automatycznej zatrzymać się i poczekać na ręczne potwierdzenie przed przejściem dalej.

---

## Phase 2: Design — render, sha256, ekrany w draftcie i zamrożenie

### Overview

H7:30–H10. Doprowadzić do stanu, w którym render wyprodukowany przez agenta w Figmie staje się częścią zamrożonego baseline'u, z widoczną miniaturą i przypiętą uwagą.

### Changes Required

#### 1. Liczenie sha256 i upload renderu

**Plik:** `.../components/detail/screenUpload.ts` (nowy)

**Intent:** Zamienić plik z dysku w kompletny wpis `ScreenRef`, którego serwer nie odrzuci.

**Contract:** `hashFile(file): Promise<string>` — `crypto.subtle.digest('SHA-256', bytes)` na hex; brak `crypto.subtle` zwraca nazwany błąd, nie wyjątek bez treści. `uploadScreen(file, projectId)` — `POST /api/attachments` (multipart: `entityId` = identyfikator encji projektu, `recordId` = `projectId`, `file`), odpowiedź `{ ok, item: { id, fileSize } }`. Wynik: `{ attachmentId, sha256, sizeBytes, mimeType }`. Walidacja przed uploadem: typ w `DESIGN_RENDER_MIME_TYPES` (`image/png`, `image/jpeg`, `image/webp`) i rozmiar ≤ 10 MB — te same progi, których serwer użyje przy zamrożeniu, sprawdzone zanim operator straci czas na upload.

#### 2. Formularz dodania ekranu

**Plik:** `.../components/detail/ScreenImportDialog.tsx` (nowy)

**Intent:** Zebrać metadane Figmy i render w jednym kroku, bez ręcznego przepisywania hasha.

**Contract:** Pola dokładnie z `screenRefSchema`: `name`, `fileKey`, `nodeId` (oba nullable), `viewport.width/height`, `figmaVersion` (opcjonalne — zapisywane tylko gdy podane), plus plik renderu. `capturedAt` ustawiany na moment uploadu. Sekundarne wejście: wklejenie `DesignManifest v1` wypełnia metadane wszystkich ekranów, a operator dokłada pliki — mapowanie po `nodeId`, brak pliku dla wpisu jest jawnym błędem, nie cichym pominięciem. Zapis: odczyt `draftSpec` z `GET /projects/{id}`, parse `draftSpecV1Schema`, dopisanie ekranu, `PUT /api/delivery_os/projects` z `{ id, draftSpec }` i nagłówkiem wersji. Draft nieparsowalny blokuje zapis z własnym komunikatem.

#### 3. Uwagi przypięte do ekranu

**Plik:** `.../components/detail/ScreenComments.tsx` (nowy)

**Intent:** Dać człowiekowi kanał uwagi do konkretnego snapshotu, który przetrwa do baseline'u.

**Contract:** Uwaga zapisywana w `draftSpec.comments` jako `{ id, screenAttachmentId, anchor: null, body, status: 'open' }`; rozstrzygnięcie ustawia `status: 'resolved'` i wymaga `resolution`. `checkDesignReview` odrzuci uwagę wskazującą ekran spoza draftu (`unknown_screen`) — UI nie pozwala jej utworzyć, ale mapuje też odpowiedź serwera, bo draft mogła zmienić druga karta.

#### 4. Miniatury w sekcji designu

**Plik:** `.../components/detail/DesignSection.tsx`

**Intent:** Pokazać render, a nie tylko jego hash — bez tego zatwierdzanie designu ocenia metadane.

**Contract:** Podgląd z `/api/attachments/image/{attachmentId}` obok istniejących metadanych; obraz, którego nie da się wczytać, daje nazwany stan („render niedostępny — brak uprawnienia `attachments.view` albo plik usunięty"), nie pusty prostokąt. Metadane zostają — miniatura ich nie zastępuje.

#### 5. Zamrożenie ręczne

**Pliki:** `.../components/detail/FreezeBaselineAction.tsx` (nowy), `RequirementsSection.tsx`

**Intent:** Zamienić draft z wymaganiami i ekranami w kolejną wersję baseline'u.

**Contract:** `POST /projects/{id}/baselines` z `{ source: 'manual' }`, cecha `delivery_os.projects.manage`, nagłówek wersji projektu. Wyniki rozłączne: `201` → nowa wersja, a niepusta `openCommentIds` daje **osobny** komunikat „zamrożono z {n} nierozstrzygniętymi uwagami"; `200 duplicate` → „treść identyczna z v{version}, nowa wersja nie powstała"; `422 missing_render` / `missing_acceptance_criteria` → komunikat per kod; `409` z `sha256_mismatch` / `render_bytes_not_image` / `attachment_scope_mismatch` → komunikat nazywający **niezgodność renderu z deklaracją**, nigdy „błąd zapisu".

### Success Criteria

#### Automated Verification

- Testy `screenUpload`: hash znanego bufora zgadza się z wartością referencyjną; brak `crypto.subtle` daje nazwany błąd; plik złego typu i za duży są odrzucane przed uploadem.
- Test mapera `DesignManifest → ScreenRef[]` na fixture demo: brak pliku dla wpisu manifestu jest błędem.
- Test zapisu draftu: nieparsowalny `draftSpec` blokuje zapis i nie wysyła `PUT`.
- Test `FreezeBaselineAction`: cztery rozłączne komunikaty dla `201` z pustym i niepustym `openCommentIds`, `200 duplicate` i `409 sha256_mismatch`.
- Test `DesignSection`: nieudane wczytanie obrazu daje nazwany stan, a metadane zostają widoczne.
- Pełny zestaw testów modułu, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `lint` przechodzą; granica własności pusta.

#### Manual Verification

- Agent tworzy ekran w Figmie i zwraca render; operator wgrywa go, widzi miniaturę i zostawia uwagę.
- Agent poprawia ten sam `nodeId`; operator wgrywa nowy render, widzi **inny** sha256 i zamraża kolejną wersję.
- Podmieniony plik pod zadeklarowanym hashem zostaje odrzucony z komunikatem o niezgodności renderu.

**Implementation Note:** Zatrzymać się po tej fazie na ręczne potwierdzenie — to pierwsza faza, która realnie dotyka Figmy i limitów tieru.

---

## Phase 3: Wersje, decyzje i odrzucenie starej wersji

### Overview

H12–H13:30. Doprowadzić do stanu, w którym człowiek zatwierdza konkretną wersję baseline'u, odrzuca ją z powodem i widzi, że aktywna stała się właśnie ta, którą zatwierdził.

### Changes Required

#### 1. Wybór oglądanej wersji

**Pliki:** `.../components/detail/baselineContent.ts`, `.../components/detail/BaselineSectionFrame.tsx`, `.../components/detail/BaselineVersionBar.tsx` (nowy), `.../components/detail/useProjectSections.ts`

**Intent:** Umożliwić oglądanie i ocenianie wersji, która nie jest jeszcze aktywna — bez tego zatwierdzanie nie ma przedmiotu.

**Contract:** `resolveBaseline(baselines, selectedId: string | null): ActiveBaseline` zachowuje trzy rozłączne stany; `resolveActiveBaseline` staje się `resolveBaseline(baselines, null)`. `BaselineVersionBar` listuje wersje (`v{n}`, skrócony hash, znaczniki `aktywna` / `zatwierdzona` / `odrzucona` / `oczekuje`) i ustawia `?baselineId=`. Domyślny wybór: aktywna, a przy jej braku najnowsza. Po refetchu wybór weryfikowany względem listy — zniknięcie wersji czyści wybór zamiast renderować martwe id.

#### 2. Akcje decyzji w sekcjach

**Pliki:** `.../components/detail/DecisionActions.tsx` (nowy), `RequirementsSection.tsx`, `DesignSection.tsx`

**Intent:** Postawić decyzję obok treści, którą ocenia — operator nie zatwierdza „wymagań" w oderwaniu od tego, co widzi.

**Contract:** `POST /api/delivery_os/baselines/{baselineId}/decisions` z `{ kind: 'requirements' | 'design', verdict, subjectHash: baseline.contentHash, subjectVersion: baseline.version, reason? }`, cecha `delivery_os.baselines.approve`, nagłówek wersji projektu. Odrzucenie wymusza powód przed wysłaniem (`createCrudFormError`) — serwer i tak go wymaga (`requireReasonWhenRejected`), ale operator nie powinien się o tym dowiadywać z 400. Rozłączne wyniki: `201` → zapisana decyzja, a zmiana `activeBaselineId` w odpowiedzi daje osobny komunikat „baseline v{n} jest teraz aktywny"; `409 subject_hash_mismatch` → „ta wersja zmieniła się, odśwież"; `409 optimistic_lock_conflict` → `surfaceRecordConflict`; `422 stored_content_altered` → komunikat nazywający naruszenie integralności zapisanej treści; `403` → brak cechy. Historia decyzji (`DecisionHistory`) zostaje i po zapisie się odświeża.

#### 3. Naprawa F1

**Plik:** `.../components/detail/TasksSection.tsx`

**Intent:** Przestać twierdzić, że projekt nie ma baseline'u, kiedy stan baseline'u jest nieznany.

**Contract:** Przy `hasActiveBaseline === null` nie renderować żadnego z dwóch komunikatów domenowych — sekcja zadań milczy o przyczynie do czasu rozstrzygnięcia baseline'ów, a błąd pobrania pokazują sekcje, które go faktycznie zaobserwowały. Trzeci stan jest już w typie (`boolean | null`); zmienia się wyłącznie warunek renderu. Test pokrywa `null` **bez** `state: 'error'` — dziś jedyny przypadek z `null` zwiera się wcześniej na błędzie i nie dowodzi niczego.

### Success Criteria

#### Automated Verification

- Test wyboru wersji: domyślnie aktywna; przy braku aktywnej najnowsza; `?baselineId=` wskazujące nieistniejącą wersję czyści wybór, a nie renderuje martwe id.
- Test `DecisionActions`: odrzucenie bez powodu nie wysyła żądania; `subjectHash`/`subjectVersion` w ciele pochodzą z **oglądanej** wersji, nie z aktywnej.
- Test rozłączności: `409 subject_hash_mismatch` i `409 optimistic_lock_conflict` dają dwa różne komunikaty, a ten drugi baner konfliktu rekordu.
- Test F1: `hasActiveBaseline === null` przy `state: 'ready'` **nie** renderuje komunikatu „brak baseline'u".
- Pełny zestaw testów modułu, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `lint` przechodzą; granica własności pusta.

#### Manual Verification

- Operator zatwierdza wymagania i design na v2 i widzi, że v2 stała się aktywna.
- Operator odrzuca v1 z powodem; odrzucenie jest widoczne w historii i nie aktywuje tej wersji.
- Próba zatwierdzenia z drugiej karty po zmianie projektu w pierwszej daje baner konfliktu wersji.

**Implementation Note:** 3.4 wymaga obecnego człowieka zatwierdzającego. Brak tej osoby oznacza kryterium niezaliczone — nie zastępować jej automatycznym upływem czasu.

---

## Phase 4: Import planu, przejście FROM_DESIGN i spec integracyjny

### Overview

H13:30–H15. Domknąć oba wejścia: zatwierdzony baseline prowadzi do zadań, a drugi projekt przechodzi tym samym torem od zatwierdzonych ekranów.

### Changes Required

#### 1. Import propozycji planu

**Pliki:** `.../components/detail/proposalImport.ts`, `.../components/detail/ProposalImportDialog.tsx`, `.../components/detail/TasksSection.tsx`

**Intent:** Zamienić manifest planu w scalony baseline i zadania, z błędem wskazującym pole manifestu.

**Contract:** Ten sam dialog w wariancie planu: parse `planProposalV1Schema` przed wysłaniem, podgląd (liczba zadań, `architectureSummary`, `baselineId`/`baselineHash`, do którego manifest się odnosi). Wysyłka: `POST /api/delivery_os/projects/{id}/tasks` z `{ source: 'plan_proposal', manifest }`, cecha `delivery_os.results.import`, nagłówek wersji projektu. Odpowiedź `201` → `{ baselineId, version, tasks[] }`, a komunikat mówi wprost, że **scalony baseline v{n} nie jest aktywny i wymaga ponownych dwóch decyzji** — bez tego zdania operator uzna zadania za gotowe do wykonania. `200 duplicate` → replay. Błędy treści: `details[]` renderowane jako **lista** ścieżek (`tasks.2.acIds.0`, `acTestMap.AC-3`), nie pojedynczy komunikat; kody `unknown_ac`, `unknown_test_id`, `duplicate_stable_id`, `missing_required_tests`, `path_not_allowed`, `cycle`, `baseline_hash_mismatch` mają własne nagłówki.

#### 2. Przejście FROM_DESIGN

**Pliki:** `hackathon/delivery-demo/skills/requirements-from-brief.md`, `.../components/detail/ProposalImportDialog.tsx`

**Intent:** Domknąć drugie wejście bez budowania edytora wymagań i bez reverse specification.

**Contract:** Kolejność dla FROM_DESIGN: najpierw ekrany (Faza 2), potem manifest wymagań napisany **przez człowieka** i zaimportowany tym samym dialogiem, dalej identycznie. Podgląd przed importem pokazuje `producedBy.tool`, żeby pochodzenie propozycji było widoczne w momencie decyzji — w zapisanym baseline zostaje po niej wyłącznie `manifestId`/`manifestHash` w `importedManifests` oraz wpis w audycie, i tak to jest opisane w przekazaniu. Skill dostaje sekcję „manifest pisany ręcznie" z minimalnym szkieletem i listą pól wymaganych.

#### 3. Spec integracyjny obu wejść

**Plik:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-UI-003.spec.ts` (nowy)

**Intent:** Zapisać wykonywalny scenariusz obu wejść, zanim środowisko będzie gotowe — żeby nie pisała go osoba nieznająca decyzji UI.

**Contract:** Samosprzątający, bez zależności od danych seed. FROM_BRIEF: projekt → import wymagań → upload renderu → zamrożenie → dwie decyzje → import planu → sprawdzenie, że zadania istnieją i że scalony baseline **nie** jest aktywny. FROM_DESIGN: projekt → ekran → ręczny manifest wymagań → ten sam tor. Ścieżki negatywne: manifest o nieznanej `schemaVersion`, manifest z obcym `projectId`, decyzja z nieaktualnym `subjectHash`. Teardown archiwizuje **własne** projekty po id, nie pierwszy wiersz listy — poprawka wzorowana na findingu F2 z review UI-02. Tytuły testów z prefiksem `TC-DELIVERY`.

#### 4. Przekazanie

**Plik:** `context/changes/autonomous-software-delivery/workstreams/ui-03/handoff.md` (nowy)

**Intent:** Podać następnym strumieniom commit, wynik testów, runner i ograniczenia — zgodnie z zasadami wykonania strumienia.

**Contract:** Rewizja z przechodzącym zestawem testów, wybrany runner, zakres dostarczony, zakres świadomie pominięty, luki pokrycia, prośby do OSS (import designu jako komenda; `producedBy` w `importedManifests`, jeśli pochodzenie ma przetrwać w danych, a nie tylko w audycie) oraz lista kontroli ręcznych, których nikt nie wykonał. Progress planu głównego **nie** jest w tym pliku zaznaczany.

### Success Criteria

#### Automated Verification

- Testy `proposalImport` dla planu: cykl, nieznane AC, `allowedPaths` poza rootami profilu i mapowanie AC na nieistniejący test są odrzucane po stronie klienta ze wskazaniem ścieżki.
- Test dialogu planu: `details[]` z odpowiedzi renderują się jako lista wszystkich ścieżek, nie jako jeden komunikat.
- Test komunikatu po imporcie: zawiera stwierdzenie o nieaktywnym scalonym baseline.
- `TC-DELIVERY-UI-003` istnieje, przechodzi `typecheck` i `lint`, a jego teardown adresuje projekty po id.
- Pełna bramka po wybraniu runnera: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.
- `yarn check:client-boundaries` nie zgłasza nowych naruszeń — wymóg Frontend Architecture Contract z pakietu UI; ten plan nie dodaje nowych client page roots, więc każde zgłoszenie jest regresją.
- `git status --porcelain -- packages/core/src/modules/delivery_os/{api,commands,data,lib}` jest pusty.
- `git status --porcelain -- '*.generated.*'` jest pusty — plan nie dodaje stron, więc rejestry pozostają własnością Mateusza.
- Żaden z sześciu nowych komponentów klienckich nie przekracza 300 LOC.

#### Manual Verification

- Operator przechodzi FROM_BRIEF do końca: od briefu do zadań przypiętych do zatwierdzonego baseline'u.
- Operator przechodzi FROM_DESIGN z istniejącym ekranem i ręcznymi AC, bez deklaracji automatycznej reverse specification.
- Manifest planu przygotowany dla starej wersji baseline'u zostaje odrzucony z `baseline_hash_mismatch`.

**Implementation Note:** `TC-DELIVERY-UI-003` **nie zostanie uruchomiony** w tym oknie — środowisko nie jest zainicjalizowane, a `yarn db:migrate` i `yarn initialize` wymagają osobnej zgody. Zapisać to w przekazaniu jako świadomą decyzję, nie jako przeoczenie; kryteria 3.1–3.3 i 3.6 pozostają niezaznaczone do wspólnego odbioru z OSS-03 i QA-03.

---

## Testing Strategy

### Testy jednostkowe i komponentowe

Parsery manifestów (poprawny, zła wersja schematu, obca referencja, nie-JSON), maper `DesignManifest → ScreenRef[]`, `hashFile` na znanym buforze, cykl odczyt–mutacja–zapis `draftSpec`, rozłączność komunikatów dla każdego kodu błędu, wybór wersji baseline'u, naprawa F1. Testy mają wykazywać różnicę między błędnym a poprawnym wynikiem — asercja, która przechodzi strukturalnie niezależnie od implementacji, nie jest testem (finding F3 z review UI-02).

### Integration coverage

`TC-DELIVERY-UI-003` pokrywa ścieżki wymienione w Fazie 4. Uzupełnia `TC-DELIVERY-UI-002`, który prowadzi projekt **bez** baseline'u i z założenia nie dotyka ani designu, ani decyzji.

### Kontrola ręczna

Kolejność do wykonania przy działającej aplikacji: import wymagań → upload renderu i uwaga → zamrożenie → dwie decyzje → import planu → zatwierdzenie scalonej wersji → powtórka jako FROM_DESIGN. Osobno: odrzucenie starej wersji z powodem, podmieniony render pod zadeklarowanym hashem, konflikt wersji z drugiej karty.

### Komendy i runner

Runner wybrać **raz** na całą sekwencję: przy działającym kontenerze `app` w compose używać `node scripts/docker-exec.mjs X` zamiast `yarn X`, inaczej trybu lokalnego. Zanotować wybór w przekazaniu.

**Ten plan nie dodaje żadnej strony**, więc nie wymaga regeneracji rejestru modułów i **nie powinien zmienić ani jednego pliku `*.generated.*`**. To nie jest drobiazg: [README zespołu](../../flow-handoff/README.md) przypisuje wspólne pliki domeny i rejestrów Mateuszowi. Diff w wygenerowanym rejestrze jest sygnałem, że zmiana wyszła poza zakres UI — sprawdzić, zanim trafi do commita, a nie tłumaczyć po fakcie.

## Performance Considerations

Sekcja designu renderuje miniatury wszystkich ekranów aktywnego baseline'u; limit schematu to 100 ekranów, a `GET /baselines` nie ma paginacji (prośba (c) UI-02 czeka w OSS). Dla scenariusza demo (do 8 AC i 6 zadań, 1–2 ekrany) to nie jest problem — ale miniatury ładować leniwie (`loading="lazy"`), żeby pierwszy render nie czekał na obrazy. Liczenie sha256 dla pliku 10 MB w `crypto.subtle` jest jednorazowe i nieblokujące UI, o ile odczyt pliku idzie przez `arrayBuffer()`, a nie przez synchroniczne API.

## Migration & Backward Compatibility

Zmiana jest addytywna i mieści się w `delivery_os/backend/`, `delivery_os/components/`, `delivery_os/i18n/` oraz `hackathon/delivery-demo/`. Nie zmienia żadnej powierzchni kontraktowej: ani schematów w `lib/contracts.ts`, ani route'ów, ani ACL, ani spot ID. `resolveActiveBaseline` pozostaje wyeksportowane po uogólnieniu do `resolveBaseline` — istniejące wywołania i testy działają bez zmian.

## References

- Plan główny: [`../../plan.md`](../../plan.md) — Faza 3 i Progress 3.1–3.6
- Strumień: [`../03-design-ui.md`](../03-design-ui.md) — UI-03
- Poprzednik: [`../ui-02/plan.md`](../ui-02/plan.md), [`../ui-02/handoff.md`](../ui-02/handoff.md), [`../ui-02/reviews/impl-review.md`](../ui-02/reviews/impl-review.md)
- Dowody Figmy z UI-01: `hackathon/delivery-demo/evidence/figma/{prompts.md,manifest.json,capture.sh,verify.sh}`
- Kontrakty OSS: `packages/core/src/modules/delivery_os/lib/{contracts,proposals,designReview,baseline}.ts`
- Komendy: `packages/core/src/modules/delivery_os/commands/{baselines,decisions,planImport,attachments}.ts`
- Wzorce UI: `packages/core/src/modules/delivery_os/components/projects/DeliveryProjectListClient.tsx` (guarded mutation, konflikt, optimistic lock)

## Progress

> Konwencja: `- [ ]` oczekuje, `- [x]` wykonane. Po wdrożeniu dopisz ` — <commit sha>`. Nie zmieniaj tytułów kroków. Ten Progress dotyczy wykonania UI-03; kryteria odbioru 3.1–3.6 zaznacza się wyłącznie w [planie głównym](../../plan.md#progress), po dowodach od OSS-03, UI-03 i QA-03.

### Phase 1: Skills agentowe i import propozycji wymagań

#### Automated

- [x] 1.1 Testy modułu przechodzą, w tym nowe testy `proposalImport` dla pięciu ścieżek wejścia — 70f57edc53
- [x] 1.2 Test dialogu rozróżnia `200 duplicate` od `409 idempotency_conflict` — 70f57edc53
- [x] 1.3 `i18n:check-sync`, `i18n:check-usage` i `i18n:check-hardcoded` są czyste — 70f57edc53
- [x] 1.4 Fixture `design-manifest.v1.json` parsuje się `designManifestV1Schema` w teście — 70f57edc53
- [x] 1.5 Granica własności `{api,commands,data,lib}` jest pusta — 70f57edc53

#### Manual

- [ ] 1.6 Agent zwraca manifest wymagań; operator wkleja go i widzi baseline v1
- [ ] 1.7 Powtórne wklejenie mówi „już zaimportowany" i nie tworzy drugiej wersji

### Phase 2: Design — render, sha256, ekrany w draftcie i zamrożenie

#### Automated

- [x] 2.1 Testy `screenUpload`: hash referencyjny, brak `crypto.subtle`, zły typ i za duży plik — 70f57edc53
- [x] 2.2 Test mapera `DesignManifest → ScreenRef[]`: brak pliku dla wpisu jest błędem — 70f57edc53
- [x] 2.3 Test zapisu draftu: nieparsowalny `draftSpec` blokuje `PUT` — 70f57edc53
- [x] 2.4 Test `FreezeBaselineAction`: cztery rozłączne komunikaty dla czterech wyników — 70f57edc53
- [x] 2.5 Test `DesignSection`: nieudane wczytanie obrazu daje nazwany stan, metadane zostają — 70f57edc53
- [x] 2.6 Testy modułu, `i18n:*`, `typecheck` przechodzą; granica własności pusta — **`lint` pominięty na polecenie użytkownika** — 70f57edc53

#### Manual

- [ ] 2.7 Agent tworzy ekran; operator wgrywa render, widzi miniaturę i zostawia uwagę
- [ ] 2.8 Agent poprawia ten sam `nodeId`; nowy render ma inny sha256 i daje kolejną wersję
- [ ] 2.9 Podmieniony plik pod zadeklarowanym hashem zostaje odrzucony jako niezgodność renderu

### Phase 3: Wersje, decyzje i odrzucenie starej wersji

#### Automated

- [x] 3.1 Test wyboru wersji: domyślna, najnowsza przy braku aktywnej, martwe `?baselineId=` czyszczone — 70f57edc53
- [x] 3.2 Test `DecisionActions`: odrzucenie bez powodu nie wysyła żądania; hash i wersja z oglądanej wersji — 70f57edc53
- [x] 3.3 Test rozłączności `subject_hash_mismatch` i `optimistic_lock_conflict` — 70f57edc53
- [x] 3.4 Test F1: `hasActiveBaseline === null` przy `state: 'ready'` nie twierdzi „brak baseline'u" — 70f57edc53
- [x] 3.5 Testy modułu, `i18n:*`, `typecheck` przechodzą; granica własności pusta — **`lint` pominięty na polecenie użytkownika** — 70f57edc53

#### Manual

- [ ] 3.6 Operator zatwierdza wymagania i design na v2; v2 staje się aktywna
- [ ] 3.7 Operator odrzuca v1 z powodem; odrzucenie widoczne, wersja nieaktywowana
- [ ] 3.8 Zatwierdzenie z drugiej karty po zmianie projektu daje baner konfliktu wersji

### Phase 4: Import planu, przejście FROM_DESIGN i spec integracyjny

#### Automated

- [x] 4.1 Testy `proposalImport` dla planu: cykl, nieznane AC, `allowedPaths`, mapowanie na nieistniejący test — 70f57edc53
- [x] 4.2 Test dialogu planu: `details[]` renderują się jako lista wszystkich ścieżek — 70f57edc53
- [x] 4.3 Test komunikatu po imporcie zawiera stwierdzenie o nieaktywnym scalonym baseline — 70f57edc53
- [x] 4.4 `TC-DELIVERY-UI-003` istnieje, przechodzi `typecheck` i `lint`, teardown adresuje projekty po id — 70f57edc53
- [ ] 4.5 Pełna bramka OM przechodzi na wybranym runnerze — **niewykonana: `yarn test`, `yarn lint` i `yarn build:app` pominięte na polecenie użytkownika**
- [x] 4.6 `yarn check:client-boundaries` nie zgłasza nowych naruszeń — 70f57edc53
- [x] 4.7 Granica własności `{api,commands,data,lib}` jest pusta — 70f57edc53
- [x] 4.8 Brak zmian w plikach `*.generated.*`; żaden nowy komponent kliencki nie przekracza 300 LOC — 70f57edc53

#### Manual

- [ ] 4.9 Operator przechodzi FROM_BRIEF od briefu do zadań przypiętych do zatwierdzonego baseline'u
- [ ] 4.10 Operator przechodzi FROM_DESIGN bez deklaracji automatycznej reverse specification
- [ ] 4.11 Manifest planu dla starej wersji zostaje odrzucony z `baseline_hash_mismatch`
