# Adam — portfolio, wizard, Figma i UI procesu

## Wynik

Użytkownik prowadzi projekt przez wszystkie etapy z poziomu OM, widzi realny feedback Figmy w istniejącym Kanbanie i otwiera edytowalny flow z ustawień.

## Pliki i granice

Frontend: `packages/core/src/modules/delivery_os/backend/`, `components/`, `widgets/`, `i18n/`. Provider komentarzy Figma: osobny dedykowany pakiet integracji (nazwę i publiczne API ustal w F0), według przewodników integrations/data_sync. Reuse staff Kanban i jego injection spots oraz workflows visual editor. Nie kopiuj tych komponentów/silników do delivery. Domena/API approvals i importu: Mateusz; workflow API: Marcin.

## Kroki

1. F0: potwierdź na rzeczywistym pliku write/read/render oraz osobno odczyt komentarzy/odpowiedzi. Zapisz bezpieczny dowód i brakujące dostępy. Ustal z Mateuszem payload importu: source thread/comment identity, etap, źródłowe refs, autor/czas/treść, marker braku pewnej wersji. Nie utożsamiaj sukcesu MCP write z możliwością sync.
2. Lista/szczegóły projektów, wizard ze wznowieniem, scoping chat/propozycje, wybór narzędzia i jawna akceptacja Scope. Statusy i blokery pochodzą z backendu, nie z local state udającego zakończenie.
3. Zbuduj osobne widoki UX, Key Visual i DS/UI: generowanie, linki Figmy, snapshoty, poprawki, akceptacja/odrzucenie z powodem. Pokaż wersję zatwierdzaną przez klienta i utratę aktualności po zmianie upstream. DS jest DS strony klienta, nie OM.
4. Provider pobiera realne wątki i odpowiedzi, normalizuje je oraz przekazuje do API importu Mateusza. Przycisk „Synchronizuj komentarze” pokazuje cursor/postęp/błędy/retry. Karta w natywnym staff Kanban otwiera właściwy link Figma i pokazuje etap/snapshot. Nie dodawaj fikcyjnej dwukierunkowej synchronizacji.
5. Dodaj wejście „Proces realizacji projektów” w ustawieniach OM: wersja domyślna, edycja w Workflows Studio, walidacja/publikacja przez API Marcina. Pokaż, że v2 dotyczy nowych projektów. Domknij UI realnego WP wykonania, QA i raportu.

## Frontend Architecture Contract

Nowe page roots są server-side; osobne client islands: BriefWizard (stan formularza), ScopingConversation (rozmowa), StageReview (decyzje), FigmaSync (postęp), FlowSettings (formularz wyboru wersji). Kanban i graf reuse w swoich route boundaries, bez globalnego importu ciężkich bibliotek i providerów. W F0 wpisz dokładne pliki/importerów do ledger `use client` w spec OSS; 0 nowych client page roots, 0 nieuzasadnionych client blobów >300 LOC, 0 ciężkich bibliotek w globalnym bootstrap.

Używaj CrudForm/DataTable tam, gdzie pasują, apiCall, guarded mutations, optimistic lock konfliktów, LoadingMessage/ErrorMessage, shared DS primitives i i18n. Klawiatura: Cmd/Ctrl+Enter submit, Escape cancel; akcje ikonowe z etykietami. Dla każdego nowego routa wymagany hydration smoke i test kluczowej interakcji; dostarcz check:client-boundaries oraz jeden sygnał build/bundle, bez dodawania globalnego SDK Figmy.

## Odbiór i zależności

FLOW-01…05/07/09: wznowienie wizarda, oddzielne zgody/odrzucenia, realny komentarz i odpowiedź, błędy sync, keyboard/loading/conflict, wersje flow. Artefakty Figmy są rzeczywiste i różnią się po poprawce. Frontend korzysta z fixture F0, a odbiór wymaga prawdziwych API i zgód — nigdy tylko klikalnego mocka.

## Dodatkowy handoff designu do WordPressa

W F2 dostarcz do Michała zatwierdzony snapshot Figmy oraz mapę semantycznych tokenów (kolory, typografia, spacing, layout, promienie, warianty) do `theme.json` i Tailwinda. Zapisz source file/node/version/hash, brakujące wartości i ich zatwierdzenie. Nie przekazuj wyłącznie renderów.

Każdy ekran/sekcja ma mapowanie na edytowalny blok/pole WP, miejsce edycji i sposób tłumaczenia; obejmuje także header/footer, menu, CTA, media i SEO. Uzgodnij zgodność projektu z natywnymi blokami/patterns i ACF Pro oraz czytelne stany responsywne. Standard klienta opisuje sekcja „Standard wykonania stron” dodatku; nie zmieniaj DS platformy OM. Współodbierz WP-02/04/05.

## Wspólne warunki

Czytaj [dodatek produktowy](../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) oraz [README](README.md). Kierunek z dodatku ma pierwszeństwo nad wcześniejszym React-first/WP-PoC. To zadania do wykonania, nie raport ukończenia. Zachowaj istniejące zmiany innych osób. Nie zmieniaj samodzielnie zamrożonych DTO v1 ani kontraktów innego właściciela.

Przekazanie: commit SHA, lista plików, wersja kontraktu/fixture, wykonane testy i runner, dowody oraz jawne blockery. Testy integracyjne danej funkcji dostarcz razem z nią; nie odkładaj ich na końcowy QA. Generacja po zmianach auto-discovery. Migracje przygotuj z snapshotem, nie aplikuj ich bez zgody. Nie wprowadzaj sekretów do artefaktów.
