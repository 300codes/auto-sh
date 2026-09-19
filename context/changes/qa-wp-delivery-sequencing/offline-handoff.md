# WP + QA — przekazanie na komputer z działającym OM

Stan 2026-09-19: użytkownik przeniósł pełny build i ciężką walidację live na drugi
komputer. Tutaj wykonujemy kod, lekkie testy, review i przygotowanie przekazania.
Nie jest to zgoda na obniżenie kryteriów odbioru ani potwierdzenie gotowego demo.

## Przekazanie przez Git — aktualizacja

Użytkownik wybrał publikację przygotowanych prac w repozytorium. Ten dokument
podróżuje razem z kodem i testami w tym samym commicie. Po potwierdzonym push
wystarczy pobrać aktualny `main` do osobnego checkoutu; nie nakładać na niego
starszego archiwum źródeł. Zanotować rzeczywisty SHA checkoutu dla nowej walidacji.
Poniższy opis niezacommitowanego overlay dotyczy wcześniejszego eksportu do tar.gz.
Prywatne środowisko, Studio/logowanie oraz ciężkie kontrole nadal przygotowuje
operator na drugim komputerze. Pełny gate można wykonać zgodnie z runbookiem;
prywatny scaffold runnera w archiwum jest opcjonalną pomocą, nie częścią aplikacji.

## Co dokładnie przenosimy

Lokalny HEAD `67aa2d1f8` zawiera main `d403ca1f9`, OSS `dev-mateusz` `a74cfe8ff`
i UI `feature/design-ui` `0b1cce284`. Sam HEAD nie wystarcza: QA/WP i poprawki
integracji zawierają pliki zmienione oraz nieśledzone. Potrzebny jest cały przygotowany
overlay źródeł z manifestem SHA-256, nie samo `git pull` ani kopia katalogu `dist`.
Nie wykonano push. Osobne prace `open-mercato-sandboxes-app-generation` nie należą
do tego przekazania.

Do kodu nie dołączamy prywatnych env, tokenów, bazy, node_modules, lokalnych cache,
licencjonowanej paczki ACF Pro ani zachowanych witryn WP. Drugi programista dostarcza
je prywatnie w swoim środowisku. Polylang Free pozostaje; tłumaczenia poza demo.
Wszystkie instalacje i kompilacje WP odbywają się lokalnie. Preview otrzymuje gotowy
zatwierdzony deployment.

## Najpierw WordPress Studio i konto

Przed scenariuszami WP zainstalować WordPress Studio wraz z dostępnym CLI na
komputerze wykonującym operacje WP. Następnie zalogować Studio do właściwego konta
WordPress.com przeznaczonego do Preview i potwierdzić status autoryzacji. Sprawdzić,
że CLI jest dostępne dla tego samego użytkownika i w tym samym środowisku, z którego
uruchamiany jest operator WP. Logowanie w aplikacji Windows nie jest dowodem, że CLI
uruchamiane w WSL lub kontenerze widzi tę samą sesję i rejestr witryn.

Obecny adapter Preview sprawdza Studio CLI1.19.0; jest to wersja zweryfikowana w tym
handoffie, nie deklaracja najnowszego wydania. Inną wersję trzeba osobno zweryfikować.
Potwierdzić instalację, wersję, zalogowane konto, odczyt rejestru własnych witryn oraz
uprawnienia konta do celu Preview. Nie kopiować sesji/tokenów ze starego komputera
w paczce źródeł. Brak logowania oznacza niegotowe połączenie, nie zaliczony readiness.
Instalacja i logowanie nie oznaczają zgody na upload. Do czasu wdrożenia poniższego
ekranu ustawień są to jawne kroki operatora na komputerze wykonawczym.

## Do wdrożenia: Ustawienia → Połączenia narzędzi

Nowy zakres użytkownika, **TODO — niezaimplementowany**: z poziomu panelu połączyć
obsługiwane CLI, WordPress Studio i MCP Figmy, uruchomić właściwe logowanie oraz
sprawdzić i zarządzać połączeniem. Dokładne wymagania i testy odbioru:
[specyfikacja produktu — ustawienia narzędzi](../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md#ustawienia-połączeń-narzędzi--nowy-zakres-do-wdrożenia).

Prace UI i adapterów można prowadzić równolegle po uzgodnieniu kontraktu połączenia.
Zalogowanie do CLI w terminalu nie zalicza implementacji tego ekranu. Ten nowy zakres
ma osobny odbiór i nie zmienia historycznych procentów sześciu modułów WP/QA.

## Kolejność pierwszego uruchomienia

1. Odtworzyć dokładną rewizję i overlay w osobnym checkoutcie, zweryfikować hashe.
   Zapewnić Node24 i zależności zgodne z lockfile; nie kopiować starych buildów.
2. Przygotować dedykowane QA API/DB/storage i prywatne konta. Podawać jawne
   `DATABASE_URL`; rekord kontrolny utworzony przez API musi istnieć w tej bazie
   przed licznikami i sprzątaniem. Migracje na nowym komputerze wymagają zgody
   właściciela jego bazy. Lokalna zgoda nie upoważnia do zmiany innej bazy.
3. Wykonać cały ordered gate z `.ai/agentic.config.json`. Dołączony osobno scaffold
   ciężkiego runnera ustawia heap na krok i serializuje workspace/Jest. Jego własne
   testy przygotowawcze nie są wynikiem pełnego gate. Nie używać ignoreBuildErrors.
4. Zapisać source manifest, Build ID i rzeczywiste registry. Wykonać świeże Playwright
   discovery. Stare liczby przypadków nie są mianownikiem dla nowego zestawu FLOW/UI.
5. Fixture dwukrotnie, potem regresja OSS: dokładne ACL/scope/stale/hash/manifest,
   duplikaty oraz reserve → result → review. Komendy w [runbooku](../../../hackathon/delivery-demo/runbook.md).
   OSS-only przypadki uruchomić w rzeczywistym profilu OSS-only; pominięcie w profilu
   enterprise pozostaje not_run, nie PASS.
6. Uruchomić osobno [manualny techniczny WP roundtrip](../../../packages/core/src/modules/delivery_os/__integration__/wordpress_manual/README.md) z prywatną konfiguracją. Wymaga
   nowej własnej witryny, rzeczywistych capture receipts oraz raportów wykonanych na
   zamrożonych bajtach. Nie używać historycznego snapshotu z wymyślonym receipt.
7. Dopiero po poprawieniu wskazanych niżej seamów EXEC uruchomić automatyczny obieg,
   REC01–10 i dwa rzeczywiście współbieżne runy. Zachować probe procesu, spawn,
   resume, idempotency i cleanup; unit/mock nie zastępują tych dowodów.
8. Odbiór designu/redaktora, kompletny lokalny kandydat, zgoda na dokładny target/hash,
   gotowy transport Studio, upload i odczytowy odbiór konkretnej rewizji.

## Pozostałe problemy to nie tylko środowisko

| Rodzaj | Pozostało | Właściciel / dowód |
|---|---|---|
| błąd integracji kodu | Cezar nie przyjmuje kanonicznego TaskPackage OSS; mapper wyniku oczekuje legacy baselineHash, brak rzeczywistych checks/artifacts i powiązania workspace | EXEC; `evidence/exec-merged-seam-probe.json` |
| błąd recovery kodu | Reclaim tego samego joba i crash po signal wymagają poprawki; nie wolno uruchomić wykonania drugi raz ani uznać wznowionego workflow za błąd | EXEC; ten sam probe i macierz REC |
| brak kontraktu/kodu hosta | Studio upload przyjmuje registered site, nie zamrożoną paczkę; trzeba powiązać rejestrację, bezpieczną konfigurację, autoryzację i finalny marker | Host WP/deployment + OSS; `preview-offline-implementation.md` |
| brak artefaktu/akceptacji | Zaakceptowany projekt WP, eksport/fonty, ręczny odbiór desktop/mobile i capabilities redaktora | Design + odbierający; backoffice UI nie jest projektem witryny WP |
| niewykonana kontrola | Pełny gate aktualnego overlay, nowe HTTP/FLOW/UI, manualny roundtrip i live REC | Drugi komputer; nie przenosić historycznych PASS na nowy kod |
| odnotowany defekt OSS | Wynikowy workspace wymaga kontroli po stronie OSS; lokalny mapper już odrzuca obcą witrynę | OSS; bez samowolnej zmiany publicznego API |

## Stan odbioru i zachowane dowody

Formalne kryteria [planu](plan.md): moduł1 2/2, moduł2 2/3, moduł3 2/3,
moduły4–6 po0/2. Nie oznacza to braku implementacji w ostatnich modułach.

- Po integracji OSS: 120 suites / 2044 testy PASS (`evidence/team-merge-unit.json`).
- Cały pakiet WP przed końcowym stagingiem: 244/244 testy PASS; Node24, prywatny
  zgodny toolchain, fixture/SQLite i tymczasowe lokalne listenery. Bez OM/Studio live.
- Dodatkowy Preview staging:15/15 PASS i niezależny review, bez Studio/uploadu.
  Scanner i18n:17/17 PASS.
- Manualny roundtrip: narrow TypeScript i native discovery PASS; rzeczywiste offline
  Playwright/Composer PASS oraz odrzucenie złego markera. Review zamknięty po dwóch
  poprawkach; live not_run (`evidence/wp-manual-roundtrip-offline.json`).
- Receipt capture: 11/11 PASS i niezależny review; snapshot reader:17 PASS;
  compiled mapper caller:9 PASS. Te liczby częściowo należą do powyższych zestawów,
  nie sumować ich jako niezależnego pokrycia.
- Historyczny live WP run8 potwierdził edytor, ACF/SEO i retencję po lokalnym buildzie.
  Nie jest odbiorem zaakceptowanego designu ani aktualnego E2E.
- Ostatni pełny gate zatrzymał się na package build: potwierdzony OOM kontenera9GiB,
  globalny heap7168 użyty również dla package build. Runner przekazania rozdziela
  heap2048 dla pierwszych kroków i7168 dla Next. Naprawa wymaga wykonania na celu.
- Migracja release_candidates została zastosowana i sprawdzona tylko we własnej
  `qa_final` po zatwierdzeniu i zweryfikowanym backupie. Nie dołączamy tej bazy.

W indeksie `failed` oznacza wykonaną kontrolę z błędem, `not_run` kontrolę niewykonaną,
`missing` brak wymaganego artefaktu/implementacji. Każdy PASS musi wskazywać rewizję,
rodzaj dowodu oraz stan cleanup. Zatrzymana witryna z zachowanymi plikami nie jest
całkowicie usuniętym fixture.
