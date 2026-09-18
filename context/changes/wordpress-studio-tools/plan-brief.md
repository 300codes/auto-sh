# Własne narzędzia Studio — skrót planu

[Plan](plan.md) · [Badanie](research.md)

OM otrzyma samodzielny pakiet `@open-mercato/delivery-wordpress`, który bezpośrednio
korzysta ze Studio CLI. Lokalny scenariusz wywołujący ten sam publiczny interfejs
utworzy całkowicie nową witrynę i motyw. Stary orchestrator nie jest zależnością.

| Decyzja | Wybór | Źródło |
|---|---|---|
| Projekt | Nowa witryna, bez adopcji starych projektów | Użytkownik |
| Wykonanie | Własne narzędzia Studio, bez starego API/DB/kolejki | Użytkownik |
| Zakres nocy | Wszystko niezależne od pracy innych osób, max 6 h łącznie | Użytkownik |
| Integracja OM | Gotowy interfejs i realny lokalny caller; podłączenie domeny później | Stan repo |
| Dowody | Faktyczne wyniki narzędzi, snapshot plików i danych, osobne fixture | Plan główny |
| Publikacja | Lokalna witryna; publiczny upload jest odrębnym zakresem | Plan główny |

Etapy: (1) kontrakt, bezpieczeństwo i subprocess; (2) nowa witryna, motyw,
snapshot i testy; (3) rzeczywiste wykonanie, dokumentacja i przekazanie.

Pakiet nie buduje nowej kolejki ani nie zastępuje WorkflowInstance. Dziennik
lokalnej operacji chroni wyłącznie przed ponownym create po timeout/crash.
Wywołania mają scope dostarczony przez zaufanego hosta, walidowane argumenty,
własność katalogów oraz stały zestaw poleceń bez dowolnego shella.

Próba lokalna nie oznacza działającego OM→WP E2E: moduły delivery jeszcze nie
istnieją. Dostarczone API, testy, manifest i instrukcja integracji pozwolą je podłączyć.
Sukces oznacza własną nową witrynę z aktywnym motywem, rzeczywistymi hashami
i powtarzalną weryfikacją; brak narzędzia lub niepewny efekt pozostaje blockerem.
