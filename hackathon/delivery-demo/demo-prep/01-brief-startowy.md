# Brief startowy — Aster Works

Fikcyjna firma i demonstracyjne zlecenie. Wklej poniższą sekcję do kreatora briefu.
Nie jest to zaakceptowany Scope: agent ma doprecyzować kryteria i poprosić o decyzję.

## Brief do wklejenia

Jesteśmy Aster Works, fikcyjną firmą usługową pomagającą przedsiębiorstwom wdrażać
rozwiązania AI. Potrzebujemy polskiej strony, która wyjaśni, jakie problemy rozwiązujemy,
pokaże sposób współpracy i zachęci do rozmowy o konkretnym projekcie.

Naszymi odbiorcami są dyrektor operacyjny, lider produktu i CTO. Pierwsza osoba szuka
usprawnienia procesu, druga nowej funkcji produktu, trzecia partnera technicznego.
Strona powinna prowadzić od problemu biznesowego do odpowiedniej usługi, przykładu
zastosowania i kontaktu. Nie zaczynajmy od katalogu modeli i technologii.

Potrzebujemy czterech widoków:

1. Strona główna: jasna obietnica i dwa CTA, trzy problemy klientów, odpowiadające
   im usługi, jeden wyróżniony przykład zastosowania, proces współpracy i kontakt.
2. Usługa „Asystenci wiedzy”: dla kogo, jaki problem, co dostarczamy, jak pracujemy,
   jakie dane i udział klienta są potrzebne, powiązany przykład i CTA.
3. Przykład zastosowania „Wiedza dla zespołu obsługi”: kontekst, wyzwanie,
   proponowane rozwiązanie, zakres oraz sposób przyszłego pomiaru skuteczności.
   To jawnie oznaczony scenariusz demonstracyjny, nie rzeczywisty case study.
4. Kontakt: jak przygotować rozmowę, informacyjny adres kontaktowy oraz zakres
   pierwszego spotkania. Bez formularza wysyłającego dane i bez kalendarza rezerwacji.

Pozostałe dwie usługi — „Automatyzacja pracy” i „Ocena jakości AI” — opisujemy
w sekcjach strony głównej. Każdy ich link prowadzi do istniejącej sekcji lub Kontaktu,
nie do pustej podstrony. Menu: Rozwiązania, Przykład zastosowania, Jak pracujemy,
Kontakt. Linki sekcyjne muszą działać również z podstron.

Główne CTA: „Porozmawiajmy o projekcie”. Drugie: „Zobacz przykład zastosowania”.
Najpierw chcemy pokazać wartość i sposób pracy, potem szczegóły techniczne.
Treści mają być konkretne i zrozumiałe, bez obietnic gwarantowanych oszczędności.
Nie mamy prawdziwych referencji: nie dodawaj logotypów klientów, partnerstw,
certyfikatów, opinii ani liczb udających nasze osiągnięcia.

Projekt ma wyglądać jak dopracowany serwis firmy technologicznej B2B: wyraźna
hierarchia, duża typografia, konsekwentna siatka, dużo przestrzeni i mocny autorski
motyw graficzny. Proponujemy jasne tło, atramentowy tekst i akcent miedziany.
Hero może mieć ilustrację przepływu dokumentów przez uporządkowany proces.
Nie używaj stockowych robotów, ściany logotypów ani ciężkiego wideo. Responsywność
ma obejmować hierarchię treści i nawigację, a nie tylko pomniejszenie desktopu.

Chcemy osobno zaakceptować zakres, UX, kierunek wizualny i pakiet UI/design system.
Wybieramy WordPress, a projekt tworzymy w Figmie. Po odbiorze redaktor ma zmieniać
teksty, ilustracje, CTA, sekcje, menu, nagłówek i stopkę bez kodu. Metadane scenariusza
(np. „Etap: projekt demonstracyjny”) mają być edytowalne przez ACF, a tytuł i opis SEO
przez narzędzie SEO. Aktualizacja motywu musi zachować te zmiany.

Jeden język: polski. Bez bloga, logowania klientów, płatności, tłumaczeń i integracji
CRM. Wersja demo pozostaje nieindeksowana. Publikujemy tylko zatwierdzoną lokalnie
zbudowaną wersję na zaakceptowanym Preview; publikacja wymaga osobnej decyzji.

## Materiały wejściowe — przygotować dziś

| Element | Gotowa propozycja / zadanie |
|---|---|
| H1 | AI, które znajduje miejsce w codziennej pracy. |
| Lead | Projektujemy asystentów wiedzy, automatyzujemy zadania i sprawdzamy jakość rozwiązań przed wdrożeniem. |
| Problem1 | Zespół szuka odpowiedzi w rozproszonych dokumentach → Asystenci wiedzy |
| Problem2 | Praca wymaga powtarzania tych samych kroków w kilku narzędziach → Automatyzacja pracy |
| Problem3 | Prototyp działa, ale brakuje kryteriów odbioru → Ocena jakości AI |
| Proces | Rozpoznanie zadania → projekt rozwiązania → wdrożenie → odbiór i przekazanie |
| Przykład | Wiedza dla zespołu obsługi; materiały syntetyczne; żadnych danych klienta |
| Metadane ACF | Etap, typ użytkownika, zakres rozwiązania |
| Kontakt | kontakt@aster-works.example — adres demonstracyjny, bez wysyłki |
| Grafiki | Autorska ilustracja hero + diagram zastosowania; SVG lub zoptymalizowane pliki |
| Fonty | Dostępne lokalnie z prawem użycia; zachować pliki i licencję |

To samodzielna identyfikacja. Do materiałów, promptów wykonawczych i slajdów nie
wprowadzać nazw, screenów, tekstów ani zasobów innych firm jako części marki demo.

## Ścieżki UX do uzgodnienia

- COO: problem na stronie głównej → rozwiązanie → przebieg współpracy → Kontakt.
- CTO: usługa → zakres i wymagania danych → przykład → Kontakt.
- Powracający odbiorca: menu → konkretny przykład → CTA, bez ponownego czytania home.

Każdy ekran odpowiada na jedno następne pytanie użytkownika. Nie rozbudowywać demo
o wielopoziomowe mega menu, kilkanaście branż lub dział publikacji bez treści.

## Propozycja kryteriów do rzeczywistego Scope

To biznesowe AC, nie gotowe identyfikatory testów w OSS. Powiązanie AC→test i baseline
powstaje w aplikacji; nie zaliczamy kryteriów przez sam zapis tej tabeli.

| ID | Odbiór |
|---|---|
| DEMO-AC01 | Cztery widoki, działające menu i oba CTA, brak pustych linków; desktop i mobile |
| DEMO-AC02 | Zgodność z zaakceptowanym UI; czytelna hierarchia, focus klawiatury, brak poziomego scrolla |
| DEMO-AC03 | Zapis i readback tekstów/obrazu/CTA/sekcji/menu/header/footer przez redaktora |
| DEMO-AC04 | Edycja pola ACF „Etap” i opisu SEO bez kodu |
| DEMO-AC05 | Zmiana motywu i lokalny rebuild zachowują treści, ACF oraz Global Styles |
| DEMO-AC06 | changes_requested → nowa próba/rewizja → świeże checks → review → verified |
| DEMO-AC07 | Osobna zgoda na target/revision, gotowy lokalny deployment i odczytowy odbiór Preview/noindex |

## Kontrolowana poprawka w pokazie

Feedback: „Zmień główne CTA na «Omówmy Twój proces». Cel linku pozostaje bez zmian.”
Użyć rzeczywistego komentarza i aktualizacji, nie celowo uszkodzonego kodu. Jeśli zmiana
unieważnia zgodę UI, uzyskać ją ponownie zgodnie z procesem.

Wcześniej redaktor zmienia ACF „Etap” na „Gotowe do rozmowy”. Po poprawce motywu
potwierdzić, że ta wartość pozostała. To mały, czytelny dowód zachowania treści.
