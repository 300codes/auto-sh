# F0 — paczki WordPress i wybór edycji

Decyzja użytkownika z 2026-09-19: ACF Pro z lokalnej paczki
`hackathon/advanced-custom-fields-pro.zip`; Polylang **Free** z repozytorium WordPressa.
Nie zastępować Polylang Free wersją Pro i nie kupować licencji. Wybór darmowej edycji
nie zalicza automatycznie współpracy wszystkich pól ACF ani edycji szablonów.

| Wtyczka | Wersja | Minimalny WP / PHP z nagłówka paczki | Dostęp |
|---|---|---|---|
| ACF Pro | 6.8.9 | WP 6.2 / PHP 7.4 | Paczka użytkownika sprawdzona, aktywacja licencji niezweryfikowana |
| Polylang Free | 3.8.9 | WP 6.5 / PHP 7.4 | Pobrany oficjalny ZIP do `hackathon/polylang.zip` |
| Yoast SEO | 28.5 | WP 6.9 / PHP 7.4 | Oficjalna paczka; aktywacja lokalna potwierdzona w F0 |

[Manifest paczek, integralność i SHA-256](evidence/phase-6/plugin-packages.json).
Oba ZIP są wykluczone z Git; nie zapisujemy płatnego kodu ani kluczy w dowodach.
Pobranie i kontrola archiwum nie są instalacją ani dowodem zgodności runtime.
Minimalne wersje z nagłówków nie stanowią rekomendacji wersji docelowego środowiska.

## Aktualny zakres demo

Użytkownik odroczył tłumaczenia poza demo. Polylang Free pozostaje wybraną wtyczką;
nie dodajemy Loco ani Weglot. Próby dwóch języków i integracji ACF–Polylang nie blokują
demo. Następny probe obejmuje instalację wtyczek, edycję jednego języka i zachowanie
wartości ACF/treści/Global Styles po redeploy. Brak tłumaczeń ma status deferred_by_user,
nie failed ani passed.

## Wpływ na WP-03…05 — badanie dla etapu po demo

Oficjalna [integracja ACF Pro](https://polylang.pro/documentation/support/guides/working-with-acf-pro/)
jest opisana jako funkcja Polylang Pro. Nie przypisujemy jej do Free.
Dla wybranej darmowej edycji trzeba zweryfikować model osobnych tłumaczeń stron
z niezależnymi wartościami pól ACF. Automatyczne kopiowanie/synchronizowanie złożonych
pól, relacji oraz zachowanie nawigacji/header/footer wymagają konkretnych testów.
Nie oznaczamy ich jako działające na podstawie samego aktywowania wtyczek.

Probe po demo: na świeżej, własnej witrynie sprawdzić dwa języki, edycję treści
i pól ACF przez redaktora, relacje/media i niezależność wartości, nawigację oraz
zachowanie zmian po ponownym deploy. Jeśli któryś wymagany element nie działa,
raport ma wskazać konkretną lukę; rozwiązanie musi respektować darmowy Polylang.
W demo zachowujemy jednojęzyczne WP-04 i część redeploy WP-05; nie zmieniamy page buildera.

Źródło Polylang: [oficjalna karta wtyczki](https://wordpress.org/plugins/polylang/).
Target publikacji pozostaje Studio Preview; nie wykonano w tej sesji instalacji,
startu witryny ani uploadu. Kontrakt createSite v1 pozostał bez zmian.

## Sprawdzenie Loco Translate na prośbę użytkownika

Loco Translate edytuje tłumaczenia statycznych napisów motywów/wtyczek (PO/MO/JSON).
Według [dokumentacji autora](https://localise.biz/wordpress/plugin/intro) nie tłumaczy
dynamicznych treści z bazy ani nie zarządza przełączaniem języka. Nie zastępuje więc
Polylang ani integracji tłumaczenia wartości pól ACF wymaganej przez WP-04/05.
Może być opcjonalnym narzędziem do napisów interfejsu; nie dodano go do zależności.

Doprecyzowanie: płatna jest oficjalna rozbudowana integracja Polylang–ACF Pro.
Nie jest to dowód, że osobna ręczna edycja pól ACF na stronach powiązanych jako
PL/EN jest niemożliwa w Free. Ten wariant nadal wymaga rzeczywistego probe;
nie zaliczono synchronizacji relacji, repeaterów, options ani bloków.

## Aktualizacja live F0

[Dowody aktualnej lokalnej próby](../wordpress-demo-foundation/evidence/README.md):
WordPress 7.1.1 / PHP 8.4.23; ACF Pro 6.8.9, Polylang Free 3.8.9 i Yoast SEO 28.5 aktywne.
Powtórne przygotowanie bez reinstalacji i resetu; noindex, zwykła treść i post meta
zachowane, własny draft usunięty, snapshot/HTTP PASS, witryna zatrzymana. To częściowy
WP-03, nie dowód konfiguracji wszystkich wtyczek, pól ACF, redaktora ani redeploy.
Historyczny akapit o braku instalacji opisuje stan sprzed tej próby. Build i deployment
Preview nadal pozostają osobne; przygotowanie w całości lokalne.
