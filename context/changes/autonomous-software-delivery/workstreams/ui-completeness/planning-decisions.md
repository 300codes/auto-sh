# Domknięcie UI i procesu — decyzje planowania

Data: 2026-09-19. Skill: `10x-plan`. Ocena HIGH potwierdzona przez użytkownika.
Źródło: [research](research.md), dodatek procesu i osiem odpowiedzi użytkownika.
Status: decyzje i osiem faz potwierdzone; szczegółowy [plan](plan.md) oraz [brief](plan-brief.md) przygotowane. Implementacja i odbiór pozostają do wykonania.

## Decyzje użytkownika

| ID | Decyzja |
|---|---|
| Q1 | Jeden plan integracyjny obejmuje wszystkie blokery audytu. Własność pozostaje: Mateusz — OSS/domena; Marcin — workflow/EXEC; Adam — UI/Figma; Michał — WP/QA. |
| Q2 | Testy celowane w fazach; pełny gate na końcowej rewizji. To zastępuje wcześniejsze ograniczenie walidacji dla przyszłej implementacji tego planu. |
| Q3 | Plan obejmuje pełny zakres, z nową estymatą i etapami; nie gwarantuje dawnego terminu hackathonu. |
| Q4 | Bieżący checkout jest bazą planowania. Sprawdzenie branchy i przekazań jest pierwszym krokiem wdrożenia, przed dublowaniem brakujących prac. |
| Q5 | Odbiór człowieka przy przekazaniach między strumieniami i przed próbą live. Nie wymaga zatrzymania każdej drobnej poprawki; nie zastępuje zgód produktu/publikacji. |
| Q6 | Obowiązkowy readiness Figma/WP/operatora na początku, równolegle z niezależnymi poprawkami. Brak gotowości blokuje odpowiednie live, nie pozostałą pracę. |
| Q7 | Przy częściowej porażce importu DesignManifest udane uploady pozostają robocze, braki są widoczne, można ponowić import bez utraty postępu. Pakiet niekompletny nie otrzymuje statusu kompletnego. |
| Q8 | Projekt domyślnie otwiera przegląd z bieżącym etapem, blockerami i główną akcją; sekcje i historia pozostają dostępne. |

## Wcześniejsze ustalenia zachowane

- D1–D3 są wdrożoną bazą; nie planujemy ich ponownego dostarczenia.
- Dodatek procesu ma pierwszeństwo: wizard → Scope → UX → KV → DS/UI → WordPress → QA → zgoda publikacji → publikacja/verify → release.
- Osobne zgody aktualnych wersji, realny Figma → staff Kanban i edycja/publikacja wersji w istniejącym Workflows Studio są obowiązkowe.
- Stare projekty i kontrakty v1, FROM_DESIGN, React/OM oraz OSS bez enterprise zachowują działanie.
- UI-06 określa nowy fikcyjny projekt demonstracyjny i odrębny FROM_DESIGN do zatwierdzonego baseline. Próba i prezentacja mają osobne dowody; replay nie zalicza live.
- Stan implementacji, wykonane testy i odbiór człowieka to osobne fakty. Dokumentacja nie zalicza żadnego kryterium wykonania.

## Potwierdzony podział faz

1. Uzgodnienie bieżących dostaw i readiness — porównanie branchy, potwierdzenie kontraktów i środowiska.
2. Stabilizacja istniejącego UI — prawdziwy widget EXEC, trwały odczyt prób/wyników, metadane evidence i nawigacja blockerów.
3. Domknięcie domeny i API procesu — odczyty/trasy istniejących kontraktów oraz backend gate przed wykonaniem.
4. Portfolio, wizard i review etapów — Scope, UX/KV/DS/UI, wznowienie, DesignManifest z częściowym importem i review draftu.
5. Figma → staff Kanban — provider, import wątków/odpowiedzi, retry, triage i rzeczywista kontrola uwag przy zgodach.
6. Wersjonowany proces w Workflows Studio — provider, instancja projektu, ustawienia, edycja i publikacja v2 bez zmiany istniejących projektów.
7. WordPress i przekazanie designu — tokeny, edytowalność, rzeczywiste wykonanie/review, publikacja i verify.
8. Końcowa weryfikacja i demo — pełny gate, regresje obu wejść, próba, nowa prezentacja i kanoniczny indeks dowodów.

Fazy są pakietami zależności, nie nakazem pracy szeregowej: readiness i poprawki zaczynają się równolegle; providerzy/workflow/WP mogą rozwijać się na przyjętych kontraktach. Testy każdej funkcji powstają w jej fazie, a faza 8 scala wyniki i wykonuje przekrojowy odbiór.
