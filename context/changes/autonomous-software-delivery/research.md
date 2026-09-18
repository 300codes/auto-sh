---
date: 2026-09-18
topic: "Uzupełnienie analizy: zakres hackathonu i ponowne użycie WordPressa"
status: complete
---

# Ustalenia do zoptymalizowanego planu wdrożenia

## Źródła wejściowe

- [Specyfikacja koncepcyjna](../../../hackathon/open-mercato-autonomous-software-delivery-spec.md).
- [Analiza ryzyk](../../../hackathon/analiza-ryzyk-autonomous-software-delivery.md).
- Repozytorium lokalne `/var/www/html/ai-tools/ai-wordpress-orchestrator`, odczyt dokumentacji i kodu bez uruchamiania agentów, publikacji i odczytu sekretów.

## Decyzje użytkownika

| Obszar | Ustalenie |
|---|---|
| Zasoby | Czterech doświadczonych developerów, 36 godzin kalendarzowych. 144 osobogodziny to maksimum nominalne, nie gwarantowany czas produktywny. |
| Wejścia | FROM_BRIEF oraz FROM_DESIGN; drugie importuje zatwierdzone ekrany i ręcznie opisane wymagania. |
| Granica produktów | Domena i planowanie w OSS; wykonanie agentów w enterprise. OSS ma być użyteczne bez enterprise. |
| Cezar | Wykorzystanie bez rozwijania Cezara. Adapter po stronie OM; przy nieudanej próbie dopuszczone jawne ręczne przekazanie zadania i import wyniku. |
| Design | Agent tworzy design w Figmie podczas demo; człowiek zatwierdza. Ręczne narysowanie gotowego designu nie realizuje tego wymagania. |
| Platformy | React end-to-end; OM i WordPress jako PoC. Istniejący WordPress może rozszerzyć demonstrację przez reuse, bez zobowiązania do drugiego nowego E2E. |
| Wydanie | Preview/staging, raport dowodów, akceptacja człowieka. Kontynuacja bez terminu. |
| Finansowanie AI | Posiadane subskrypcje; brak uzgodnionego dodatkowego budżetu API. Extra Credits są dostępne opcjonalnie, nie stanowią zgody na automatyczne wydatki. |
| Konta | Według użytkownika: Codex Pro x20, 4 Codex Business, Claude Max x20, 4 Claude Pro z opcją Extra Credits. Nazewnictwo i faktyczne limity należy potwierdzić na stanowiskach; mnożników nie interpretować jako liczby kont. |
| Figma | Starter; możliwy Professional, jeśli potrzebny do wykonania. |

## Korekty względem wcześniejszej analizy

### Cezar: sprawdzić istniejący CLI przed budową dispatchu

Oficjalne README dokumentuje headless `npx cezar-cli run "task"`, konfigurację workflow i korzystanie z zalogowanych CLI. To uzasadnia próbę cienkiego adaptera nad istniejącym narzędziem. Nie dowodzi jeszcze zgodności z wersją zainstalowaną przez zespół, strukturalnego kontraktu wyniku ani automatycznego odbioru.

Źródło: [Cezar README](https://github.com/open-mercato/cezar), sprawdzone 2026-09-18.

Pełny pull dispatch nie mieści się w samej fazie 1 istniejącej specyfikacji. Jej fazy 1–4 obejmują zadania, routing, adapter wewnętrzny oraz pull/lease/heartbeat/result. Nie włączać całej roadmapy dispatchu do hackathonu pod nazwą „integracja Cezara”.

Źródło lokalne: `.ai/specs/enterprise/agent-orchestrator/next/2026-06-19-agent-dispatch.md:295`.

Weryfikacja kodu orchestratora wykazała istniejący endpoint OAuth client credentials (`api/identity/token/route.ts:43`) i serwis weryfikacji tokenów. Nowe endpointy workera nadal wymagałyby podłączenia uwierzytelniania, scope i izolacji. Nie planować ponownej budowy serwera tokenów na podstawie historycznego draftu dispatchu.

### Figma: zapis przez oficjalny MCP jest dostępny

Oficjalna dokumentacja opisuje `use_figma`, tworzenie natywnych elementów przez Plugin API i obsługę Codex oraz Claude Code. Wymaga Full seat i uprawnień edycji pliku. Dostępność narzędzia w tej sesji nie dowodzi jego dostępności w CLI uruchomionym przez Cezara.

- [Write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/).
- [Rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/).

Wniosek projektowy: przewidzieć stanowisko designera z obsługiwanym klientem, zdalnym MCP i Full seat; w pierwszym timeboxie sprawdzić utworzenie ekranu oraz pobranie dowodu. Nie budować własnego edytora Figmy ani nie zakładać, że zakup Professional sam rozwiązuje konfigurację klienta i uprawnień. Nie wykonano zakupu ani zapisu w Figmie podczas tego researchu.

## WordPress: historyczne aktywa — superseded jako integracja runtime

Ścieżki w tej sekcji są względne wobec `/var/www/html/ai-tools/ai-wordpress-orchestrator`.

| Aktywo | Dowód | Zastosowanie i granica |
|---|---|---|
| Start wykonania | `src/server/app.js:167`; `docs/orchestration-evidence.md:60` | `POST /api/projects/:id/runs` z `Idempotency-Key`. Zachować identyfikator zewnętrznego runa; nie powtarzać startu po samym timeoutcie. |
| Raport wykonania | `src/server/app.js:169`; `docs/orchestration-evidence.md:5` | `GET /api/runs/:id/report`. Oddzielić deklarację agenta od faktycznie wykonanych host checks; Partial nie mapuje się na PASS. |
| Import ekranów Figmy | `src/server/app.js:136`; `src/server/modules/figma/service.js:156,218` | Claude CLI + MCP read tools, metadane i render. Wzorzec do wykorzystania, nie gotowa implementacja generowania designu. |
| Izolacja i Apply | `docs/orchestration-evidence.md:91,138` | Kolejka, kopie Studio, apply/rollback/reconcile. Zachować w narzędziu WP; nie przenosić jego SQLite ani drugiego silnika lifecycle do OM. |
| Preview | `src/server/app.js:216–219`; `docs/studio-preview.md` | Start/update/verify i istniejące powiązanie witryny z hostem. Upload oraz wynik weryfikacji to osobne fakty. |
| Historyczne E2E | `docs/studio-preview.md:99,128–131` | Opis udanej publikacji i aktualizacji tego samego hosta 2026-09-08. Termin ważności 2026-09-15: nie jest to bieżący dowód dostępności. |
| Testy lokalne | `package.json`; `docs/orchestration-evidence.md` | Istnieją lint/unit/orchestration i testy preview. Testy z atrapami nie dowodzą działającej inferencji, Studio ani aktualnego publicznego URL. |

**Historyczna propozycja, superseded decyzją użytkownika 2026-09-19; nie wykonywać:** przygotowane stanowisko WordPress i jawny import wybranego raportu oraz referencji preview do OM. Automatyczne pobranie przez lokalny adapter tylko po sprawdzeniu istniejącego mechanizmu sesji. API narzędzia jest lokalne i prywatne; nie wystawiać go publicznie ani kopiować mechanizmu sesji do aplikacji wielotenantowej. OM przechowuje identyfikatory i zweryfikowane dowody, a wykonanie WP pozostaje w istniejącym narzędziu.

Nie kopiować wprost downloadera obrazów do backendu OM: zewnętrzne adresy z wyniku modelu wymagają ograniczeń SSRF, redirectów, rozmiaru i typu danych. Przy ręcznym imporcie walidować pliki i ich powiązanie z projektem/baseline tak samo jak przy automatycznym.

## Aktualizacja WP — 2026-09-19

Obowiązuje [plan narzędzi Studio](../wordpress-studio-tools/plan.md): własny pakiet Studio CLI i nowa witryna, bez starego runtime/API/DB/kolejki/projektów. Przenośne referencje: `workspaces/studioAdapter.js`, `preview/studioCli.js`, `workspaces/snapshots.js`, scaffold w `wordpress/studio.js` i `git/service.js`; `workspaces/service.js` jest sprzężony z dawną DB i lifecycle. Nie przenosimy go jako gotowego silnika. Szczegółowe ustalenia i ograniczenia są w [nowym researchu](../wordpress-studio-tools/research.md).

Budżet wszystkich prac WP wynosi 6 h, bez gwarancji ukończenia całego PoC. Niezależny pakiet i smoke bez wywołań starego serwera można wykonać wcześniej; powiązanie z task/attempt/baseline i wykonaniem OSS/enterprise wymaga ich gotowych kontraktów. Fixture oraz smoke nie zaliczają integracji ani Progress.

## Kolejność zatwierdzona przez użytkownika

1. H0–H3: równoległe próby Cezar headless, Figma write/read, uruchomienie OM i readiness własnych narzędzi Studio; decyzja o automatycznym lub ręcznym transferze Cezara.
2. H3–H10: minimalny model OSS, wspólny pakiet wejścia/wyniku, szkielety UI i granica enterprise. Cztery osoby mają rozłączne obszary odpowiedzialności.
3. H6–H16: oba wejścia, agentowy design i zamrożony baseline z decyzją człowieka.
4. H8–H24: React end-to-end przez Cezara, obiektywne walidacje, niezależne review i jedna pętla poprawki.
5. H20–H28: raport dowodów, preview, PoC OM i własne narzędzia WordPress; zależny PoC po podłączeniu OSS/enterprise. Rozszerzenie WP tylko w wyznaczonym timeboxie.
6. H28–H36: zamrożenie funkcji, testy obu wejść, próba demo, bufor i akceptacja.

Okna zachodzą na siebie między różnymi właścicielami. Szczegółowy plan musi rozliczyć osobogodziny oraz zostawić bufor; nie zakładać czterech pełnych 36-godzinnych zmian bez odpoczynku.

## Granice weryfikacji

Badanie było odczytem kodu, dokumentacji i aktualnych źródeł producentów. Nie uruchamiano Cezara ani agentów płatnych, nie testowano aktualnego loginu Figma/Studio, nie tworzono preview, nie zmieniano zewnętrznego projektu WordPress. Te próby są mierzalnym rezultatem pierwszego etapu wdrożenia, nie wykonanym wynikiem researchu.
