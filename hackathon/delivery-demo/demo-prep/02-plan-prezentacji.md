# Demo AI Company —5minut przed twórcami Open Mercato

Cel: pokazać wiarygodny proces firmy usługowej napędzanej AI oraz świadome
wykorzystanie platformy OM. Efektem pracy firmy jest strona Aster Works.
Nie deklarujemy oficjalnych kryteriów jury, których nie otrzymaliśmy.

## Teza i pierwsze zdanie

„Zbudowaliśmy na Open Mercato firmę realizującą zlecenia cyfrowe: od briefu,
przez decyzje i pracę agentów, do edytowalnego wyniku z dowodami odbioru.”

Trzy rzeczy do zapamiętania: agent ma rolę i zadanie; człowiek zatwierdza konkretną
wersję; wynik ma sprawdzalne dowody. Przy każdej nazwanej funkcji OM pokazać ekran
lub autentyczny zapis wykonania, nie samą ikonę na slajdzie.

## Scenariusz —dokładnie300sekund

| Czas | Ekran / czynność | Narracja i dowód |
|---|---|---|
| 0:00–0:20 | Gotowy WP: home i krótki widok mobile | „To wynik zlecenia dla fikcyjnej firmy usługowej. Pokażemy, jak firma AI go dostarczyła.” |
| 0:20–0:45 | Slajd architektury: OM / nasze rozszerzenia / narzędzia zewnętrzne | „Wykorzystujemy istniejący system pracy OM; dokładamy domenę realizacji i adaptery.” |
| 0:45–1:20 | Projekt OM: brief, Scope, przypięty proces i decyzje | Pokazać rolę człowieka i konkretną wersję. Nie wypełniać całego kreatora na scenie. |
| 1:20–1:55 | Figma feedback → synchronizacja → karta staff/Kanban OM | Jeden rzeczywisty komentarz i jego źródło. Synchronizacja tylko jeśli odebrana live; inaczej jawne nagranie potwierdzonego przebiegu. |
| 1:55–2:45 | Wykonanie: zadanie/próba + workflow czekający na wynik + review/poprawka | Pokazać podział odpowiedzialności i historię dwóch prób. Długie wykonanie wcześniej nagrane, jasno oznaczone. |
| 2:45–3:25 | Raport: wymaganie → check → rewizja → verified | „Done na Kanbanie nie oznacza odbioru kodu. Wynik przechodzi oddzielną kontrolę.” |
| 3:25–4:05 | WP editor: zmiana pola lub tekstu, frontend; zachowane ACF po rebuildzie | Dowód użytecznego produktu i retencji, nie tylko screenshot wygenerowanej strony. |
| 4:05–4:35 | Zgoda publikacji + Preview + marker/raport rewizji | „Wysłaliśmy gotowy lokalny build. Ta zgoda dotyczy tego wyniku.” |
| 4:35–4:50 | Slajd wyników i ograniczeń | Tylko fakty wykonane: zakres, rzeczywiste czasy jeśli zmierzone, jedna rzecz do dalszej pracy. |
| 4:50–5:00 | Zakończenie / bufor | „Open Mercato stało się miejscem pracy tej firmy: dla ludzi, agentów i dowodów.” |

Dla scen bez potwierdzonego działania nie nagrywać inscenizacji. Przed demo wybrać
wariant zgodny z dowodami i skrócić wypowiedź, zamiast prezentować brak jako sukces.
Założenie ukończenia wdrożenia u Mateusza nie zastępuje próby generalnej.

## Trzy slajdy główne +dwa zapasowe

1. **Firma AI na OM** — zdanie otwarcia +miniatura wyniku. Większość otwarcia w produkcie.
2. **Co daje OM, co dodaliśmy** — trzy kolumny. OM: istniejące workflows, staff,
   auth/scope, command bus i kolejki w zakresie potwierdzonym w kodzie oraz próbie.
   Nasze: delivery_os, delivery_agents, wersje/AC/evidence i operator WP.
   Zewnętrzne: Figma, executor CLI, WordPress Studio. Nie nazywać naszego review
   gotową funkcją platformy; nie nazywać Figmy lub Studio modułem OM.
3. **Wynik i wiarygodność** — właściwy URL/revision, zakres odbioru, uczciwe ograniczenia.

Zapas: szczegółowa mapa reuse OM oraz dowody recovery/tenant isolation do pytań.
Nie prezentować logów, hashy na pełnym ekranie ani wszystkich testów w głównych5min.
Hash pokazać jako krótką korelację w raporcie; szczegóły mieć pod ręką.

## Jak stworzyć prezentację dziś

- Najpierw nagrać lub przejść historię projektu. Z niej wybrać5czytelnych ekranów.
- Przygotować slajd architektury na podstawie [mapy wykorzystania OM](04-wykorzystanie-om.md).
- Ujednolicić kadry, powiększyć interfejs i wyciąć puste oczekiwanie tylko w nagraniu.
  Podpis „wcześniejszy przebieg / przyspieszenie” musi pozostać widoczny.
- Zapisać edytowalne źródło, PDF i lokalne nagranie. Nie polegać na sieci do slajdów.
- Przećwiczyć dwukrotnie z timerem. Cel4:40, maksymalnie5:00. Jedna osoba mówi,
  druga pilnuje zakładek i planu awaryjnego. Zmiany mówcy kosztują czas.

## Co przygotować w systemie

Projekt DEMO-READY: autentycznie wykonany pełny flow, wersje UX/KV/UI, wymagane
zgody, feedback ze źródłem,2próby, wynik i aktualny raport. Projekt DEMO-START:
osobny świeży brief na pytania jury. Nie przepisywać historii DB dla szybszego pokazu.
Pokazując wcześniejszy wynik, mówić wprost: „Ten przebieg wykonaliśmy wcześniej”.

Zakładki w kolejności: OM projekt, Figma, staff/Kanban, wykonanie/raport, WP editor,
Preview. Odnośniki zapisać w prywatnej karcie operatora. Screeny bez cudzych danych.
Dane logowania poza prezentacją i repozytorium.

## Plan awaryjny i granice opowieści

Przy15sekundach braku postępu przejść do lokalnego nagrania: „Pokażę zapis naszego
wcześniejszego przebiegu”. Awaria sieci nie musi kończyć prezentacji. Nagranie pokazuje
ten sam zakres i identyfikowalną rewizję; nie jest potwierdzeniem bieżącego live.

Nocny odbiór zawiera też workflow builder/version pin oraz recovery. W głównym pokazie
widoczna jest przypięta wersja; pełna edycja procesu i recovery pozostają dowodami
zapasowymi, nie znikają z wymagań projektu.

Settings połączeń CLI/Studio/MCP Figmy są nowym TODO, dopóki nie przejdą TOOLS-01…06.
Nie przeznaczać na nie głównego czasu demo kosztem działającego przepływu firmy.
Nie deklarować automatycznego EXEC, jeśli pokazany przebieg był manual_handoff.
