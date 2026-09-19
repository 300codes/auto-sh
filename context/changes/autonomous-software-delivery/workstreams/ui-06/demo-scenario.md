# UI-06 — scenariusz Pracowni Forma

Data przygotowania: 2026-09-19. Status: materiał do próby; wykonanie live **not_run**. [Plan](plan.md), [brief planu](plan-brief.md), [readiness](readiness.md). Ten dokument nie zapisuje odbioru. Wyniki trafiają do indeksu QA i [kanonicznego Progress](../../plan.md#progress), zgodnie z [dodatkiem](../../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md).

## Brief do zapisania i wznowienia

Pracownia Forma to fikcyjne studio projektowania wnętrz. Odbiorcy: osoby urządzające niewielkie mieszkanie oraz właściciele małych lokali usługowych, czytający po polsku lub angielsku. Cel witryny: umożliwić zrozumienie trzech usług i dotarcie do danych kontaktowych. Dwie strony w obu językach: strona główna oraz kontakt. Główny flow: usługa → CTA → kontakt; drugi: przełączenie języka z zachowaniem odpowiednika strony.

Zakres obejmuje header, menu, hero, trzy usługi, krótki opis współpracy, CTA, footer i kontakt. WordPress jest rekomendowany ze względu na samodzielną edycję przez redaktora, a Figma do UX/KV/DS/UI. Agent przedstawia tę rekomendację i komplet AC; człowiek zatwierdza rzeczywistą wersję Scope i dostępny adapter wykonania. Profil targetu v1 jest niezmienny: nie przestawiać go ukrytą edycją podczas scopingu.

Poza zakresem są płatności, CRM, rezerwacje, mapa, analityka oraz formularz wysyłający wiadomości. Kontakt jest informacyjny; nie dodajemy pozornej wysyłki. Design obejmuje oba ekrany na desktop/mobile, focus/hover, aktywny język i stronę, otwarte/zamknięte menu mobilne oraz zachowanie długich tłumaczeń. Nowy DS klienta nie zmienia DS platformy OM.

## Treści demonstracyjne PL/EN

Treści są autorskim materiałem fikcyjnym przygotowanym do tego scenariusza, bez referencji prawdziwej firmy. Adres e-mail w domenie `.example` jest oznaczony jako demonstracyjny i nie służy do kontaktu.

| Miejsce | Polski | English |
|---|---|---|
| Marka | Pracownia Forma | Pracownia Forma |
| Menu | Strona główna · Usługi · Kontakt | Home · Services · Contact |
| Hero H1 | Wnętrza, w których dobrze się żyje | Spaces that feel good to live in |
| Hero opis | Projektujemy spokojne, funkcjonalne wnętrza mieszkań i małych lokali. Zaczynamy od rozmowy o tym, jak chcesz z nich korzystać. | We design calm, practical interiors for homes and small businesses. We start by understanding how you want to use your space. |
| Hero CTA | Poznajmy Twój pomysł | Tell us about your idea |
| Usługi H2 | Wsparcie dopasowane do Twojej przestrzeni | Support shaped around your space |
| Usługa 1 | Konsultacja wnętrza — Uporządkuj potrzeby, układ i najważniejsze decyzje podczas jednej rozmowy. | Interior consultation — Clarify your needs, layout and key decisions in one conversation. |
| Usługa 2 | Projekt mieszkania — Spójny plan funkcji, materiałów i wyposażenia dla codziennego życia. | Home design — A coherent plan for layout, materials and furnishings for everyday living. |
| Usługa 3 | Mały lokal usługowy — Czytelna przestrzeń dla klientów i wygodne miejsce pracy dla zespołu. | Small business interiors — A welcoming space for customers and a practical workplace for your team. |
| Współpraca H2 | Od rozmowy do planu | From conversation to a plan |
| Współpraca opis | Najpierw poznajemy potrzeby. Następnie proponujemy kierunek i wspólnie dopracowujemy rozwiązania. Zakres pracy ustalamy przed rozpoczęciem projektu. | First, we explore your needs. Then we propose a direction and refine it together. We agree on the scope before the project begins. |
| Końcowe CTA | Porozmawiajmy o Twojej przestrzeni | Let’s talk about your space |
| Kontakt H1 | Opowiedz nam o swoim wnętrzu | Tell us about your space |
| Kontakt opis | Opisz rodzaj przestrzeni, jej przybliżoną powierzchnię i to, co chcesz zmienić. To pomoże przygotować pierwszą rozmowę. | Describe your space, its approximate size and what you would like to change. This helps us prepare for our first conversation. |
| Kontakt adres | kontakt@pracownia-forma.example — adres demonstracyjny, nie wysyłać wiadomości | kontakt@pracownia-forma.example — demo address, do not send messages |
| Kontakt informacja | To demonstracyjna witryna fikcyjnej pracowni. Nie przyjmujemy rzeczywistych zleceń. | This is a demonstration website for a fictional studio. We do not accept real enquiries. |
| Footer | Pracownia Forma · Projekt demonstracyjny · PL / EN | Pracownia Forma · Demonstration project · PL / EN |
| SEO home: tytuł | Pracownia Forma — wnętrza do życia | Pracownia Forma — interiors for living |
| SEO home: opis | Poznaj trzy usługi fikcyjnej Pracowni Forma: konsultację, projekt mieszkania i projekt małego lokalu. Witryna demonstracyjna. | Explore three services from fictional Pracownia Forma: consultation, home design and small business interiors. Demonstration website. |
| SEO kontakt: tytuł | Kontakt — Pracownia Forma | Contact — Pracownia Forma |
| SEO kontakt: opis | Informacje kontaktowe fikcyjnej Pracowni Forma i wskazówki do pierwszej rozmowy o wnętrzu. Strona demonstracyjna. | Demo contact information for fictional Pracownia Forma and guidance for a first conversation about your interior. |

Menu Usługi prowadzi do sekcji usług strony głównej w wybranym języku. Wszystkie CTA prowadzą do strony kontaktowej w tym samym języku. Brak numeru telefonu i adresu siedziby jest zamierzony; nie tworzyć fikcyjnych danych podszywających się pod realny punkt kontaktowy.

Media do przygotowania podczas próby: autorskie wygenerowane obrazy demonstracyjne salonu i małego lokalu, bez ludzi, znaków towarowych i twierdzeń o realizacjach firmy. Nie pobrano ani nie wygenerowano ich w tej sesji: **blocked do czasu dostawy**. Dla każdego pliku zapisać narzędzie/źródło, autora lub deklarację generacji, datę, warunki wykorzystania, bytes/hash i zatwierdzony alt PL/EN. Proponowane alty: „Demonstracyjna aranżacja spokojnego salonu” / “Demonstration of a calm living room interior”; „Demonstracyjna aranżacja małego lokalu usługowego” / “Demonstration of a small business interior”. Same opisy nie są dowodem posiadania obrazów.

## Materiał AC i przekazanie edycji

Poniższe warunki są wejściem agenta i ręcznego importu FROM_DESIGN, nie drugą listą odbioru. Agent może doprecyzować mierzalne AC, ale zmiana Scope wymaga nowej decyzji. QA przypisuje rzeczywiste identyfikatory testów do zatwierdzonych AC w istniejącym indeksie; nie wpisujemy tu wyników PASS.

| Warunek do zatwierdzenia | Próba ręczna / dowód dla QA | Powiązanie |
|---|---|---|
| Obie strony i treści mają PL/EN; każdy CTA prowadzi do kontaktu w tym samym języku | Przejść każdy CTA i menu w obu językach, przełączyć język na kontakcie, zapisać URL i screenshot | WP-04/05 |
| Strony działają przy 390 px i 1440 px bez poziomego scrolla i utraty treści | Otworzyć oba ekrany; sprawdzić menu, kolejność sekcji i długie teksty; screenshoty bieżącej rewizji | WP-02/04 |
| Klawiatura obsługuje linki, język i menu; focus jest widoczny | Przejść Tab/Shift+Tab/Enter; otworzyć/zamknąć menu i sprawdzić powrót fokusu | WP-04 |
| Redaktor bez kodu zmienia tekst, obraz/alt, CTA, kolejność sekcji, header/footer/menu oraz SEO | Zapis, preview i publikacja edycji w obu językach; porównać frontend i edytor | WP-04/05 |
| Nowy deploy nie kasuje treści ani Global Styles | Zmienić tekst PL/EN i styl, wykonać redeploy zatwierdzonej rewizji, odczytać zachowane wartości; konflikt designu jawny | WP-05 |
| DS posiada rzeczywiste tokeny i traceability do Figmy | Porównać zatwierdzony snapshot, theme.json/Tailwind, frontend i edytor | WP-01/02 |
| Raport i zgody dotyczą finalnego kandydata; publikacja jest oddzielna od release | Otworzyć źródła, przypiąć candidate/version, deployment evidence i verify URL przed release | FLOW-07 |

Proponowana macierz do uzgodnienia z Michałem (konkretne field IDs i token mapping dostarcza F2/F4, nie są jeszcze implementacją):

| Ekran/sekcja | Blok/pole WP | Miejsce edycji | Tłumaczenie i sprawdzenie |
|---|---|---|---|
| Header/footer i menu | Natywne template parts i navigation | Edytor witryny | Oddzielna nawigacja PL/EN; linki oraz przełącznik języka |
| Home: hero, usługi, współpraca, CTA | Natywne bloki/patterns; ACF Pro tylko dla uzgodnionych pól | Edytor strony / uzgodniona grupa ACF | Teksty, media, alt, CTA i kolejność sekcji w obu językach |
| Kontakt | Natywne heading/paragraph/link | Edytor strony | Komunikat demonstracyjny i poprawny odpowiednik językowy |
| SEO każdej strony | Pola Yoast SEO | Edytor danej strony | Tytuł/opis PL/EN i wynik w head dokumentu |
| Tokeny designu | theme.json oraz mapowanie Tailwind | Global Styles / motyw | Zgodność frontend/edytor i zachowanie zmian po redeploy |

## Role i oddzielenie przebiegów

Adam: operator UI/Figma i przekazanie designu. Mateusz: D1–D3/domena/wersje i serwerowe gates. Marcin: workflow, scoping, wykonanie/recovery. Michał: WP i QA. Przed live wskazać konkretną osobę odgrywającą klienta oraz odbierającego; obecnie niepotwierdzeni. Operator zapisuje kto i kiedy podjął symulowaną decyzję oraz dowód; nie udaje logowania prawdziwego klienta.

Każdy przebieg ma odrębne project/run/artifact refs: pełna próba FROM_BRIEF, demonstracja FROM_BRIEF od zera i import FROM_DESIGN. Nazwy proponowane: „Pracownia Forma — próba”, „Pracownia Forma — live”, „Pracownia Forma — import”; nie są ID utworzonych projektów. Czas wykonania i oczekiwania na decyzje mierzyć oddzielnie. Harmonogram pokazu wynika z próby, nie z historycznych 4 godzin UI-06.

## Runbook do przekazania QA — 10 kroków

1. **Nowy projekt.** W wydzielonym pustym portfolio demonstracyjnym utworzyć fikcyjną Pracownię Forma. Zapisać częściowy brief, opuścić wizard i wznowić ten sam krok. Nie usuwać istniejących projektów. Zarejestrować project ID, scope i wersję procesu.
2. **Scope.** Agent zadaje pytania, proponuje strony, AC i narzędzia z uzasadnieniem. Człowiek potwierdza WordPress/Figma i aktualny Scope. Zapisać wersję/hash, decyzję i autora; nie przechodzić dalej z otwartą blokującą kwestią.
3. **UX i realny feedback.** Agent tworzy nowy UX obu stron w Figmie. Człowiek dodaje rzeczywisty komentarz „Na telefonie CTA kontaktowe powinno być dostępne przed listą usług” i odpowiedź „Sprawdzimy układ po poprawce”. Sync tworzy jedną kartę natywnego staff Kanbana i komentarz odpowiedzi; retry nie duplikuje. Agent poprawia UX, zmieniają się bytes/hash snapshotu, człowiek zatwierdza aktualną wersję. Done/resolve nie jest zgodą.
4. **Key Visual.** Agent tworzy KV od zera na zatwierdzonym UX. Symulowany klient ocenia go i podejmuje osobną decyzję; operator zapisuje osobę, dowód i dokładną wersję. Brak decyzji pozostawia etap oczekujący bez automatycznej akceptacji.
5. **DS/UI.** Agent tworzy tokeny, komponenty/stany i oba responsywne ekrany na podstawie zatwierdzonego UX/KV. Klient osobno zatwierdza DS/UI. Adam przekazuje Michałowi file/node/version/hash, token mapping i uzupełnioną macierz edycji/tłumaczeń/testów. Same rendery nie zastępują pakietu.
6. **Implementacja i poprawka.** EXEC/WP wykonują pakiet w nowej witrynie. Niezależny reviewer zgłasza rzeczywistą zaobserwowaną wadę; zapisać reprodukcję, poprawkę i test końcowej rewizji. Nie fabrykować findingu. W raporcie pokazać automatic/manual_handoff i nieznane usage. Timeout oznacza reconcile; nie ponawiać tworzenia witryny w ciemno.
7. **QA WordPressa.** Michał sprawdza FLOW/WP, Tailwind/theme.json, natywną edytowalność i zgodne Yoast/ACF Pro/Polylang. Redaktor wykonuje zmiany treści/mediów/sekcji/menu/SEO PL/EN i sprawdza ich zachowanie oraz Global Styles po redeploy. Zapisuje dowody rzeczywistej edycji, nie tylko screenshot gotowej strony.
8. **Publikacja i osobny odbiór.** Raport wskazuje finalnego kandydata. Odświeżyć projekt, raport i candidate/version; człowiek zatwierdza publikację tej rewizji na konkretny uzgodniony cel. WP/QA publikują, weryfikują URL/build/snapshot i zapisują deployment evidence. Dopiero potem operator zapisuje oddzielny release verdict. Po zmianie evidence/kandydata/etapu zgoda wymaga nowego przeglądu; niepewny POST wymaga sprawdzenia historii, nie automatycznego retry.
9. **Wersje procesu.** Z Marcinem otworzyć istniejący Workflows Studio z ustawień, zmienić graf i warunek, opublikować v2. Utworzyć nowy projekt na v2 i wykazać, że wcześniejszy pozostał na v1 również po restarcie. Zachować refs oraz dowody, nie kopiować edytora grafu.
10. **FROM_DESIGN i verdict.** Pokazać wynik osobnego importu zatwierdzonych ekranów wcześniejszej próby oraz ręcznych AC do aktualnego zatwierdzonego baseline, z datą i ID próby. Bez reverse specification i bez drugiego pełnego WP E2E; nowy flow nadal wymaga własnych etapowych zgód. Odbierający zapisuje verdict i niespełnione wymagania w kanonicznym odbiorze.

## Dowody, capture/verify i fallback

Każdy krok przekazuje QA czas UTC, owner, SHA platformy, profile/schema/fixture versions, project/baseline/artifact refs, sourceRevision strony (snapshot WP bez wymyślonego git SHA), decyzje, raw bytes/hash, komendę/runner/exit code i oznaczenie live/replay/fixture. Nie publikować sekretów ani licencji. Wspólne `hackathon/delivery-demo/{runbook,acceptance,evidence-index}.md` są oczekiwaną dostawą QA; ten plik jest propozycją treści, nie drugim rejestrem wyników.

Sprawdzony odczytem kontrakt [capture.sh](../../../../../hackathon/delivery-demo/evidence/figma/capture.sh): `capture.sh <create|update> <nodeId> <renderUrl> [promptsFile]`, schemaVersion 1, PNG maks. 1 MiB, manifest i SHA256SUMS. Skrypt działa w katalogu własnej lokalizacji, zastępuje wpis tej samej operacji oraz usuwa niepowiązane PNG. Nie uruchamiać go na historycznym katalogu UI-01. QA powinien użyć niezmienionej kopii pary capture/verify w nowym wydzielonym katalogu dla każdego przebiegu/etapu i pary węzłów create/update, zachowując plik promptów; dla dwóch ekranów użyć osobnych katalogów. Limity skryptu nie są limitami usługi Figmy.

[verify.sh](../../../../../hackathon/delivery-demo/evidence/figma/verify.sh) wymaga create/update tego samego nodeId z różnymi hashami, zgodności PNG/rozmiaru/SHA256SUMS i skanu sekretów; nie potwierdza UX, zgód, publikacji ani źródła wersji. Potrzebne są bash, curl, jq, file, stat, sha256sum i git. Wywołania i wynik verify są **not_run** w tej sesji zgodnie z ograniczeniem testów. Przed przechowaniem manifestu sprawdzić bezpieczeństwo renderUrl i wskazań plików; nie utrwalać adresu z poświadczeniami.

Przy niedostępnym API, sesji, licencji lub celu WP zatrzymać zależny etap i wskazać właściciela oraz warunek odblokowania. Pokazać działającą część live, a wcześniejszy materiał wyłącznie z napisem „replay”, ID i czasem poprzedniej próby. Nie przedstawiać starego WP jako wyniku nowego designu. Braki pozostają blocked/not_run; pełny odbiór niespełniony. Po odblokowaniu wznowić od właściwych aktualnych wersji, nowych zgód i weryfikacji.
