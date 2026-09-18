# UI-01 — polecenia sekwencji `create` → `read` → `update` → `read`

Polecenia wydaje **człowiek w języku naturalnym**; rysuje agent. Treść jest zapisana, żeby
[UI-03](../../../../context/changes/autonomous-software-delivery/workstreams/03-design-ui.md) mogło powtórzyć tę samą sekwencję,
a nie wymyślać ją pod presją własnego okna.

Scenariusz referencyjny pochodzi z Fazy 1 planu głównego (`plan.md:204`): mały katalog usług,
lista z filtrem i formularz zgłoszenia z walidacją oraz potwierdzeniem.

Ekran wybrany na próbę: **lista usług z filtrem** — ma dość elementów, żeby poprawka była wizualnie
odróżnialna, i jest mniejsza od formularza, co mieści się w timeboksie.

## Krok 1 — `create`

> W pliku `<adres pliku próby UI-01>` utwórz frame desktop 1440×1024 o nazwie `UI-01 / Lista usług`.
> Ma zawierać: nagłówek strony z tytułem „Katalog usług", pasek filtrów z polem wyszukiwania i dwoma
> selektami (kategoria, dostępność), oraz siatkę sześciu kart usługi — każda z miniaturą, nazwą,
> jednozdaniowym opisem, ceną i przyciskiem „Zgłoś". Użyj natywnych elementów Figmy (frame'y, auto
> layout, tekst, prostokąty) — nie wklejaj obrazu ani nie generuj bitmapy.
> Zwróć `nodeId` utworzonego frame'a.

**Oczekiwany wynik:** `nodeId` frame'a. Zapisać go — krok `update` musi dotyczyć **tego samego** węzła.

## Krok 2 — `read`

> Odczytaj węzeł `<nodeId>` i zwróć jego render jako obraz.

**Bezpośrednio po odpowiedzi**, w tym samym kroku, nie po zakończeniu całej sekwencji:

```bash
./capture.sh create <nodeId> "<adres renderu>" prompts.md
```

Adres renderu zwrócony przez Figmę wygasa — pobranie, hash i wpis do manifestu muszą nastąpić od razu.

## Krok 3 — `update`

> W tym samym frame'ie `<nodeId>` zmień stan pustej listy: dodaj nad siatką kart pasek informacyjny
> „Znaleziono 6 z 24 usług" z linkiem „Wyczyść filtry", a pierwszej karcie w siatce nadaj wyróżnienie
> „Polecane" — plakietkę w prawym górnym rogu karty. Nie twórz nowego frame'a; zmodyfikuj istniejący.

**Oczekiwany wynik:** potwierdzenie zmiany z tym samym `nodeId`. Utworzenie drugiego frame'a obok
pierwszego **nie** dowodzi zdolności edycji i nie zalicza kroku.

## Krok 4 — `read`

> Odczytaj ponownie węzeł `<nodeId>` i zwróć render po zmianie.

```bash
./capture.sh update <nodeId> "<adres renderu>" prompts.md
```

Render po zmianie ma być wizualnie odróżnialny od poprzedniego, a jego sha256 — różny.

## Domknięcie

```bash
./verify.sh
```

Skrypt sprawdza dokładnie te kontrole, które wymieniają kryteria Fazy 2 i 3 planu UI-01:
zgodność `SHA256SUMS`, typ i rozmiar renderów, identyczny `nodeId` w `create` i `update`,
różnicę hashy oraz brak sekretów w katalogu dowodów.
