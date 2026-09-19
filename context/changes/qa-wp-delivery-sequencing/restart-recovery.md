# Wznowienie po wyłączeniu — 2026-09-19

Użytkownik zgłosił wyłączenie komputera i polecił wznowić prace.

Odczytowy audyt wykazał zachowane źródła, prywatny state WP i cache QA. W chwili
wznowienia nie było operation.lock ani utworzonego editor-fixture journal. Żądanie
fixture istniało, lecz jego operacja prepare jeszcze nie ruszyła. Nie odtwarzano
procesów na podstawie starych PID ani zapisanych statusów running.

Raport editor-fixtures-safety-review.md miał 0 bajtów po przerwanym zapisie;
nie uznano go za PASS. Nowy niezależny reviewer odtworzył review atomowo i wykrył
wąską lukę kontroli kaskadowego cleanup pola ACF, przekazaną do poprawienia.

Chromium revision1228 pobrany tuż przed wyłączeniem miał pusty executable i znaczniki
INSTALLATION_COMPLETE; pierwszy start po restarcie kończył się natychmiast.
Uszkodzone katalogi własnej instalacji zachowano jako interrupted; pobierana jest
ponownie zgodna rewizja z wyłączonym garbage collection innych przeglądarek.
To awaria środowiska przed testem aplikacji, nie defekt strony ani PASS browsera.

Windows zgłosił około32GiB RAM i18GiB wolnej pamięci; WSL16GiB i14GiB dostępnej.
Ostatni poprawny zapis Q sprzed wyłączenia wskazywał runner465MiB i ponad8GiB
available. Nie znaleziono świeżego zdarzenia Kernel-Power potwierdzającego konkretną
przyczynę. Te dane nie dowodzą przyczyny wyłączenia i nie stanowią gwarancji stabilności.

Dalsze runtime okna są sekwencyjne: najpierw jedna własna witryna WP z pojedynczym
browserem, następnie stop WP, dopiero potem Docker/OM. Docker Desktop nie działał
po restarcie. Kroki Q1–4 mają wcześniejsze PASS, krok5 wymaga zebranego kodu wyjścia
w nowym przebiegu; TypeScript i HTTP nie uruchomiono. Szczegóły Q w
[evidence/q-preparation/restart-recovery.json](evidence/q-preparation/restart-recovery.json).

## Kontrole po wznowieniu

Zgodna przeglądarka Chromium1228 została ponownie pobrana; lokalny login działa.
Poprawka ochrony cleanup ACF przeszła15 testów i niezależne ponowne review.
Najnowszy gate pakietu WP:184/184 testów, typecheck i build PASS, źródła niezmienione
podczas gate. Dowód: [final-package-gate.json](evidence/final-package-gate.json).
Natywny fixture redaktora uzyskał [stan ready](evidence/native-editor-prepare.json) na własnej witrynie; nie zalicza to
jeszcze macierzy edycji przeglądarkowej ani retencji. Próba czekająca na networkidle
została przerwana i zastąpiona oczekiwaniem na konkretne elementy UI.
Nie usuwano danych ani locków na podstawie starego PID. Docker nadal wyłączony
podczas okna WP; gate Q zostanie wznowiony z nowymi logami, bez nadpisania historii.

Kolejny gate po dodaniu drugiego obrazu fixture: [187/187, typecheck i build PASS](evidence/final-package-gate-v2.json).
Pierwsza próba browser potwierdziła retencję, ale cleanup odmówił kaskadowego usunięcia
automatycznego Quick Draft utworzonego przez dashboard. [Dowód reconciliation](evidence/browser-editor-v1-cleanup.json)
wiąże dokładny rekord z opcją użytkownika, pustą treścią, typem/statusem i właścicielem.
Po selektywnym usunięciu udowodnionego artefaktu zwykły cleanup zakończył się poprawnie.
Nowy test loguje bezpośrednio do własnego edytora; kontrola odmowy usuwania nieznanych
wpisów aktora pozostaje zachowana. Świeży przebieg browser v2 ma osobny wynik.
