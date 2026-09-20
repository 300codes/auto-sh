import type { ScopeContent } from './contracts'

/**
 * The content of the walkthrough this example reproduces: the scope an agent structured from the brief, the prose it
 * wrote for each design stage, and the plan it split the baseline into. It is kept verbatim so the example shows what
 * the system really produced rather than a tidied-up summary of it.
 */
export const EXAMPLE_SCOPE_CONTENT = {
  "pages": [
    {
      "id": "PAGE-HOME",
      "title": "Strona główna",
      "purpose": "Przedstawia obietnicę wartości (proponowany H1: „AI, które znajduje miejsce w codziennej pracy”), trzy typowe problemy klientów i odpowiadające im rozwiązania, wyróżniony przykład zastosowania, opis procesu współpracy oraz sekcję kontaktową, z głównym i dodatkowym CTA."
    },
    {
      "id": "PAGE-SERVICE-KNOWLEDGE",
      "title": "Asystenci wiedzy (podstrona usługi)",
      "purpose": "Opisuje usługę w układzie: dla kogo, jaki problem, co dostarczamy, jak wygląda współpraca, jakich danych potrzebujemy, zaangażowanie klienta, przykładowe zastosowanie, kolejny krok."
    },
    {
      "id": "PAGE-CASE",
      "title": "Przykład zastosowania: Wiedza dla zespołu obsługi",
      "purpose": "Prezentuje kontekst biznesowy, problem, rozwiązanie, zakres, wymagane dane, wdrożenie i pomiar skuteczności, z widocznym oznaczeniem, że jest to scenariusz demonstracyjny na materiałach syntetycznych."
    },
    {
      "id": "PAGE-CONTACT",
      "title": "Kontakt",
      "purpose": "Wyjaśnia, z czym można się zgłosić, jak przygotować się do rozmowy, czego zespół będzie chciał się dowiedzieć i jaki jest kolejny krok; podaje demonstracyjny adres kontakt@aster-works.example."
    }
  ],
  "risks": [
    {
      "id": "RISK-1",
      "text": "Intake nie określa terminu realizacji ani budżetu, co uniemożliwia zaplanowanie etapów i akceptacji.",
      "mitigation": "Ustalić termin i budżet przed rozpoczęciem etapu projektowego i zapisać je w harmonogramie akceptacji."
    },
    {
      "id": "RISK-2",
      "text": "Nie wiadomo, kto dostarcza treści na cztery widoki i w jakim terminie; brak treści blokuje implementację i odbiór.",
      "mitigation": "Wyznaczyć właściciela treści i termin przekazania dla każdego widoku; do czasu dostarczenia pracować na treściach zastępczych oznaczonych jako tymczasowe."
    },
    {
      "id": "RISK-3",
      "text": "Nie ustalono, czy projekt UX/UI w Figmie jest gotowy, czy powstaje w ramach zlecenia, co zmienia zakres i kolejność akceptacji.",
      "mitigation": "Potwierdzić status projektu w Figmie przed startem; jeśli powstaje w ramach zlecenia, uwzględnić etapy akceptacji UX i kierunku wizualnego przed implementacją."
    },
    {
      "id": "RISK-4",
      "text": "Nie wskazano konkretnego narzędzia (wtyczki) SEO, od którego zależy sposób edycji tytułu i opisu.",
      "mitigation": "Uzgodnić nazwę wtyczki SEO przed implementacją i dopasować do niej pola edycji metadanych."
    },
    {
      "id": "RISK-5",
      "text": "Brak potwierdzonego dostawcy autorskiej ilustracji hero, diagramu i logotypu w wersji wektorowej; ich brak blokuje kierunek wizualny i odbiór.",
      "mitigation": "Ustalić dostawcę i termin przekazania materiałów w formatach wektorowych przed etapem implementacji."
    },
    {
      "id": "RISK-6",
      "text": "Nie wybrano fontów ani nie potwierdzono licencji na hosting lokalny, co może naruszyć warunki licencyjne.",
      "mitigation": "Wybrać fonty i potwierdzić licencję na hosting lokalny przed wdrożeniem typografii; w razie wątpliwości użyć fontów o licencji otwartej."
    },
    {
      "id": "RISK-7",
      "text": "Nie ustalono hostingu WordPress ani odpowiedzialności za środowiska Preview i produkcyjne, co zagraża wymaganiu wyłączenia Preview z indeksowania.",
      "mitigation": "Ustalić właściciela środowisk i konfigurację hostingu przed udostępnieniem Preview oraz zweryfikować blokadę indeksowania po uruchomieniu."
    },
    {
      "id": "RISK-8",
      "text": "Nie wiadomo, czy istnieje obecna strona i czy trzeba zachować jej adresy URL lub przekierowania; pominięcie tego może spowodować utratę ruchu i martwe odnośniki.",
      "mitigation": "Potwierdzić istnienie poprzedniego serwisu i w razie potrzeby uzgodnić mapę przekierowań jako osobne ustalenie zakresu."
    },
    {
      "id": "RISK-9",
      "text": "Nie określono wymaganego poziomu zgodności z WCAG poza obsługą klawiatury i widocznym focusem, co może rozszerzyć zakres na późnym etapie.",
      "mitigation": "Potwierdzić oczekiwany poziom zgodności przed akceptacją UI; przy braku ustaleń odbiór obejmuje wyłącznie obsługę klawiaturą i widoczny focus."
    },
    {
      "id": "RISK-10",
      "text": "Sekcja kontaktowa bez działającego formularza może nie spełniać celu biznesowego, jakim jest pozyskiwanie zapytań.",
      "mitigation": "Uzgodnić formę kontaktu w zakresie demonstracyjnym (adres e-mail) i zapisać ewentualny formularz jako osobny, późniejszy zakres."
    },
    {
      "id": "RISK-11",
      "text": "Nie rozstrzygnięto, czy usługi Automatyzacja pracy i Ocena jakości AI otrzymają własne podstrony, co może wywołać oczekiwanie rozszerzenia zakresu w trakcie prac.",
      "mitigation": "Potwierdzić, że w tym zleceniu powstaje wyłącznie podstrona „Asystenci wiedzy”, a pozostałe usługi pozostają sekcjami na stronie głównej."
    }
  ],
  "tools": [],
  "inScope": [
    "Motyw WordPress obejmujący cztery widoki: strona główna, podstrona usługi „Asystenci wiedzy”, przykład zastosowania „Wiedza dla zespołu obsługi”, kontakt.",
    "Nawigacja główna z pozycjami: Rozwiązania, Przykład zastosowania, Jak pracujemy, Kontakt — bez mega menu.",
    "Główne CTA „Porozmawiajmy o projekcie” i drugie CTA „Zobacz przykład zastosowania” w ustalonych miejscach widoków.",
    "Linki do sekcji (kotwice) działające również z podstron, a nie tylko w obrębie strony głównej.",
    "Sekcja trzech problemów klientów wraz z przypisanymi rozwiązaniami: Asystenci wiedzy, Automatyzacja pracy, Ocena jakości AI.",
    "Sekcja opisująca czteroetapowy proces współpracy: Rozpoznanie zadania, Projekt rozwiązania, Wdrożenie, Odbiór i przekazanie.",
    "Edycja bez kodu przez redaktora: teksty, ilustracje, CTA, sekcje, menu, nagłówek i stopka.",
    "Metadane przykładu zastosowania przez ACF: Etap, Typ użytkownika, Zakres rozwiązania.",
    "Edytowalny tytuł i opis SEO każdego widoku przez narzędzie SEO.",
    "Paleta kolorów wdrożona przez tokeny design systemu: granat #082C55, niebieski #0757B8, cyjan #12B8DB.",
    "Responsywność zmieniająca hierarchię treści na mniejszych ekranach, a nie skalująca układ desktopowy.",
    "Obsługa klawiaturą z widocznym focusem i brak poziomego scrollowania na obsługiwanych szerokościach.",
    "Osadzenie autorskiej ilustracji hero, diagramu przykładu zastosowania, prostych elementów UI i logotypu w wersji wektorowej.",
    "Lokalnie hostowane fonty z licencją zezwalającą na taki hosting.",
    "Środowisko Preview wyłączone z indeksowania przez wyszukiwarki.",
    "Treści wyłącznie w języku polskim."
  ],
  "summary": "Statyczna, jednojęzyczna (polska) strona firmowa Aster Works w formie motywu WordPress, złożona z czterech widoków: strony głównej, podstrony usługi „Asystenci wiedzy”, przykładu zastosowania „Wiedza dla zespołu obsługi” oraz strony kontaktu. Narracja prowadzi odbiorcę B2B ścieżką problem → rozwiązanie → przykład zastosowania → sposób współpracy → kontakt, z głównym CTA „Porozmawiajmy o projekcie” i drugim CTA „Zobacz przykład zastosowania”. Komunikacja opiera się na problemie klienta i dostarczanej wartości, a nie na modelach ani technologiach AI. Treści, sekcje, menu, CTA i ilustracje są edytowalne przez redaktora bez kodu i nie mogą zostać utracone przy aktualizacji motywu. Zakres nie obejmuje działającego formularza kontaktowego, rezerwacji spotkań, bloga, panelu klienta, płatności ani wersji językowych; kontakt jest demonstracyjny (kontakt@aster-works.example), a przykłady są oznaczone jako demonstracyjne na materiałach syntetycznych.",
  "keyFlows": [
    {
      "id": "FLOW-COO",
      "steps": [
        "Wejście na stronę główną i zapoznanie się z obietnicą wartości.",
        "Rozpoznanie własnego problemu w sekcji trzech typowych problemów klientów.",
        "Przejście do przypisanego rozwiązania „Asystenci wiedzy” na podstronie usługi.",
        "Zapoznanie się z opisem czteroetapowego procesu współpracy.",
        "Użycie głównego CTA „Porozmawiajmy o projekcie” i przejście do widoku kontaktu."
      ],
      "title": "Ścieżka COO: od problemu operacyjnego do kontaktu"
    },
    {
      "id": "FLOW-CTO",
      "steps": [
        "Wejście do menu „Rozwiązania” i otwarcie podstrony usługi „Asystenci wiedzy”.",
        "Zapoznanie się z zakresem dostarczenia oraz z wymaganiami dotyczącymi danych i zaangażowania klienta.",
        "Przejście do przykładu zastosowania „Wiedza dla zespołu obsługi” przez CTA „Zobacz przykład zastosowania”.",
        "Zapoznanie się z wdrożeniem i sposobem pomiaru skuteczności oraz z oznaczeniem scenariusza jako demonstracyjnego.",
        "Przejście do widoku kontaktu i zapoznanie się z przygotowaniem do rozmowy."
      ],
      "title": "Ścieżka CTO: od usługi przez wymagania danych do kontaktu"
    },
    {
      "id": "FLOW-RETURNING",
      "steps": [
        "Wejście na dowolny widok i użycie menu głównego.",
        "Wybór pozycji „Przykład zastosowania” z menu.",
        "Zapoznanie się z kontekstem biznesowym i zakresem przykładu.",
        "Użycie CTA „Porozmawiajmy o projekcie” prowadzącego do kontaktu."
      ],
      "title": "Ścieżka powracającego odbiorcy: menu, przykład, CTA"
    }
  ],
  "platform": {
    "profileId": "wordpress-theme",
    "rationale": "Profil dostarczenia „motyw WordPress” odpowiada temu, co opisuje intake: serwis prezentacyjny złożony z czterech widoków treściowych, bez logowania, płatności, panelu klienta i integracji z CRM. Kluczowe wymaganie — pełna edycja tekstów, ilustracji, CTA, sekcji, menu, nagłówka i stopki przez redaktora bez kodu — realizuje natywna edycja treści i menu w WordPress. Wskazane w intake integracje, czyli ACF dla metadanych przykładu zastosowania oraz narzędzie SEO dla tytułu i opisu, są rozszerzeniami ekosystemu WordPress. Wymóg, by treści nie zostały utracone przy aktualizacji motywu, jest spełniony dzięki oddzieleniu treści przechowywanych w bazie od kodu motywu. Jednojęzyczny zakres, brak działającego formularza i brak rezerwacji spotkań oznaczają, że nie jest potrzebna warstwa aplikacyjna wykraczająca poza motyw, a paleta kolorów i typografia mogą zostać wdrożone jako tokeny design systemu w obrębie motywu.",
    "profileVersion": 1
  },
  "outOfScope": [
    "Blog i sekcja aktualności.",
    "Panel klienta, logowanie i konta użytkowników.",
    "Płatności i rozliczenia online.",
    "Wersje językowe i mechanizmy tłumaczeń.",
    "Integracja z CRM.",
    "Kalendarz i rezerwacja spotkań.",
    "Działający formularz kontaktowy wysyłający dane — kontakt odbywa się przez adres demonstracyjny kontakt@aster-works.example.",
    "Rozbudowany katalog usług; podstrony usług „Automatyzacja pracy” i „Ocena jakości AI”.",
    "Mega menu, wideo w tle, stockowe ilustracje robotów i ściany logotypów.",
    "Fikcyjni klienci, logotypy, partnerstwa, certyfikaty, opinie i statystyki; gwarantowane oszczędności lub wyniki.",
    "Publikacja produkcyjna jako element tego zakresu — stanowi osobny etap z odrębną akceptacją."
  ],
  "assumptions": [
    "Realizacja obejmuje wyłącznie motyw WordPress dla czterech widoków wymienionych w intake; publikacja produkcyjna jest osobnym etapem z odrębną akceptacją.",
    "Odbiór obejmuje kryteria wskazane w intake: poprawne działanie na desktopie i mobile, działającą nawigację i CTA, brak pustych linków, zgodność z zaakceptowanym UI oraz czytelną hierarchię treści.",
    "Akceptacje odbywają się osobno dla zakresu projektu, UX i struktury informacji, kierunku wizualnego, UI i design systemu, implementacji, Preview i publikacji, przy czym UX i kierunek wizualny są akceptowane przed implementacją.",
    "Proponowany nagłówek H1 strony głównej „AI, które znajduje miejsce w codziennej pracy” podlega akceptacji na etapie treści.",
    "Adres kontakt@aster-works.example jest adresem demonstracyjnym i przed publikacją produkcyjną zostanie zastąpiony adresem docelowym.",
    "Treści, materiały graficzne, fonty i wybór narzędzia SEO zostaną dostarczone lub potwierdzone przez zamawiającego przed odpowiadającymi im etapami prac.",
    "Wszystkie pytania otwarte z intake pozostają nierozstrzygnięte i wymagają odpowiedzi przed akceptacją zakresu."
  ],
  "requirements": [
    {
      "id": "REQ-1",
      "title": "Cztery widoki serwisu",
      "description": "Motyw udostępnia cztery widoki opisane w intake: stronę główną, podstronę usługi „Asystenci wiedzy”, przykład zastosowania „Wiedza dla zespołu obsługi” i kontakt, każdy z sekcjami wymienionymi w intake."
    },
    {
      "id": "REQ-2",
      "title": "Nawigacja główna bez mega menu",
      "description": "Menu główne zawiera pozycje Rozwiązania, Przykład zastosowania, Jak pracujemy, Kontakt. Nawigacja jest dostępna na każdym widoku i nie wykorzystuje mega menu."
    },
    {
      "id": "REQ-3",
      "title": "Linki do sekcji działające z podstron",
      "description": "Odnośniki prowadzące do sekcji strony głównej (np. Rozwiązania, Jak pracujemy) działają także wtedy, gdy zostaną użyte z podstrony usługi, przykładu zastosowania lub kontaktu."
    },
    {
      "id": "REQ-4",
      "title": "Główne i dodatkowe CTA",
      "description": "Na widokach występują dwa wezwania do działania: główne „Porozmawiajmy o projekcie” oraz drugie „Zobacz przykład zastosowania”, prowadzące odpowiednio do kontaktu i do widoku przykładu zastosowania."
    },
    {
      "id": "REQ-5",
      "title": "Sekcja trzech problemów i rozwiązań",
      "description": "Strona główna zawiera sekcję przedstawiającą trzy problemy klientów (rozproszone dokumenty, powtarzanie tych samych kroków w kilku narzędziach, prototyp bez kryteriów oceny i odbioru) wraz z przypisanymi rozwiązaniami: Asystenci wiedzy, Automatyzacja pracy, Ocena jakości AI."
    },
    {
      "id": "REQ-6",
      "title": "Sekcja czteroetapowego procesu współpracy",
      "description": "Strona główna zawiera sekcję opisującą proces współpracy z perspektywy klienta w czterech etapach: Rozpoznanie zadania, Projekt rozwiązania, Wdrożenie, Odbiór i przekazanie."
    },
    {
      "id": "REQ-7",
      "title": "Edycja treści bez kodu",
      "description": "Redaktor może bez ingerencji w kod edytować teksty, ilustracje, CTA, sekcje, menu, nagłówek i stopkę z poziomu panelu WordPress."
    },
    {
      "id": "REQ-8",
      "title": "Metadane przykładu zastosowania w ACF",
      "description": "Przykład zastosowania posiada pola ACF: Etap, Typ użytkownika, Zakres rozwiązania, edytowalne przez redaktora i prezentowane na widoku przykładu."
    },
    {
      "id": "REQ-9",
      "title": "Edytowalne metadane SEO",
      "description": "Dla każdego widoku tytuł i opis SEO są edytowalne przez wskazane narzędzie SEO, bez zmian w kodzie motywu."
    },
    {
      "id": "REQ-10",
      "title": "Paleta kolorów w tokenach design systemu",
      "description": "Kolory granat #082C55, niebieski #0757B8 i cyjan #12B8DB są wdrożone jako tokeny design systemu i używane w widokach zgodnie z zaakceptowanym kierunkiem wizualnym: jasne tła sekcji z granatowym tekstem, dopuszczalny ciemny hero."
    },
    {
      "id": "REQ-11",
      "title": "Responsywność zmieniająca hierarchię treści",
      "description": "Na mniejszych ekranach układ zmienia hierarchię i kolejność prezentacji treści zamiast proporcjonalnie skalować układ desktopowy."
    },
    {
      "id": "REQ-12",
      "title": "Obsługa klawiaturą i brak poziomego scrollowania",
      "description": "Nawigacja, CTA i pozostałe elementy interaktywne są obsługiwane klawiaturą z widocznym wskaźnikiem focusu, a widoki nie powodują poziomego scrollowania na obsługiwanych szerokościach."
    },
    {
      "id": "REQ-13",
      "title": "Preview wyłączone z indeksowania",
      "description": "Środowisko Preview jest wyłączone z indeksowania przez wyszukiwarki; publikacja produkcyjna jest osobnym etapem wymagającym akceptacji."
    },
    {
      "id": "REQ-14",
      "title": "Trwałość treści przy aktualizacji motywu",
      "description": "Treści wprowadzone przez redaktora nie są tracone przy aktualizacji motywu ani kodu — są przechowywane w danych WordPress, a nie w plikach motywu."
    },
    {
      "id": "REQ-15",
      "title": "Fonty hostowane lokalnie i zoptymalizowane grafiki",
      "description": "Fonty są hostowane lokalnie na podstawie licencji dopuszczającej taki hosting, a grafiki dostarczane są jako SVG lub zoptymalizowane pliki rastrowe."
    },
    {
      "id": "REQ-16",
      "title": "Materiały graficzne zgodne z kierunkiem wizualnym",
      "description": "Widoki wykorzystują autorską ilustrację hero, diagram przykładu zastosowania, proste elementy UI i logotyp (sześć połączonych węzłów wokół znaku A, wersja wektorowa bez poświaty), bez stockowych robotów, ścian logotypów i wideo w tle."
    },
    {
      "id": "REQ-17",
      "title": "Kontakt bez formularza wysyłającego dane",
      "description": "Widok kontaktu nie zawiera formularza wysyłającego dane ani rezerwacji spotkań; wskazuje demonstracyjny adres kontakt@aster-works.example oraz kolejny krok."
    },
    {
      "id": "REQ-18",
      "title": "Oznaczenie materiałów demonstracyjnych",
      "description": "Przykład zastosowania jest oznaczony jako scenariusz demonstracyjny na materiałach syntetycznych; serwis nie zawiera fikcyjnych klientów, logotypów, partnerstw, certyfikatów, opinii, statystyk ani obietnic gwarantowanych wyników."
    },
    {
      "id": "REQ-19",
      "title": "Jeden język serwisu",
      "description": "Serwis jest dostępny wyłącznie w języku polskim, bez przełącznika języków i bez mechanizmów tłumaczeń."
    },
    {
      "id": "REQ-20",
      "title": "Poprawność nawigacji i brak pustych linków",
      "description": "Wszystkie odnośniki w nawigacji, CTA i treści prowadzą do istniejących widoków lub sekcji; w serwisie nie występują puste odnośniki."
    }
  ],
  "openQuestionIds": [],
  "acceptanceCriteria": [
    {
      "id": "AC-1",
      "description": "Recenzent otwiera cztery widoki i stwierdza, że każdy zawiera sekcje wymienione w intake dla tego widoku.",
      "requirementId": "REQ-1"
    },
    {
      "id": "AC-2",
      "description": "Na każdym z czterech widoków menu główne wyświetla dokładnie pozycje Rozwiązania, Przykład zastosowania, Jak pracujemy, Kontakt i nie rozwija mega menu.",
      "requirementId": "REQ-2"
    },
    {
      "id": "AC-3",
      "description": "Recenzent, będąc na podstronie usługi, przykładzie zastosowania i kontakcie, klika odnośnik do sekcji strony głównej i trafia na tę sekcję.",
      "requirementId": "REQ-3"
    },
    {
      "id": "AC-4",
      "description": "Na stronie głównej widoczne są CTA „Porozmawiajmy o projekcie” i „Zobacz przykład zastosowania”; kliknięcie pierwszego prowadzi do kontaktu, a drugiego do widoku przykładu zastosowania.",
      "requirementId": "REQ-4"
    },
    {
      "id": "AC-5",
      "description": "Sekcja na stronie głównej prezentuje trzy problemy klientów wymienione w intake, a przy każdym widoczne jest przypisane rozwiązanie: Asystenci wiedzy, Automatyzacja pracy lub Ocena jakości AI.",
      "requirementId": "REQ-5"
    },
    {
      "id": "AC-6",
      "description": "Sekcja procesu na stronie głównej przedstawia cztery etapy w kolejności: Rozpoznanie zadania, Projekt rozwiązania, Wdrożenie, Odbiór i przekazanie.",
      "requirementId": "REQ-6"
    },
    {
      "id": "AC-7",
      "description": "Recenzent w panelu WordPress zmienia tekst, ilustrację, etykietę CTA, pozycję menu oraz element nagłówka i stopki, a zmiany są widoczne na froncie bez modyfikacji kodu.",
      "requirementId": "REQ-7"
    },
    {
      "id": "AC-8",
      "description": "W edycji przykładu zastosowania dostępne są pola ACF Etap, Typ użytkownika i Zakres rozwiązania; po ich uzupełnieniu wartości są widoczne na widoku przykładu.",
      "requirementId": "REQ-8"
    },
    {
      "id": "AC-9",
      "description": "Dla każdego z czterech widoków recenzent zmienia tytuł i opis SEO w narzędziu SEO, a nowe wartości pojawiają się w źródle strony.",
      "requirementId": "REQ-9"
    },
    {
      "id": "AC-10",
      "description": "Kolory użyte w widokach pochodzą z tokenów design systemu, a zmiana wartości tokenu koloru akcentu jest widoczna we wszystkich miejscach korzystających z tego tokenu.",
      "requirementId": "REQ-10"
    },
    {
      "id": "AC-11",
      "description": "Przy szerokości mobilnej recenzent stwierdza, że kolejność i hierarchia sekcji różni się od desktopu zgodnie z zaakceptowanym projektem, a treść nie jest jedynie pomniejszoną wersją desktopu.",
      "requirementId": "REQ-11"
    },
    {
      "id": "AC-12",
      "description": "Recenzent przechodzi przez menu i CTA wyłącznie klawiaturą, w każdym kroku widzi wskaźnik focusu, a na desktopie i mobile nie występuje poziomy pasek przewijania.",
      "requirementId": "REQ-12"
    },
    {
      "id": "AC-13",
      "description": "W środowisku Preview odpowiedź serwera i znaczniki strony wskazują wyłączenie z indeksowania, a plik robots Preview nie zezwala na indeksowanie.",
      "requirementId": "REQ-13"
    },
    {
      "id": "AC-14",
      "description": "Po ponownym wgraniu lub aktualizacji motywu treści wprowadzone wcześniej przez redaktora na czterech widokach pozostają niezmienione.",
      "requirementId": "REQ-14"
    },
    {
      "id": "AC-15",
      "description": "Recenzent stwierdza, że pliki fontów są serwowane z domeny serwisu, a grafiki mają format SVG lub zoptymalizowany raster.",
      "requirementId": "REQ-15"
    },
    {
      "id": "AC-16",
      "description": "Na widokach występują ilustracja hero, diagram przykładu zastosowania i logotyp w wersji wektorowej, a recenzent nie znajduje stockowych robotów, ściany logotypów ani wideo w tle.",
      "requirementId": "REQ-16"
    },
    {
      "id": "AC-17",
      "description": "Widok kontaktu nie zawiera pola formularza ani mechanizmu rezerwacji spotkania, a prezentuje adres kontakt@aster-works.example oraz opis kolejnego kroku.",
      "requirementId": "REQ-17"
    },
    {
      "id": "AC-18",
      "description": "Na widoku przykładu zastosowania widoczna jest informacja, że jest to scenariusz demonstracyjny na materiałach syntetycznych, a recenzent nie znajduje w serwisie nazw klientów, opinii, statystyk ani deklaracji gwarantowanych wyników.",
      "requirementId": "REQ-18"
    },
    {
      "id": "AC-19",
      "description": "Wszystkie widoczne treści i etykiety interfejsu są w języku polskim, a w serwisie nie występuje przełącznik języka.",
      "requirementId": "REQ-19"
    },
    {
      "id": "AC-20",
      "description": "Recenzent klika każdy odnośnik nawigacji, CTA i odnośniki w treści czterech widoków; każdy prowadzi do istniejącego widoku lub sekcji i żaden nie jest pusty.",
      "requirementId": "REQ-20"
    }
  ]
} as unknown as ScopeContent

export const EXAMPLE_STAGE_PROSE: Record<'ux' | 'key_visual' | 'design_system_ui', { summary: string; notes: string }> = {
  "ux": {
    "summary": "Etap UX ustala strukturę informacji i przebieg czterech widoków serwisu Aster Works: strony głównej, podstrony usługi „Asystenci wiedzy”, przykładu zastosowania „Wiedza dla zespołu obsługi” oraz kontaktu. Narracja każdego widoku prowadzi odbiorcę B2B ścieżką problem → rozwiązanie → przykład zastosowania → sposób współpracy → kontakt, a głównym punktem wyjścia jest CTA „Porozmawiajmy o projekcie”, uzupełnione drugim CTA „Zobacz przykład zastosowania”. Nawigacja główna jest płaska i zawiera dokładnie cztery pozycje: Rozwiązania, Przykład zastosowania, Jak pracujemy, Kontakt; odnośniki do sekcji strony głównej działają również z podstron. Układ mobilny zmienia kolejność i hierarchię sekcji zamiast skalować widok desktopowy, a cała obsługa jest możliwa klawiaturą z widocznym focusem. Kontakt pozostaje demonstracyjny (kontakt@aster-works.example), bez formularza i rezerwacji spotkań, a przykład zastosowania jest jawnie oznaczony jako scenariusz demonstracyjny na materiałach syntetycznych. Dokument opisuje wyłącznie strukturę i przebieg — nie powstają na tym etapie żadne pliki projektowe, makiety ani węzły Figma, a treści widoków pozostają w całości w języku polskim.",
    "notes": "STRUKTURA SERWISU\n1. Strona główna — punkt wejścia dla wszystkich ścieżek.\n2. Asystenci wiedzy — podstrona usługi (jedyna podstrona usługi w zakresie).\n3. Wiedza dla zespołu obsługi — przykład zastosowania.\n4. Kontakt — zamknięcie ścieżki.\nBrak innych poziomów: bez bloga, panelu klienta, logowania, wersji językowych.\n\nNAWIGACJA\nMenu główne, identyczne na czterech widokach: Rozwiązania, Przykład zastosowania, Jak pracujemy, Kontakt.\nBez mega menu i bez rozwijanych poziomów drugiego rzędu.\n„Rozwiązania” prowadzi do sekcji problemów i rozwiązań; „Jak pracujemy” do sekcji procesu współpracy.\nPozycje wskazujące sekcje strony głównej działają jako odnośniki pełne (adres strony głównej + kotwica), aby działały także z podstron.\nStopka: powtórzenie pozycji menu, adres kontaktowy, oznaczenie charakteru demonstracyjnego przykładów.\nNagłówek i stopka edytowalne przez redaktora bez kodu.\n\nSTRONA GŁÓWNA — SEKCJE W KOLEJNOŚCI\n1. Hero: H1 „AI, które znajduje miejsce w codziennej pracy”, krótkie rozwinięcie obietnicy wartości, CTA główne „Porozmawiajmy o projekcie”, CTA drugie „Zobacz przykład zastosowania”, autorska ilustracja hero, możliwe ciemne tło.\n2. Trzy typowe problemy klientów, każdy z przypisanym rozwiązaniem: Asystenci wiedzy, Automatyzacja pracy, Ocena jakości AI. Tylko „Asystenci wiedzy” prowadzi do podstrony usługi; dwa pozostałe pozostają opisami bez podstron.\n3. Wyróżniony przykład zastosowania „Wiedza dla zespołu obsługi”: skrót kontekstu i odnośnik do pełnego widoku.\n4. Proces współpracy — cztery etapy w kolejności: Rozpoznanie zadania → Projekt rozwiązania → Wdrożenie → Odbiór i przekazanie, opisane z perspektywy klienta.\n5. Sekcja kontaktowa: powtórzenie CTA głównego i adres demonstracyjny.\n\nASYSTENCI WIEDZY — SEKCJE W KOLEJNOŚCI\n1. Dla kogo jest ta usługa.\n2. Jaki problem rozwiązuje.\n3. Co dostarczamy.\n4. Jak wygląda współpraca (odwołanie do czterech etapów).\n5. Jakich danych potrzebujemy.\n6. Zaangażowanie klienta.\n7. Przykładowe zastosowanie — z CTA „Zobacz przykład zastosowania”.\n8. Kolejny krok — CTA „Porozmawiajmy o projekcie”.\n\nPRZYKŁAD ZASTOSOWANIA — SEKCJE W KOLEJNOŚCI\n0. Oznaczenie u góry widoku: scenariusz demonstracyjny na materiałach syntetycznych; widoczne bez przewijania.\n1. Kontekst biznesowy.\n2. Problem.\n3. Rozwiązanie.\n4. Zakres.\n5. Wymagane dane.\n6. Wdrożenie.\n7. Pomiar skuteczności — bez deklaracji gwarantowanych wyników i bez liczb, których intake nie podaje.\n8. Kolejny krok — CTA „Porozmawiajmy o projekcie”.\nMetadane widoczne przy nagłówku, uzupełniane przez ACF: Etap, Typ użytkownika, Zakres rozwiązania.\nDiagram przykładu zastosowania osadzony przy sekcji rozwiązania lub wdrożenia.\n\nKONTAKT — SEKCJE W KOLEJNOŚCI\n1. Z czym można się zgłosić.\n2. Jak przygotować się do rozmowy.\n3. Czego będziemy chcieli się dowiedzieć.\n4. Kolejny krok oraz adres demonstracyjny kontakt@aster-works.example.\nBez pól formularza, bez przycisku wysyłki, bez kalendarza rezerwacji.\n\nŚCIEŻKI UŻYTKOWNIKÓW\nCOO: hero → sekcja trzech problemów → podstrona „Asystenci wiedzy” → proces współpracy → CTA główne → kontakt. Punkt rozpoznania: własny problem operacyjny opisany językiem pracy, nie technologii.\nCTO: menu „Rozwiązania” → „Asystenci wiedzy” → zakres dostarczenia, wymagania danych, zaangażowanie klienta → CTA „Zobacz przykład zastosowania” → wdrożenie i pomiar skuteczności → kontakt i przygotowanie do rozmowy.\nProduct Lead: hero → problem odpowiadający rozszerzeniu produktu o AI → rozwiązanie → przykład zastosowania → kontakt.\nPowracający odbiorca: dowolny widok → menu → „Przykład zastosowania” → kontekst i zakres → CTA główne → kontakt.\nKażda ścieżka kończy się tym samym krokiem: widok kontaktu z adresem demonstracyjnym.\n\nHIERARCHIA I RESPONSYWNOŚĆ\nNa mobile kolejność i waga sekcji zmieniają się zgodnie z projektem, a nie przez pomniejszenie desktopu: pierwszy ekran to obietnica wartości i CTA główne, ilustracja hero ustępuje treści, sekcja trzech problemów przechodzi w układ pionowy, proces współpracy w listę etapów.\nBrak poziomego przewijania na obsługiwanych szerokościach.\nJeden H1 na widok; nagłówki sekcji w kolejności bez pomijania poziomów.\n\nDOSTĘPNOŚĆ I OBSŁUGA\nPełne przejście menu i CTA samą klawiaturą, widoczny wskaźnik focusu na każdym kroku.\nEtykiety CTA identyczne we wszystkich miejscach: „Porozmawiajmy o projekcie”, „Zobacz przykład zastosowania”.\nTeksty alternatywne dla ilustracji hero, diagramu i logotypu.\n\nEDYCJA I TRWAŁOŚĆ TREŚCI\nRedaktor edytuje bez kodu: teksty, ilustracje, etykiety CTA, sekcje, menu, nagłówek, stopka.\nTytuł i opis SEO każdego z czterech widoków edytowalne w narzędziu SEO.\nTreści przetrwają ponowne wgranie lub aktualizację motywu.\nKolory wyłącznie z tokenów design systemu: granat #082C55, niebieski #0757B8, cyjan #12B8DB.\n\nSTANY DO SPRAWDZENIA PRZEZ RECENZENTA\nMenu: te same cztery pozycje na każdym widoku, brak mega menu, stan aktywnej pozycji.\nOdnośniki kotwiczące uruchomione z podstrony usługi, przykładu i kontaktu — czy trafiają do właściwej sekcji strony głównej.\nCTA: oba widoczne na stronie głównej, cele zgodne (główne → kontakt, drugie → przykład zastosowania).\nBrak pustych odnośników: każdy odnośnik nawigacji, CTA i odnośnik w treści prowadzi do istniejącego widoku lub sekcji.\nStan mobilny: zmieniona hierarchia, brak poziomego paska przewijania, menu rozwijane bez mega menu.\nStan focusu: widoczny na każdym elemencie interaktywnym przy nawigacji klawiaturą.\nPrzykład zastosowania z uzupełnionymi i pustymi polami ACF — widok pozostaje czytelny w obu przypadkach.\nWidoczność oznaczenia demonstracyjnego przy pierwszym kontakcie z widokiem przykładu.\nWidok kontaktu bez pola formularza i bez mechanizmu rezerwacji.\nPreview: wyłączenie z indeksowania po stronie odpowiedzi serwera, znaczników i pliku robots.\nJęzyk: wszystkie treści i etykiety po polsku, brak przełącznika języka.\nZgodność z zakazami wizualnymi: brak stockowych robotów, ściany logotypów i wideo w tle; brak nazw klientów, opinii, statystyk i deklaracji gwarantowanych wyników.\n\nOTWARTE DO DECYZJI PRZED AKCEPTACJĄ UX\nCzy sekcja kontaktowa na stronie głównej powtarza pełną treść widoku kontaktu, czy tylko skrót z odnośnikiem.\nCzy dwa rozwiązania bez podstron (Automatyzacja pracy, Ocena jakości AI) kierują do sekcji kontaktu, czy pozostają bez odnośnika.\nMiejsce diagramu przykładu zastosowania: przy sekcji rozwiązania czy wdrożenia.\nKolejność sekcji na mobile dla widoku przykładu zastosowania.\nAkceptacja UX i struktury informacji jest odrębna od akceptacji kierunku wizualnego i poprzedza implementację."
  },
  "key_visual": {
    "summary": "Zbudowano kierunek wizualny Aster Works oparty na wartości biznesowej przed technologią: jasna plansza zasad oraz ciemny hero strony głównej z czytelnymi CTA, wektorowym motywem połączonych węzłów i zapowiedzią procesu współpracy.",
    "notes": "Sprawdzić paletę tokenów: #082C55, #0757B8, #12B8DB oraz jasne tło.\nSprawdzić skalę typograficzną Inter i możliwość lokalnego hostowania fontu.\nSprawdzić kontrast CTA i widoczność obrysu drugiego CTA.\nSprawdzić dokładne brzmienie polskiego H1, menu i obu CTA.\nSprawdzić wektorowy logotyp: sześć połączonych węzłów wokół znaku A, bez poświaty.\nSprawdzić brak stockowych robotów, wideo, fikcyjnych klientów, statystyk i opinii.\nSprawdzić kolejność czterech etapów współpracy w dolnym pasie hero.\nObie ramki nie zawierają aktywnych placeholderów ani brakujących fontów.\n01 — Kierunek wizualny — 1440×1320 (4:2)\n02 — Strona główna / Hero — 1440×1024 (4:7)"
  },
  "design_system_ui": {
    "summary": "Zbudowano system UI Aster Works: udokumentowaną paletę, typografię i skalę odstępów, zestaw komponentów wraz ze stanami klawiaturowymi oraz kompletny widok strony głównej 1440×1024. Projekt prowadzi odbiorcę od problemów przez rozwiązania i przykład demonstracyjny do procesu współpracy oraz kontaktu.",
    "notes": "Sprawdzić zgodność kolorów z tokenami #082C55, #0757B8 i #12B8DB.\nSprawdzić stany default, hover, focus-visible i disabled przycisków oraz widoczny focus linku kontaktowego.\nSprawdzić dokładne pozycje menu: Rozwiązania, Przykład zastosowania, Jak pracujemy, Kontakt.\nSprawdzić trzy mapowania problemów na rozwiązania i cztery etapy współpracy.\nSprawdzić oznaczenie przykładu jako scenariusza demonstracyjnego.\nSprawdzić brak formularza oraz obecność adresu kontakt@aster-works.example.\nSprawdzić wektorowy znak sześciu połączonych węzłów i autorską ilustrację hero.\nRendery zapisano jako 20-31.png, 23-19.png i 24-19.png.\nDS UI — 04 Tokeny i style — 1440×1024 (20:31)\nDS UI — 05 Komponenty i stany — 1440×1024 (23:19)\nDS UI — 06 Strona główna / High fidelity — 1440×1024 (24:19)"
  }
}

export const EXAMPLE_TASKS: readonly { key: string; title: string; description: string; acIds: string[]; allowedPaths: string[] }[] = [
  {
    "key": "TASK-1",
    "title": "Fundament motywu: tokeny design systemu, lokalne fonty i style bazowe",
    "description": "Załóż szkielet motywu blokowego: theme.json z tokenami kolorów (granat #082C55, niebieski #0757B8, cyjan #12B8DB, w tym token koloru akcentu używany wszędzie tam, gdzie występuje akcent), skalą typograficzną i rodzinami fontów wskazującymi pliki hostowane lokalnie w assets/fonts. Dodaj pliki fontów do assets/fonts i zarejestruj je tak, by były serwowane z domeny serwisu, bez odwołań do zewnętrznych dostawców fontów. W style.css ustaw style bazowe oraz widoczny wskaźnik focusu korzystający z tokenów. W functions.php zarejestruj wsparcie motywu i wczytanie stylów. Napisz test w tests/**, który sprawdza, że kolory w motywie pochodzą z tokenów (brak zahardkodowanych wartości hex poza theme.json), że zmiana wartości tokenu akcentu propaguje się do miejsc z niego korzystających, oraz że deklaracje fontów wskazują wyłącznie zasoby lokalne.",
    "acIds": [
      "AC-10",
      "AC-15"
    ],
    "allowedPaths": [
      "theme.json",
      "style.css",
      "functions.php",
      "assets/**",
      "inc/**",
      "tests/**"
    ]
  },
  {
    "key": "TASK-10",
    "title": "Weryfikacja kompletności sekcji, odnośników i jednojęzyczności serwisu",
    "description": "Przejrzyj cztery widoki i uzupełnij braki, tak aby każdy zawierał sekcje wymienione w intake dla tego widoku, wszystkie odnośniki nawigacji, CTA i treści prowadziły do istniejących widoków lub sekcji (w tym kotwic strony głównej używanych z podstron) i żaden nie był pusty, a wszystkie widoczne treści oraz etykiety interfejsu były wyłącznie w języku polskim, bez przełącznika języka i mechanizmów tłumaczeń. Napisz test w tests/**, który sprawdza komplet sekcji na czterech widokach, rozwiązuje każdy odnośnik nawigacji, CTA i treści do istniejącego widoku lub kotwicy, wykrywa puste odnośniki oraz potwierdza jednojęzyczność i brak przełącznika języka.",
    "acIds": [
      "AC-1",
      "AC-3",
      "AC-19",
      "AC-20"
    ],
    "allowedPaths": [
      "templates/**",
      "patterns/**",
      "parts/**",
      "style.css",
      "tests/**"
    ]
  },
  {
    "key": "TASK-2",
    "title": "Grafika: logotyp wektorowy, ilustracja hero i diagram przykładu zastosowania",
    "description": "Przygotuj autorskie grafiki SVG w assets/**: logotyp Aster Works (sześć połączonych węzłów wokół znaku A, wersja wektorowa bez poświaty), ilustrację hero oraz diagram przykładu zastosowania. Grafiki korzystają z kolorów tokenów design systemu z TASK-1 i mają format SVG albo zoptymalizowany raster. Nie dodawaj stockowych robotów, ścian logotypów ani wideo w tle. Napisz test w tests/**, który sprawdza obecność plików logotypu, ilustracji hero i diagramu, ich wektorowy lub zoptymalizowany format oraz brak zasobów wideo tła i plików ścian logotypów w motywie.",
    "acIds": [
      "AC-16"
    ],
    "allowedPaths": [
      "assets/**",
      "tests/**"
    ]
  },
  {
    "key": "TASK-3",
    "title": "Nagłówek, stopka i nawigacja główna bez mega menu",
    "description": "Zbuduj parts/header.html i parts/footer.html z blokiem nawigacji, w którym menu główne zawiera dokładnie pozycje Rozwiązania, Przykład zastosowania, Jak pracujemy, Kontakt, bez mega menu. Nagłówek prezentuje logotyp wektorowy z TASK-2. Odnośniki do sekcji strony głównej (Rozwiązania, Jak pracujemy) są absolutnymi linkami z kotwicą, żeby działały również z podstron usługi, przykładu zastosowania i kontaktu; Przykład zastosowania i Kontakt prowadzą do własnych widoków. Zarejestruj obszary menu w functions.php lub inc/**, tak aby nagłówek i stopka były edytowalne z panelu. Napisz test w tests/**, który sprawdza dokładny zestaw pozycji menu, brak mega menu, brak pustych href oraz absolutną formę odnośników kotwicowych.",
    "acIds": [
      "AC-2",
      "AC-3",
      "AC-20"
    ],
    "allowedPaths": [
      "parts/**",
      "patterns/**",
      "functions.php",
      "inc/**",
      "style.css",
      "tests/**"
    ]
  },
  {
    "key": "TASK-4",
    "title": "Strona główna: hero, problemy i rozwiązania, proces współpracy, CTA",
    "description": "Zbuduj szablon strony głównej w templates/** oraz wzorce w patterns/**: hero z autorską ilustracją (dopuszczalne ciemne tło), sekcja z kotwicą Rozwiązania prezentująca trzy problemy klientów z intake (rozproszone dokumenty, powtarzanie tych samych kroków w kilku narzędziach, prototyp bez kryteriów oceny i odbioru) wraz z przypisanymi rozwiązaniami Asystenci wiedzy, Automatyzacja pracy, Ocena jakości AI, oraz sekcja z kotwicą Jak pracujemy z czterema etapami w kolejności: Rozpoznanie zadania, Projekt rozwiązania, Wdrożenie, Odbiór i przekazanie. Umieść dwa CTA: główne „Porozmawiajmy o projekcie” prowadzące do widoku kontaktu i dodatkowe „Zobacz przykład zastosowania” prowadzące do widoku przykładu zastosowania. Kolory wyłącznie z tokenów. Napisz test w tests/**, który sprawdza obecność i kolejność czterech etapów, trzy pary problem–rozwiązanie oraz obecność i cele obu CTA.",
    "acIds": [
      "AC-4",
      "AC-5",
      "AC-6"
    ],
    "allowedPaths": [
      "templates/**",
      "patterns/**",
      "parts/**",
      "assets/**",
      "style.css",
      "tests/**"
    ]
  },
  {
    "key": "TASK-5",
    "title": "Podstrona usługi „Asystenci wiedzy” i widok kontaktu",
    "description": "Zbuduj szablony i wzorce widoku usługi „Asystenci wiedzy” oraz widoku kontaktu, z sekcjami wymienionymi w intake dla tych widoków, wspólną nawigacją z TASK-3 i dwoma CTA. Widok kontaktu nie zawiera żadnego pola formularza wysyłającego dane ani mechanizmu rezerwacji spotkań; prezentuje demonstracyjny adres kontakt@aster-works.example oraz opis kolejnego kroku. Napisz test w tests/**, który sprawdza brak elementów formularza i mechanizmu rezerwacji na widoku kontaktu oraz obecność adresu kontakt@aster-works.example i opisu kolejnego kroku.",
    "acIds": [
      "AC-17"
    ],
    "allowedPaths": [
      "templates/**",
      "patterns/**",
      "assets/**",
      "style.css",
      "tests/**"
    ]
  },
  {
    "key": "TASK-6",
    "title": "Widok przykładu zastosowania z polami ACF i oznaczeniem demonstracyjnym",
    "description": "Zbuduj szablon i wzorce widoku przykładu zastosowania „Wiedza dla zespołu obsługi” z diagramem z TASK-2 i wspólną nawigacją. Zarejestruj w inc/** pola ACF Etap, Typ użytkownika i Zakres rozwiązania, edytowalne przez redaktora, i zaprezentuj ich wartości na widoku przykładu. Umieść na widoku wyraźną informację, że jest to scenariusz demonstracyjny na materiałach syntetycznych; nie dodawaj nazw klientów, logotypów, partnerstw, certyfikatów, opinii, statystyk ani deklaracji gwarantowanych wyników. Napisz test w tests/**, który sprawdza rejestrację i prezentację trzech pól ACF, obecność oznaczenia demonstracyjnego oraz brak treści z fikcyjnymi klientami, opiniami, statystykami i obietnicami gwarantowanych wyników.",
    "acIds": [
      "AC-8",
      "AC-18"
    ],
    "allowedPaths": [
      "templates/**",
      "patterns/**",
      "inc/**",
      "functions.php",
      "assets/**",
      "style.css",
      "tests/**"
    ]
  },
  {
    "key": "TASK-7",
    "title": "Edytowalność treści bez kodu i trwałość przy aktualizacji motywu",
    "description": "Zapewnij, że redaktor edytuje z panelu WordPress teksty, ilustracje, etykiety CTA, sekcje, pozycje menu oraz elementy nagłówka i stopki bez ingerencji w kod: sekcje czterech widoków są wzorcami wstawianymi do stron zapisanych w bazie, a nagłówek i stopka są edytowalnymi częściami szablonu; nadpisania zapisują się w danych WordPress, nie w plikach motywu. Udokumentuj w inc/** lub functions.php mechanizm powiązania stron z wzorcami, tak aby ponowne wgranie lub aktualizacja motywu nie nadpisywała treści redaktora. Napisz test w tests/**, który sprawdza, że treści czterech widoków są przechowywane w danych WordPress, a nie zahardkodowane w plikach szablonów, oraz że po symulowanej aktualizacji motywu wcześniejsze zmiany redaktora pozostają niezmienione.",
    "acIds": [
      "AC-7",
      "AC-14"
    ],
    "allowedPaths": [
      "templates/**",
      "patterns/**",
      "parts/**",
      "inc/**",
      "functions.php",
      "tests/**"
    ]
  },
  {
    "key": "TASK-8",
    "title": "Edytowalne metadane SEO i wyłączenie indeksowania środowiska Preview",
    "description": "Zintegruj w inc/** wskazane narzędzie SEO, tak aby dla każdego z czterech widoków tytuł i opis SEO były edytowalne przez redaktora, a ustawione wartości trafiały do źródła strony bez zmian w kodzie motywu. Skonfiguruj środowisko Preview tak, aby było wyłączone z indeksowania: odpowiedź serwera i znaczniki strony wskazują noindex, a plik robots środowiska Preview nie zezwala na indeksowanie; publikacja produkcyjna pozostaje osobnym etapem. Napisz test w tests/**, który sprawdza obecność edytowalnych tytułu i opisu SEO w źródle czterech widoków oraz wyłączenie indeksowania Preview w nagłówku odpowiedzi, znacznikach strony i pliku robots.",
    "acIds": [
      "AC-9",
      "AC-13"
    ],
    "allowedPaths": [
      "inc/**",
      "functions.php",
      "templates/**",
      "parts/**",
      "tests/**"
    ]
  },
  {
    "key": "TASK-9",
    "title": "Responsywność zmieniająca hierarchię treści, dostępność klawiaturowa i brak poziomego scrollowania",
    "description": "Dopracuj style responsywne w style.css i theme.json tak, aby na szerokościach mobilnych kolejność i hierarchia sekcji różniła się od desktopu zgodnie z zaakceptowanym kierunkiem, a nie była jedynie pomniejszoną wersją desktopu. Zapewnij obsługę klawiaturą nawigacji, CTA i pozostałych elementów interaktywnych z widocznym wskaźnikiem focusu w każdym kroku oraz brak poziomego paska przewijania na obsługiwanych szerokościach desktop i mobile. Napisz test w tests/**, który przechodzi przez menu i CTA wyłącznie klawiaturą sprawdzając widoczny focus, weryfikuje brak poziomego scrollowania na szerokości desktopowej i mobilnej oraz potwierdza zmianę kolejności lub hierarchii sekcji na mobile.",
    "acIds": [
      "AC-11",
      "AC-12"
    ],
    "allowedPaths": [
      "style.css",
      "theme.json",
      "templates/**",
      "patterns/**",
      "parts/**",
      "tests/**"
    ]
  }
]

/**
 * The structured intake of the walkthrough, restated from the brief in `exampleProject`. The stored one is encrypted
 * per tenant — a brief holds client material — so the example ships readable content instead of a ciphertext that
 * would be meaningless anywhere but the machine it came from.
 */
export const EXAMPLE_INTAKE_BRIEF = {
  businessGoal: 'Pozyskiwanie zapytań od klientów zainteresowanych wdrożeniem AI. Ścieżka: problem → rozwiązanie → przykład zastosowania → sposób współpracy → kontakt. Główne CTA: „Porozmawiajmy o projekcie”, drugie: „Zobacz przykład zastosowania”.',
  audience: 'B2B: dyrektor operacyjny (usprawnienie procesu, mniej powtarzalnej pracy), Product Lead (AI jako funkcja produktu), CTO (partner, który zaprojektuje, wdroży i zweryfikuje rozwiązanie oraz określi wymagania wobec danych).',
  problem: 'Komunikacja nie ma być budowana wokół modeli ani frameworków. Punktem wyjścia jest problem klienta i dostarczana wartość.',
  content: 'Cztery widoki: strona główna, podstrona usługi „Asystenci wiedzy”, przykład zastosowania „Wiedza dla zespołu obsługi” oznaczony jako demonstracyjny, oraz kontakt bez działającego formularza.',
  features: [
    'Menu: Rozwiązania, Przykład zastosowania, Jak pracujemy, Kontakt — bez mega menu',
    'Odnośniki do sekcji strony głównej działające także z podstron',
    'Proces współpracy w czterech etapach: rozpoznanie zadania, projekt rozwiązania, wdrożenie, odbiór i przekazanie',
    'Edycja treści, ilustracji, CTA, sekcji, menu, nagłówka i stopki bez kodu',
    'Metadane przykładu zastosowania przez ACF: etap, typ użytkownika, zakres rozwiązania',
    'Edytowalny tytuł i opis SEO każdego widoku',
  ],
  integrations: ['WordPress jako CMS', 'Figma jako źródło projektu UX i UI', 'ACF dla metadanych przykładu zastosowania'],
  constraints: [
    'Tylko język polski, bez przełącznika języka',
    'Paleta wdrożona przez tokeny design systemu: granat #082C55, niebieski #0757B8, cyjan #12B8DB',
    'Fonty hostowane lokalnie, na licencji dopuszczającej taki hosting',
    'Treści muszą przetrwać aktualizację motywu',
    'Preview wyłączone z indeksowania; publikacja produkcyjna to osobny etap z akceptacją',
    'Bez stockowych robotów, ścian logotypów i wideo w tle',
    'Bez fikcyjnych klientów, opinii, statystyk i gwarantowanych wyników',
  ],
  inspirations: [],
  materials: [],
  unknowns: [
    'Kto dostarcza autorską ilustrację hero i diagram przykładu zastosowania?',
    'Która rodzina fontów zostaje wybrana i czy licencja dopuszcza hosting lokalny?',
  ],
} as const

export const EXAMPLE_INTAKE_QUESTIONS: readonly never[] = []
