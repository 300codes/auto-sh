# Domknięcie UI i procesu Delivery — Plan Brief

> Pełny plan: [plan.md](plan.md)
> Research: [research.md](research.md), [uzupełnienie techniczne](planning-research.md)
> Potwierdzone decyzje: [planning-decisions.md](planning-decisions.md)

## What & Why

Domykamy proces od briefu w OM do edytowalnego WordPressa, opublikowanego po zgodzie i zweryfikowanego na docelowym URL. Obecny kod zawiera dużą część UI i domeny, ale nie wszystkie połączenia między etapami. Plan obejmuje poprawki, brakujące funkcje oraz rzeczywistą próbę i odbiór.

## Starting Point

D1–D3 już dostarczają evidence, gates raportu i kandydata publikacji. Istnieją lista projektów, baseline, próby i komendy etapów; brakuje m.in. trwałego wyniku po reload, kompletnego importu designu, wizard/Scope, synchronizacji Figmy, wersjonowanego procesu i pełnego wykonania WP.

## Desired End State

Projekt otwiera przegląd etapu, blockerów i następnej akcji. Użytkownik wznawia brief, zatwierdza Scope, UX, KV i DS/UI oddzielnie, obsługuje feedback w staff Kanbanie oraz widzi rzeczywiste wyniki i dowody. Workflows Studio publikuje v2 bez zmiany starych projektów; WordPress pozostaje edytowalny także po redeploy.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Zakres | Jeden plan integracyjny, pełne FLOW/WP | Brakujące połączenia współblokują odbiór | Q1/Q3 |
| Własność | Mateusz OSS, Marcin EXEC/workflow, Adam UI/Figma, Michał WP/QA | Zachowuje odpowiedzialność za kontrakty | Q1 |
| Weryfikacja | Testy celowane w fazach, pełny gate na końcu | Test funkcji trafia razem z funkcją | Q2 |
| Punkt startu | Porównanie dostaw i readiness | Nie dublujemy zmian innych osób | Q4/Q6 |
| Odbiory | Przekazania między strumieniami i przed live | Nie zatrzymujemy każdej poprawki | Q5 |
| Import designu | Trwała sesja, sukcesy pozostają draftem, retry braków | Częściowy upload nie udaje kompletnego pakietu | Q7 + research |
| Widok projektu | Etap, blockery i główna akcja | Użytkownik widzi, co zrobić dalej | Q8 |
| Wykonanie | Binding baseline do aktualnych etapów i gate przed efektem | Stare API i kolejka nie omijają zgód | Research + plan |
| Providerzy | delivery-figma i opcjonalny delivery-workflows | OSS pozostaje niezależne od enterprise | Dodatek + plan |
| Wersjonowanie | Ochrona całej opublikowanej semantyki Delivery | Sam pin grafu nie chroni conditions/tools/policies | Research + plan |

## Scope

**W zakresie:** poprawki UI-02–05; API procesu; wizard i propose-only Scope; osobne review; trwały import; Figma → staff; Studio/settings; WP wykonanie, edycja, publikacja i verify; pełne testy oraz demo.

**Poza zakresem:** drugi Kanban/silnik procesu, portal klienta, OM → Figma, automatyczna migracja starych projektów, przebudowa DS platformy i odtwarzanie D1–D3. Legacy FROM_DESIGN, React/OM i OSS-only pozostają wspierane.

## Architecture / Approach

Delivery OSS jest właścicielem artefaktów, zgód, bindingu i dowodów. Enterprise proponuje Scope i wykonuje zadania przez istniejący runtime. Dedykowane pakiety integrują Figmę i Workflows przez publiczne komendy/DI; staff pozostaje właścicielem Kanbana. UI konsumuje projekcję backendu. WP używa zatwierdzonych tokenów, natywnego edytora i osobnego adaptera publikacji.

## Phases at a Glance

| Faza | Rezultat | Główne ryzyko |
|---|---|---|
| 1. Dostawy/readiness | SHA, kontrakty, dostępy, operatorzy i blockery | Nieznane dostawy lub dostęp |
| 2. Stabilizacja UI | Działający EXEC, wynik po reload, evidence i linki | Lifecycle prawdziwego widgetu |
| 3. Domena/API | F1–F9, baseline binding i execution gate | Race, replay i stare endpointy |
| 4. Portfolio/review | Wizard, Scope, zgody, partial import | Utrata postępu lub nieaktualna zgoda |
| 5. Figma/Kanban | Realny sync, triage, trwałe recovery | Duplikat po crash między modułami |
| 6. Workflows Studio | Settings, instancja projektu, immutable v2 | Zmiana semantyki przypiętego v1 |
| 7. WordPress | Tokeny, edycja, review/poprawka, publish/verify | Treści po redeploy i dostęp do targetu |
| 8. Weryfikacja/demo | Finalny gate, próba, nowe live i verdict | Niepełne lub stare dowody |

**Zależności:** readiness i niezależne poprawki biegną równolegle; faza 3 odblokowuje integrację 4–7. Pełna próba wymaga wszystkich gates i usług. Testy powstają w fazach funkcjonalnych.

**Nakład:** 134–218 osobogodzin aktywnej pracy, orientacyjnie 6–10 dni roboczych przy czterech właścicielach; do kalibracji w fazie 1. To szacunek, nie zatwierdzony budżet ani gwarancja terminu. Oczekiwanie na usługi, licencje i zgody może wydłużyć kalendarz.

## Open Risks & Assumptions

- Figma write nie dowodzi dostępu do komentarzy; lokalny WP nie dowodzi możliwości publikacji.
- WP/PHP/Tailwind i edycje wtyczek muszą przejść readiness; brak licencji nie pozwala pominąć ACF Pro.
- Staff potrzebuje trwałej idempotencji po swojej stronie, a Workflows ochrony wszystkich ścieżek zapisu opublikowanego Delivery.
- Lokalne migracje i publikacja wymagają właściwych zgód. Brak readiness blokuje zależne live, nie niezależną implementację.

## Success Criteria (Summary)

- Użytkownik przechodzi pełny proces z osobnymi aktualnymi zgodami; reload/retry nie tracą wyników ani nie duplikują efektów.
- FLOW-01…09 i WP-01…05 mają wykonane testy i dowody końcowej rewizji; legacy oraz izolacja scope pozostają sprawne.
- Próba i nowy design live mają osobne projekty i dowody; człowiek odbiera zweryfikowany WP. Dokumentacja, fixture i replay nie dają live PASS.
