# UI-03 — przekazanie

> Ten plik **nie zalicza** żadnego kryterium [planu głównego](../../plan.md#progress). Kryteria 3.1–3.6 są
> współodbiorem OSS-03, UI-03 i QA-03; 3.4 i 3.5 wymagają dodatkowo obecnego człowieka zatwierdzającego.
> Nowe ID odbioru (FLOW-01…09, WP-01…05) rozlicza sekcja „Pozycja wobec korekty kierunku" w
> [planie UI-03](plan.md) — ten plan **nie zamyka żadnego z nich samodzielnie**.

## Rewizja i runner

- **Runner walidacji:** **local**. `docker ps` pokazuje tylko `mercato-postgres`, `mercato-meilisearch`
  i kontenery obcych projektów; kontenera `app` z compose nie ma, więc tryb Docker nie ma zastosowania.
- **Wykonane i przechodzące:** `yarn build:packages` → `yarn generate` → `yarn build:packages` →
  `yarn i18n:check-sync` → `yarn i18n:check-usage` → `yarn i18n:check-hardcoded` → `yarn typecheck` →
  `yarn check:client-boundaries`, plus `yarn workspace @open-mercato/core test --testPathPatterns='delivery_os'`.
- **Testy modułu:** 61 suit / 1257 testów przechodzi. UI-02 zostawiło 52 suity / 1174 testy;
  UI-03 dokłada 9 suit komponentowych (106 testów w `components/`).
- **ŚWIADOMIE POMINIĘTE NA POLECENIE UŻYTKOWNIKA — nie zostały uruchomione i nic o nich nie wiadomo:**
  **`yarn test`** (pełny zestaw monorepo, poza modułem `delivery_os`), **`yarn lint`** (pełna bramka
  lintera) oraz **`yarn build:app`**. Przed decyzją o pominięciu uruchomiono `npx eslint` na zmienionych
  plikach `delivery_os` — 0 błędów, 4 ostrzeżenia (trzy zastane: `scopeVersion` w dwóch hookach; jedno nowe:
  `@next/next/no-img-element` dla miniatury renderu, zgodne z istniejącym wzorcem `AiChat.tsx` dla tego
  samego endpointu). To ostrzeżenie **nie** jest dowodem, że pełny `yarn lint` przechodzi — ten nie został
  wykonany. Kto wznawia bramkę, zaczyna od tych trzech komend.
- **Granica własności pusta:** `git status --porcelain -- packages/core/src/modules/delivery_os/{api,commands,data,lib}`
  nie zwraca nic. To samo dla `*.generated.*` — plan nie dodaje żadnej strony, więc rejestry pozostają
  własnością Mateusza.

## Zakres dostarczony

**Skille agentowe i fixture demo** (`hackathon/delivery-demo/`)
- `skills/requirements-from-brief.md` — `RequirementsProposal v1`, 3–5 wymagań i 6–8 AC, rozróżnienie
  `200 duplicate` (zmień nic) od `409 idempotency_conflict` (zmień `manifestId`, nie treść), oraz osobna
  sekcja „manifest pisany ręcznie" dla FROM_DESIGN z minimalnym szkieletem i listą pól wymaganych.
- `skills/plan-from-baseline.md` — `PlanProposal v1`, warunek wejścia (plan odnosi się do **aktywnego**
  baseline'u), sześć powodów odmowy z ich ścieżkami i jawne zdanie, że scalony baseline **nie jest aktywny**.
- `skills/design-from-brief.md` — sekwencja `create → read → update → read` z UI-01 i **oba zmierzone
  ograniczenia wymienione przed startem**: 10 odczytów/min na tierze `starter` oraz jednorazowe interaktywne
  logowanie MCP. Wprost mówi, czego **nie** obejmuje: odczytu komentarzy Figmy (osobny probe) i pixel diffu.
- `fixtures/design-manifest.v1.json` — przykład demo z realnych wartości próby UI-01
  (`5wOkFtN959W4MFmgRuaU8S`, `3:2`, 1440×1024, sha256 renderu po kroku `update`). Kontraktowym źródłem prawdy
  pozostaje fixture OSS `lib/fixtures/design-manifest.v1.json`; test komponentowy konsumuje plik demo i pilnuje,
  że nie rozjedzie się ze schematem.

**Import propozycji — wymagania i plan** (`components/detail/`)
- `proposalImport.ts` — czyste parsery obu manifestów. Rozłączne wyniki wejścia: `empty`, `too_large`,
  `not_json`, `not_object`, `schema`. **Kod dostawczy czytany z `params.deliveryCode`**, nie z `issue.code`:
  `addDeliveryIssue` zgłasza wszystko jako zod `custom`, więc bez tego cykl, obca zależność i zakazana ścieżka
  dostałyby to samo słowo — a serwer raportuje w `details[]` dokładnie te kody.
- `ProposalImportDialog.tsx` + `ProposalPreview.tsx` — jeden dialog w dwóch wariantach. Podgląd przed wysyłką,
  licznik znaków z limitem 2 MB, `Cmd/Ctrl+Enter` zatwierdza, `Escape` anuluje (`DialogContent`).
  Wariant `requirements` → `POST /projects/{id}/baselines` z `source: 'requirements_proposal'`;
  wariant `plan` → `POST /projects/{id}/tasks` z `source: 'plan_proposal'`.
  Rozłączne wyniki: `201` utworzony; `200 duplicate` **sukces** z własnym komunikatem;
  `409 idempotency_conflict` twardy błąd nazywający kolizję nazwy manifestu; `409 optimistic_lock_conflict`
  → `surfaceRecordConflict`; `422` per kod; `413` limit ciała. `details[]` z serwera renderują się jako
  **lista wszystkich ścieżek**, nie jeden komunikat.
- Komunikat po imporcie planu mówi wprost, że **scalony baseline v{n} nie jest aktywny** i wymaga własnych
  dwóch decyzji. Test czyta tę frazę z `i18n/en.json`, żeby usunięcie jej z copy było wykrywalne.

**Design — render, sha256, ekrany i uwagi**
- `screenUpload.ts` — `hashFile`/`hashBytes` przez `crypto.subtle`; brak bezpiecznego kontekstu daje
  **nazwany** wynik `insecure_context`, nie cichą awarię. Walidacja typu i rozmiaru **przed** uploadem,
  tymi samymi progami, których serwer użyje przy zamrożeniu. `mapManifestScreens` traktuje wpis manifestu
  bez pliku jako błąd, nie jako ciche pominięcie.
- `draftSpec.ts` + `useDraftMutation.ts` — pełny cykl odczyt → parse → mutacja → `PUT` całości z nagłówkiem
  wersji. **Draft nieparsowalny blokuje zapis** i nie wysyła `PUT`; nadpisanie go „czystym" obiektem
  skasowałoby pola, których UI nie rozumie.
- `ScreenImportDialog.tsx` — pola dokładnie z `screenRefSchema`; `figmaVersion` zapisywane tylko gdy podane
  (nie pusty string). `attachmentId`, `sha256` i `capturedAt` nadaje upload, nie operator.
- `ScreenComments.tsx` — uwagi w `draftSpec.comments`, `anchor: null`, `status: 'open' | 'resolved'`.
  Identyfikatory `C-n`: `stableIdSchema` odrzuca goły UUID za rozpoczęcie od cyfry.
- `DesignSection.tsx` — miniatura z `/api/attachments/image/{attachmentId}`, `loading="lazy"`.
  Nieudane wczytanie daje **nazwany stan**, a metadane zostają widoczne — to one są treścią baseline'u.
- `FreezeBaselineAction.tsx` — `POST /baselines` z `source: 'manual'`. Cztery rozłączne wyniki:
  `201` czysto, `201` z niepustą `openCommentIds` (**osobny komunikat mówiący ile uwag nie weszło do snapshotu**),
  `200 duplicate`, `409/422` per kod. `attachment_hash_mismatch` / `hash_mismatch` / `attachment_scope_mismatch`
  są nazwane jako **niezgodność renderu z deklaracją**, nigdy jako „błąd zapisu".

**Wersje i decyzje**
- `baselineContent.ts` — `resolveBaseline(baselines, selectedId)` zachowuje te same trzy rozłączne stany;
  `resolveActiveBaseline` to teraz `resolveBaseline(baselines, null)`, więc istniejące wywołania i testy
  działają bez zmian. Dochodzą `decisionStateFor`, `overallDecisionState`, `defaultSelectedBaselineId`
  i `reconcileSelectedBaselineId`.
- `BaselineVersionBar.tsx` — lista wersji z `v{n}`, skróconym hashem i znacznikami `aktywna` /
  `zatwierdzona` / `odrzucona` / `oczekuje`. Wybór żyje w `?baselineId=`, przeżywa reload i daje deep-link.
  Po refetchu wybór wskazujący nieistniejącą wersję jest czyszczony do domyślnej.
- `DecisionActions.tsx` — `POST /baselines/{id}/decisions` z `subjectHash`/`subjectVersion` **oglądanej**
  wersji, nie aktywnej. Odrzucenie bez powodu nie wysyła żądania. `409 subject_hash_mismatch` i
  `409 optimistic_lock_conflict` dają dwa różne komunikaty, drugi przez baner konfliktu rekordu.
  `422 stored_content_altered` nazwane jako naruszenie integralności, nie jako nieaktualna strona.
  Aktywacja (`activeBaselineId` w odpowiedzi) ma **osobny** komunikat.

**Naprawa F1 z review UI-02**
- `TasksSection.tsx`: przy `hasActiveBaseline === null` sekcja **nie renderuje żadnego** z dwóch komunikatów
  domenowych — mówi „brak zadań" i że stan baseline'u jest jeszcze nieznany. Test pokrywa `null` przy
  `state: 'ready'`, czyli przypadek, który w UI-02 zwierał się wcześniej na błędzie i niczego nie dowodził.

**Wersja projektu z odpowiedzi, nie z refetchu**
- Każdy z trzech endpointów zwraca `projectUpdatedAt`; detail client trzyma ją w stanie i podaje następnej
  mutacji. Sekwencja demo to cztery mutacje pod rząd — refetch między nimi otwierałby okno na nieaktualny nagłówek.

**Spec integracyjny**
- `__integration__/TC-DELIVERY-UI-003.spec.ts` — trzy testy: FROM_BRIEF (import wymagań → replay → render →
  zamrożenie → decyzja na starym hashu odrzucona → dwie decyzje → plan na starym hashu odrzucony → plan →
  zadania istnieją i **scalony baseline nie jest aktywny**), FROM_DESIGN (ekran pierwszy, ręczny manifest,
  ten sam tor) i ścieżki negatywne (nieznana `schemaVersion`, obcy `projectId`).
  Teardown archiwizuje **własne** projekty po id i kasuje **własne** załączniki — poprawka wzorowana na
  findingu F2 z review UI-02.

## Zakres świadomie pominięty

Zgodnie z sekcją „What We're NOT Doing" planu: brak edytora wymagań i formularza edycji projektu
(`DeliveryProjectForm` nietknięty), brak kotwic x/y na renderze, brak pixel diffu i re-anchoringu uwag,
brak konsumpcji `GET /projects/{id}/evidence` (endpoint nie istnieje; należy do OSS, `EvidenceTable` do UI-05),
brak paginacji baseline'ów po stronie klienta (prośba (c) UI-02 czeka w OSS), brak ekranu zadań i UI wykonania
(UI-04), brak `source: 'design_manifest'` po stronie OSS.

## Luki pokrycia — czego nikt nie wykonał

1. **`TC-DELIVERY-UI-003` nie został uruchomiony.** Baza `open-mercato` nie ma tabel `delivery_*`, tabela
   `users` jest pusta, serwer dev nie działa, a `AGENTS.md` zabrania `yarn db:migrate` i `yarn initialize`
   bez osobnej zgody. To **świadoma decyzja**, nie przeoczenie — spec jest napisany wobec żywych kontraktów
   i przechodzi `typecheck` oraz `lint`, ale jego pierwszy realny przebieg jest przed nami.
2. **Żadna kontrola ręczna z planu nie została wykonana** (1.6–1.7, 2.7–2.9, 3.6–3.8, 4.9–4.11). Wymagają
   działającej aplikacji, sesji Figmy i **obecnego człowieka zatwierdzającego**. Pozycje Manual w Progress
   planu UI-03 pozostają niezaznaczone.
3. **Upload renderu nie został sprawdzony wobec realnego `POST /api/attachments`.** Kształt odpowiedzi
   (`{ ok, item: { id, fileSize } }`) odczytano z kodu route'u, nie z przebiegu.
4. **`crypto.subtle` przetestowano w jsdom z polyfillem** `Blob.prototype.arrayBuffer` i `TextEncoder` —
   oba istnieją w każdej przeglądarce, ale pierwsze uruchomienie w realnej przeglądarce jest przed nami.
5. **Brak dowodu, że `entityId: 'delivery_os:project'` jest właściwą konwencją** dla załączników tego modułu.
   `verifyAttachmentReferences` sprawdza wyłącznie `tenantId`/`organizationId`, więc dowolna wartość przejdzie —
   ale jeśli OSS ma własną konwencję identyfikatora encji, to jest miejsce do uzgodnienia.

## Prośby do OSS

1. **Import designu jako komenda.** `validateDesignManifest` (`lib/designReview.ts:241`) nie ma produkcyjnego
   wywołania, a `baselineCreateSchema` zna tylko `manual` i `requirements_proposal`. Wariant
   `source: 'design_manifest'` pozwoliłby złożyć ekrany po stronie serwera zamiast przez `draftSpec.screens`,
   i uczyniłby sha256 faktem serwera, a nie deklaracją klienta zweryfikowaną dopiero przy zamrożeniu.
2. **`producedBy` w `importedManifests`.** Dziś pochodzenie propozycji jest widoczne tylko w podglądzie przed
   importem i w audycie; w zapisanym baseline zostaje po nim wyłącznie `manifestId`/`manifestHash`.
   Jeśli pochodzenie ma przetrwać w danych, `importedManifestSchema` potrzebuje tego pola.
3. **Paginacja `GET /baselines`** — prośba (c) z UI-02, nadal otwarta. `BaselineVersionBar` listuje wszystkie
   wersje; przy projekcie z długą historią to jest lista bez końca.
4. **Stała `entityId` dla załączników `delivery_os`** — patrz luka 5 wyżej.

## Zgodność z Frontend Architecture Contract

- **Zero nowych client page roots.** Wszystkie komponenty wchodzą do istniejących route'ów
  `/backend/delivery/projects` i `/backend/delivery/projects/[id]`. `yarn check:client-boundaries` nie zgłasza
  `delivery_os` w żadnej sekcji raportu.
- **Żaden nowy komponent kliencki nie przekracza 300 LOC:** `ProposalImportDialog` 293, `ScreenImportDialog` 224,
  `DecisionActions` 166, `ScreenComments` 163, `FreezeBaselineAction` 135, `ProposalPreview` 88,
  `BaselineVersionBar` 60. Dialog importu został w tym celu rozdzielony — prezentacja podglądów i listy
  problemów mieszka w `ProposalPreview.tsx`, logika parsowania w `proposalImport.ts`.
- **Nie dodano globalnego SDK Figmy** ani żadnej ciężkiej biblioteki: render pochodzi z pliku uploadowanego
  przez operatora, a `crypto.subtle` jest API przeglądarki.
- Ledger `use client` uzupełnia się w F0 razem z resztą pakietu UI — to nie jest zadanie tego planu.

## Uwagi dla następnych strumieni

- **Kolejność zgód jest wymuszona przez domenę.** `delivery_os.tasks.import_plan` żąda, żeby manifest planu
  wskazywał **aktywny** baseline, a aktywny staje się dopiero po obu decyzjach. Bez działających decyzji
  nie ma czego importować jako plan.
- **Scalony baseline planu nie jest aktywowany** i to jest projekt, nie błąd. Zadania czekają na ponowne
  dwie decyzje dla nowego hasha.
- **Otwarte uwagi nie blokują zamrożenia.** `buildBaselineContent` przenosi do baseline'u wyłącznie
  `resolvedComments`; nierozstrzygnięte wracają w `openCommentIds`. UI o tym mówi — nie przemilcza.
- **Faza 3 to ścieżka v1, nie docelowy model.** Dodatek produktowy z 2026-09-19 wymaga **osobnych**
  wersjonowanych artefaktów i bramek dla UX, Key Visual i DS/UI i wprost zabrania wciskania trzech zgód
  w jedną decyzję. Mechanizm etapowych zgód jest pierwszym deliverable F0 po stronie domeny.
