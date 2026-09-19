# Checklista na noc i rano

Plan względny: T0 to rozpoczęcie przygotowań, D to wejście na scenę. Bloki są
propozycją organizacji pracy, nie estymatą brakującego kodu. Gdy wdrożenie nie przejdzie
odbioru, zgłaszamy blocker i wybieramy uczciwy zakres prezentacji; nie zaznaczamy PASS.
Właściciele poniżej proponowani według dotychczasowych strumieni — potwierdzić podział.

## Co Michał może zrobić od razu, nie czekając na Mateusza

- [ ] Zatwierdzić nazwę Aster Works,4widoki i tekst briefu; zamrozić zakres zlecenia.
- [ ] Zaplanować wygenerowanie treści podczas scoping/UX/UI i ich review; nie czekać na gotowe copy. Przygotować lub zaplanować2własne grafiki i alt text.
- [ ] Wybrać fonty dostępne lokalnie; zebrać materiały w jednym katalogu bez sekretów.
- [ ] Przygotować3slajdy według scenariusza oraz pusty slajd wyników do wypełnienia faktami.
- [ ] Napisać i przeczytać na głos otwarcie oraz zakończenie. Wybrać jednego prowadzącego.
- [ ] Przygotować kontrolowaną uwagę: CTA „Porozmawiajmy o projekcie” → „Omówmy Twój proces”, ten sam cel linku. Wcześniej zmienić ACF „Etap” na „Gotowe do rozmowy”; po aktualizacji motywu potwierdzić zachowanie tej wartości. Uzyskać wymagane ponowne zgody.
- [ ] Sprawdzić nagrywanie ekranu, eksport PDF i odtwarzanie lokalnego filmu.

## Równoległe bloki pracy

| Okno | Michał: brief/WP/narracja | Mateusz: środowisko/OSS | Adam: UI/Figma | Marcin: EXEC |
|---|---|---|---|---|
| T0–T+45min | Brief użytkownika, plan grafik,3slajdy robocze | Aktualny main/SHA, baza i gotowość środowiska | Konta, plik demo, materiały UX/KV/UI | Status kontraktów, worker/provider i probe |
| T+45–T+120min | Generowanie/review treści w procesie, mapa edycji ACF/SEO | Gate/testy i konkretne blockery | Osobne wersje/zgody, feedback i odczyt | Rzeczywista próba, korelacja i aktualne checks |
| Po gotowości wszystkich zależności | Wspólny pełny przebieg Aster Works; jedna osoba zapisuje dowody i czasy | Weryfikacja stanu/wersji/zgód | Weryfikacja UI i źródeł Figmy | Weryfikacja wykonania i poprawki |
| Po odebranym przebiegu | Nagranie, finalne slajdy i próba4:40 | Zachowanie stanu demo | Screeny, desktop/mobile | Dowody recovery do pytań |
| D−60min | Wyłącznie kontrola gotowości i zakładek | Freeze rewizji, brak niepotrzebnych zmian | Kontrola sesji i linków | Kontrola usług, brak nowych eksperymentów |

Nie czekać na pełny build z pisaniem slajdów. Nie uruchamiać ciężkich procesów
równolegle na jednym komputerze. Gdy trzeba zmienić kod po freeze, powtórzyć dotknięte
kontrole i próbę; zapisać nową rewizję. Zaplanować przerwę przed prezentacją.

## Bramka środowiska —potwierdza Mateusz / operator

- [ ] Dokładny SHA pobrany z main; pełny gate i live kontrole zapisane dla tej rewizji.
- [ ] Dedykowana baza, migracje uzgodnione, fixture i zgodność API↔DATABASE_URL sprawdzone.
- [ ] Studio/CLI zainstalowane i konto zalogowane w środowisku faktycznego operatora.
- [ ] Figma: autoryzacja oraz dostęp do właściwego pliku; osobno uprawnienia komentarzy.
- [ ] EXEC: zgodny TaskPackage/ResultManifest, rzeczywiste WP workspace i świeże kontrole.
- [ ] Kolejki/workers i wymagane usługi uruchomione; zasoby oraz dysk wystarczające.
- [ ] Konto prowadzącego oraz osobne konto redaktora WP mają właściwe uprawnienia.
- [ ] ACF Pro dostępne prywatnie; Yoast/Polylang Free gotowe; tłumaczenia poza demo.
- [ ] Zewnętrzny Preview dostępny z drugiego urządzenia, z właściwym noindex i dostępem.

## Pełny przebieg próbny —warunek twierdzenia „end to end działa”

- [ ] Brief → agentowy Scope; wybór platformy i narzędzi; osobna akceptacja Scope.
- [ ] UX → poprawka → akceptacja UX; osobno KV i DS/UI z aktualnymi wersjami.
- [ ] Rzeczywisty komentarz Figmy → import do staff/Kanban; ponowny import bez duplikatu.
- [ ] Przypięty workflow; wersjonowanie szablonu: nowy projektv2, stary nadalv1.
- [ ] Implementacja WP z rzeczywistym executorem, zapisane ID zadania/próby/baseline.
- [ ] Pierwszy wynik → review changes_requested → poprawka CTA → druga próba.
- [ ] Aktualne dowody finalnej rewizji → review → verified; stare dowody nie przenoszą PASS.
- [ ] Redaktor zmienia treść/ACF/SEO; po zmianie motywu i rebuildzie wartości pozostają.
- [ ] Wszystkie4widoki działają na desktopie/mobile i odpowiadają zatwierdzonemu designowi.
- [ ] Zgoda na konkretny target/revision → lokalny gotowy pakiet → upload → odczytowy odbiór.
- [ ] Recovery/retry/cancel/dwa runy zgodnie z istniejącą macierzą; wynik zachowany do pytań.
- [ ] Sprzątnięte próby techniczne; projekt prezentacyjny i potrzebne artefakty zachowane.

Nie wszystkie powyższe kontrole pokazujemy w300sekund, ale brak pokazania nie znosi
kryterium odbioru. Manualny techniczny WP roundtrip nie zastępuje automatycznego EXEC.

## Dowody i przygotowanie występu

- [ ] DEMO-READY z autentyczną historią i osobny DEMO-START; nie zmieniać historii SQL-em.
- [ ] Prywatna karta operatora: URL-e OM/Figma/WP/Preview, project/task/attempt IDs, SHA,
  wersja workflow, finalny snapshot i informacja, kto zatwierdził co. Bez haseł w MD.
- [ ] Zmierzony czas prawdziwego wykonania; bez deklarowania niezmierzonego ROI.
- [ ] Nagranie zapasowe odtwarza się offline, ma podpis wcześniejszego przebiegu.
- [ ] PDF i edytowalne slajdy otwierają się; źródła dostępne zespołowi.
- [ ] Dwie próby na czas: odpowiednio ____ i ____; docelowo≤4:40.
- [ ] Gotowe odpowiedzi: reuse OM, decyzje człowieka, izolacja, recovery, koszty jeśli znane.
- [ ] Screeny i slajdy nie zawierają nazwy/materiałów firmy referencyjnej ani cudzych danych.
- [ ] Powiadomienia wyłączone, zasilacz/adapter obrazu sprawdzony, przeglądarka powiększona.
- [ ] Operator zna regułę15s → nagranie. Nie debugujemy na scenie.

## Priorytety przy ograniczonym czasie

P0: działający rzeczywisty przebieg, widoczny wynik WP, dowody wykorzystania OM,
próba5min i działające nagranie zapasowe. Bez nich efektowne slajdy nie wystarczą.
P1: dopracowanie tekstów, kadrowania, mobile i czytelności prezentacji.
P2: animacje slajdów i nowe settings połączeń — nie dodawać nocą kosztem P0.
Nie rozszerzać zlecenia o CRM, wysyłkę maili, tłumaczenia i nowe usługi.

## Decyzja przed występem

- [ ] GREEN: pełny plan odebrany na docelowej rewizji; pokazujemy przygotowany scenariusz.
- [ ] AMBER: konkretny etap live niestabilny, ale istnieje prawdziwy odebrany zapis;
  jawnie pokazujemy nagranie tego etapu. Nie opisujemy całego pokazu jako live.
- [ ] RED: brak potwierdzonego E2E; pokazujemy działający zakres i wprost nazywamy brak.

Wybrać dokładnie jeden stan. Zapis: stan____, rewizja____, osoba____, czas____,
braki____. Checklisty nie uzupełniać automatycznie po samym uruchomieniu aplikacji.
