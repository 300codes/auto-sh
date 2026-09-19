# UI-05 — wymagania przekazania OSS

Data: 2026-09-19. To wymagania konsumenta UI, nie nowy zatwierdzony kontrakt publiczny ani twierdzenie o implementacji. Właściciel API/DTO: OSS/Mateusz. Użytkownik wybrał zależność od OSS zamiast rozszerzenia implementacji UI-05 o backend.

## D1 — odczyt źródłowych dowodów

### Dlaczego potrzebny

Report v1 zwraca ID i hashe testów/skanów oraz URL deploymentu. `api/projects/[id]/evidence/route.ts` ma tylko POST. Brak odczytu uniemożliwia przejście do źródła i screenshotów wymagane w 5.4. Sam odczyt po znanym ID nie wystarczy do odkrycia screenshotów/review, które nie występują w traceability rows.

### Operacje do dostarczenia

| Operacja | Minimalna potrzeba UI |
|---|---|
| Lista źródeł projektu | Paginowany odczyt filtrowany baseline i dokładną rewizją oraz osobny, jawny zbiór evidence tego baseline z sourceRevision null; możliwość znalezienia review/screenshot/deployment/result/test/scan. Limit strony do 100, deterministyczna kolejność i informacja o dalszych danych. |
| Szczegóły dowodu | Odczyt konkretnego evidence ID w scope projektu. ID/projekt/baseline/task/attempt, kind, source manual/adapter, sourceRevision, wynik/bezpieczne pola payloadu, rawReportHash i createdAt; brakujące metadane jawnie nullable. |
| Załączniki | Powiązane attachment IDs i bezpieczne metadane oraz istniejąca, autoryzowana ścieżka preview/download. Dostęp sprawdzany także przy pobieraniu bytes. |

OSS ustala dokładny route, publiczny schema i błędy w swoim spec/OpenAPI; frontend importuje opublikowany schema zamiast tworzyć równoległe publiczne DTO. Preferowane addytywne read operacje, bez zmiany znaczenia ReportV1 i bez migracji, jeśli obecny model pokrywa potrzeby. UI potrzebuje rekordu i opcjonalnych plików — nie wymaga obowiązkowego zapisu surowych raportów ani ich rekonstrukcji z hasha.

Nie zwracać całego nieprzejrzanego payloadu ani danych autora/PII bez wymaganego zakresu dostępu. Dla aktora wystarcza bezpieczna reprezentacja zgodna z polityką platformy; brak nazwy nie blokuje odczytu wyniku. Nie wysyłać sekretów, lokalnych ścieżek serwera ani nieograniczonych tablic wszystkich załączników w cyklicznym raporcie.

### Warunek przyjęcia D1

- Wersjonowany schema/fixture, dokumentacja request/response, semantyka braków, błędy, ACL i commit dostawcy.
- GET pozostaje read-only, stosuje scoping tenant + organization + project, helpers odszyfrowania oraz istniejące features view.
- Obce/missing evidence i załączniki nie ujawniają istnienia danych w innym scope; listowanie nie pozwala odczytać obcego baseline/revision przez filtr.
- Testy route/integration dostarczone z API: 2 tenant/org, brak ACL, poprawny rekord, brak pliku, odmowa pobrania obcego attachment, paginacja screenshotów spoza report rows oraz screenshot bez rewizji w osobnej grupie (nigdy jako proof rewizji raportu).
- Realny GET + preview screenshotu przez UI-05; test mocka jest tylko dowodem kontraktu klienta.

Brak D1 nie blokuje strony raportu i decyzji v1, ale blokuje pełny odbiór źródeł/5.4. Stan niedostępności API musi być odróżniony od „brak dowodów”.

## D2 — raport i serwerowe bramki nowego flow

### Stan zweryfikowany

`lib/contracts.ts:1552` deklaruje `deliveryReportFlowSectionSchema`, a `lib/flowStatus.ts:197` ma builder. `commands/reportQueries.ts:115` nie wywołuje go; report route/schema zwraca tylko v1. `commands/decisions.ts` sprawdza dotychczasowe AC/scans/deployment gates bez stage approvals. Istnienie typu nie oznacza gotowego F15 ani gotowości FLOW-07.

### Wymagane przekazanie

- Wdrożony F15 i wiarygodne rozróżnienie legacy/pinned flow z publicznego API. Sam brak `report.flow` w obecnym runtime nie jest dowodem legacy.
- Opublikowany parser odpowiedzi zachowuje opcjonalny `flow` zamiast usuwać go przez parsowanie wyłącznie `deliveryReportV1Schema`.
- Stan etapów i `flow.gate` renderowane osobno; zamrożone enumy v1 `gates` nie otrzymują lokalnie dopisanych stage blockerów.
- Kontrola backendu przy deploy/release i rzeczywistej publikacji respektuje aktualność wymaganych etapowych zgód. Ukrycie przycisku nie zabezpiecza API. Stare projekty zachowują zachowanie v1.
- Projekcja wymaganych kontroli pełnego WP demo (FLOW-01…09, WP-01…05) pochodzi od OSS/QA. UI nie dodaje własnego „full PASS” ani nie uznaje starego profilu `wordpress-theme@1` za dowód nowych wymagań.
- Test pinned project: zielone AC/skany v1 + brak/stara zgoda etapu → czytelny blocker i odmowa bezpośredniego POST; aktualne zgody → publikacja wskazanej rewizji → verify właściwego buildu/URL → osobny release.

Do przyjęcia D2 widoki mogą działać na fixture, ale nowe projekty nie przechodzą odbioru FLOW-07. Jeśli runtime nie potrafi wiarygodnie rozróżnić legacy i flow, akcje nie mogą domyślnie uznawać projektu za legacy; wymagany jest kontrakt dostawcy przed ich udostępnieniem. Nie wprowadzać ręcznie utrzymywanej listy ID projektów jako obejścia.

## Przekazanie i własność

### D3 — wskazanie rewizji odbiorowej

Report GET domyślnie wybiera najnowszy result manifest, co nie gwarantuje finalnej rewizji integracyjnej. UI-05 nie ma selektora rewizji do zatwierdzania, a historyczne linki są readonly. OSS/QA przekazują zaufany, maszynowo czytelny kontrakt odczytu kandydata odbiorowego: projekt, aktywny baseline/hash, sourceRevision, identyfikator/wersja wskazania i dowód finalnej integracji/testu; nie listę wpisywaną ręcznie w kod UI.

Backend decyzji potwierdza aktualność kandydata przy zapisie, bez zmiany znaczenia zamrożonych pól v1. Dokładną addytywną powierzchnię ustala właściciel OSS w swoim spec/BC review. Odczyt raportu może wykorzystać istniejący parametr revision. Brak kandydata pozwala na podgląd latest-result, ale blokuje aprobatę. Kandydat zmieniony po otwarciu formularza wymaga nowego przeglądu; odpowiedź późniejszego taska sama nie staje się kandydatem.

Test przekazania: zaakceptowane wyniki tasków A, finalna integracyjna rewizja B z dowodami, późniejszy wynik taska C → ekran/zgoda nadal odnoszą się do B albo jawnie zgłaszają zmianę zatwierdzonego kandydata, nigdy cicho do C. Dotyczy git i snapshot WP. D3 jest zależnością przed odbiorem aprobaty UI-05, nie zadaniem backendowym przejmowanym przez UI.

### Zakres przekazania

UI przygotowuje klienta i testy komponentowe; OSS implementuje read/projection/gates wraz z testami API; QA współprowadzi integracyjne scenariusze i indeks dowodów. Ten dokument nie wysyła wiadomości ani nie tworzy zadania w zewnętrznym trackerze.

Handoff dostawcy zawiera SHA, schema/profile/fixture versions, rzeczywiste endpointy i przykładowe odpowiedzi, komendy/testy z runnerem oraz ograniczenia. Publiczne zmiany podlegają `BACKWARD_COMPATIBILITY.md`. Publikacja i migracje nie wynikają z akceptacji tego dokumentu.
