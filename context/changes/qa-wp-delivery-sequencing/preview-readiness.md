# Studio Preview — odczytowy probe i granice pakietu

Źródła lokalne z 2026-09-19: Studio CLI1.19.0 `dist/cli/archive-42IlghGa.mjs`,
`dist/cli/snapshots-D5Mn9Vtm.mjs` oraz istniejący ai-wordpress-orchestrator
`src/server/modules/preview/{studioCli,deployment,studio}.js` i docs/studio-preview.md.
Nie uruchomiono publikacji ani nie zmieniono starego orchestratora.

## Ustalenia

- Studio tworzy ZIP z wp-content i opcjonalnego wp-config.php; core WordPress/PHP
  zapewnia importer/host. Nie jest to przeniesienie lokalnego runtime bajt w bajt.
- `.deployignore` filtruje wp-content, ale obecne CLI dodaje wp-config.php osobno.
  Sam wpis ignore nie chroni sekretów wp-config; przyszła paczka musi mieć jawnie
  przygotowaną konfigurację bez prywatnych saltów/credentialów albo odmówić.
- CLI glob używa follow:true. Nasz preflight i prywatny staging muszą odrzucać
  symlinki, nie kopiować przypadkowych worktree, ZIPów, logów czy backupów.
- Wtyczki i media należą do deploymentu. Snapshot v1 (motyw + DB) nie wystarcza.
  Pełny manifest oddzielnie wiąże pliki runtimecontent, spójny backup SQLite,
  konfigurację i identity lokalnego runtime oraz jawne oczekiwania hosta.
- Lista JSON Preview jest account-wide pomimo --path. Wybór tylko po dokładnym
  localSiteId zgodnym z naszym ownership record; 0/1/many i saved-host mismatch
  obsługiwane jawnie. Nigdy automatyczna adopcja cudzej witryny.
- Update nie gwarantuje atomowego rollback. Timeout zapisuje uncertain i wymaga
  reconcile/verify-only, bez ślepego drugiego create/update.
- Privacy gate PHP nie zabezpiecza statycznych mediów. W paczce demo mogą być
  wyłącznie materiały przeznaczone do publicznego preview; poufne pliki wykluczone.
- Weryfikacja identyfikuje dokładną rewizję, noindex, media i wygląd. Rewriting URL/DB
  podczas importu oznacza osobny dowód remote, nie identyczny hash lokalnej DB.

## Wykonanie

Paczka powstaje lokalnie, prywatnie, pod operation.lock przy zatrzymanej własnej
witrynie. Nie publikować ze zmiennego live katalogu bez porównania manifestu.
Przed adapterem utrwalić staging i reguły; nie obiecywać obsługi uploadu ZIP, której
CLI nie wystawia. Integracja hosta/publicznego kontraktu i zgoda G4/G5 pozostają jawne.

## Implementacja niezależna

`preview.ts` wykonuje wyłącznie odczytowe inventory scoped do siteId (CLI1.19.0,
status auth bez ujawniania odpowiedzi, ścisłe hosty *.wp.build, saved binding i expiry).
Czysta funkcja przejść publikacji testuje prepared→uploading→uncertain→uploaded_unverified→verified,
porównanie target/hash i zakaz ponownego begin po timeout. Nie uwierzytelnia decyzji
sama: prawdziwy host musi dostarczyć zweryfikowane zdarzenia/approval. To nie endpoint
publikacji ani dowód faktycznego uploadu.

**Granica integracji:** CLI create/update akceptuje tylko zarejestrowany katalog witryny,
nie gotowy ZIP ani dowolny frozen staging. Gotowa prywatna paczka jest niezależnym
artefaktem. Realny transport wymaga jawnej delty hosta: zamrożony owned deployment site
albo sprawdzonego uploadu paczki, bez --overwrite/adopcji cudzej rejestracji, oraz
weryfikatora zgód G4/G5. Nie dodajemy zastępczego publicznego API przed kodem właścicieli.
Brak tej integracji pozostawia 5.2/6.1 niezaliczone, nawet gdy fixture adaptera przechodzi.

`deployment-verify.ts` dodaje odczytową kontrolę zapisanej paczki: manifest i jawny
oczekiwany hash, całe inventory oraz rzeczywiste bajty, z odmową nieznanych plików,
zmian i linków. `preview-journal.ts` utrwala powiązanie scope/site/Studio/package,
rewizję i hash poprzedniego stanu; reconcile wykonuje istniejący odczyt inventory.
Restart nie resetuje niepewnego uploadu, a inventory nie nadaje `verified`.
[Review i 29 testów](reviews/impl-review-phase-5.md) zamykają ten lokalny zakres.
Writer autoryzowanego intentu, transport i weryfikator zdalnej rewizji nadal należą
do integracji hosta; nie zostały zastąpione symulacją.

## Lokalny capture po wznowieniu

Aktualny techniczny capture nastąpił po pełnym browser run8 i cleanup:
[snapshot i paczka](evidence/post-browser-local-package.json),
[kontrola zapisanych bajtów](evidence/post-browser-package-verify.json).
3725 plików, hash pakietu `4fc9dcbdc63559be78885b54488bbe11fd36ac90162dae50f98f948742f60a76`.
CSS jest przypięty do drugiego builda rzeczywiście sprawdzonego w browserze.
Pozostaje to lokalnym artefaktem technicznym: brak zgód G4/G5 i uploadu.
Poniższy starszy capture pozostaje historią, nie aktualnym kandydatem.

[Dowód rzeczywistego capture](evidence/local-deployment-package.json):3725 plików,
66951346 bajtów, spójny backup bazy, manifest i snapshot przy zatrzymanej własnej
witrynie. Pełny pakiet jest prywatny. Ten przebieg nastąpił po cleanup przerwanego
browser run1, przed końcowym odbiorem kolejnej rewizji. Pozostaje
`captured_inventory_only`, `publication:not_authorized`, `upload:not_run`;
nie jest dowodem finalnej rewizji, bramek G4/G5 ani zgodności hosta.
