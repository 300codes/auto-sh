# Drzewo kolejności zadań — H0–H36

[Harmonogram i podział pracy](README.md) · [Plan główny](../plan.md)

Czytaj od góry do dołu. Gałęzie pod `RÓWNOLEGLE` można prowadzić jednocześnie przez różne osoby. `POŁĄCZENIE` wymaga wszystkich wymienionych rezultatów. Oznaczenia G0–G8 łączą drzewa: kolejne drzewo zaczyna się od wskazanego punktu poprzedniego. Godziny są planowanymi oknami; zadanie startuje po spełnieniu zależności, nie tylko po nadejściu godziny.

Zadanie może wystąpić kilka razy z dopiskiem „przygotowanie”, „live” lub „odbiór” — to części tego samego zadania, a nie dodatkowy zakres. Osoby przypisujecie sami; `WP-ACCESS` zawsze oznacza **Michał — wymagany dostęp do ai-wordpress-orchestrator**.

## 1. Start i przygotowanie równoległej pracy

```text
START H0 — cztery osoby, uzgodniona obsada i dostępy
└── RÓWNOLEGLE
    ├── OSS-01 [H0–2] Host OM, repo React, build/test i pomiar gate
    │   └── Gotowe środowisko i target preview ──────────────────┐
    ├── EXEC-01 [H0–3] Cezar CLI, async/Redis, współbieżność      │
    │   └── Decyzja automatic / manual_handoff ─────────────────┤
    ├── UI-01 [H0–3] Agent tworzy frame w Figmie + read/render   │
    │   └── Potwierdzony zapis Figmy na stanowisku demo ────────┤
    └── WP-M01 [H0–2] MICHAŁ / WP-ACCESS                        │
        ├── Readiness WordPressa i bezpieczny fixture raportu  │
        └── Wynik do G0; fixture do gałęzi WP w drzewie 4       │
                                                              ▼
G0 [H3] POŁĄCZENIE: gotowość OM/CLI/Figmy + stan WP + nowa estymata
├── Brak Figma write → blocker FROM_BRIEF; usunąć przed jego odbiorem
├── Brak automatycznego Cezara → jawny manual_handoff
├── Brak gotowości WP → osobny blocker WP; React może iść dalej
└── Start fundamentu
    └── RÓWNOLEGLE
        ├── OSS-02 [od H3] Domena i kontrakty
        │   └── G1 [H4] Robocze DTO/API + fixture + reguły błędów
        │       └── Kontynuacja OSS-02 [do H9]
        │           └── Realne CRUD, ręczny baseline/approval,
        │               rezerwacja próby i legalny eksport OSS-only
        └── EXEC-02 [H3–4] Szkielet pakietu i modułu
            └── Na kontrakty adaptera czeka do G1
```

G0 zbiera wyniki prób, nie zamienia niepowodzenia WP w blokadę całego fundamentu. Dla automatycznych dwóch runów wymagane są async/Redis i efektywna współbieżność. Tryb ręczny musi osobno udowodnić nakładanie dwóch rzeczywistych runów.

## 2. Po DTO: domena, UI, wykonanie i testy

```text
G1 [H4] DTO i fixture gotowe
└── RÓWNOLEGLE — praca na wspólnym kontrakcie
    ├── OSS-02 [do H9] Dokończenie realnej domeny
    │   └── Po odbiorze G2: OSS-03 [H10–14]
    │       └── Baseline/proposal/decision API dla obu wejść ─────┐
    ├── EXEC-02 [do H7] Adapter i rozszerzenie enterprise        │
    │   └── EXEC-04 — przygotowanie [H8–14]                     │
    │       └── Bridge/recovery na fake executorze              │
    │           └── Gotowość do live w G4, bez startu Reacta    │
    ├── UI-02 [H4–6] Szkielet ekranów + InjectionSpot           │
    │   └── UI-03 — przygotowanie [H6–10, H12–14]               │
    │       ├── Agentowe wymagania, design i poprawka Figmy     │
    │       └── UI obu wejść na fixture ───────────────────────┤
    └── QA-02 [H4–6] Harness i testy kontraktów                  │
        ├── Testy w zmianach OSS/EXEC, smoke przed G2           │
        └── QA-04 — przygotowanie [H8–10]                      │
            └── Harness AC i negatywny fixture                 │
                └── Właściwe testy live dopiero w drzewie 3    │
                                                               │
G2 [H9–H10] POŁĄCZENIE: OSS-02 + EXEC-02 + UI-02 + testy QA-02  │
└── Realny OSS-only/export, injection i zamrożone DTO v1         │
    └── Odblokowuje OSS-03 i podłączenie UI do rzeczywistych API │
                                                               ▼
G3 [H14] POŁĄCZENIE: baseline API OSS-03 + przygotowany UI-03
└── QA-03 [H14–16]
    ├── H14–15: weryfikacja backendu i negatywnych przypadków
    └── Po podłączeniu UI-03 [H14–15]: odbiór obu wejść
        └── Człowiek zatwierdza requirements, design i scalony baseline
            └── G4 [H16] Zatwierdzone AC→testy, zadania i allowedPaths
```

G2 nie blokuje wcześniejszego przygotowania UI, bridge ani testów na fixture. G4 jest wymagane przed implementacją aplikacji; zatwierdzony design nie zastępuje zatwierdzenia scalonego baseline i planu zadań.

## 3. Główna gałąź React: wykonanie → poprawka → finalne dowody

```text
G4 [H16] Baseline zatwierdzony + bridge EXEC-04 gotowy na fixture
└── RÓWNOLEGLE — przygotowanie przed live
    ├── OSS-04 [H16–17] Realne claim/import/evidence/pending
    ├── EXEC-04 [H16–17] Host wykonania i pakiety
    └── UI-04 [H16–17] UI wykonania/manual flow na fixture
        └── G5 [około H17] POŁĄCZENIE trzech rezultatów
            └── EXEC-04: jedna kompletna próba task→result→evidence
                └── RÓWNOLEGLE — dwa niezależne runy Cezara
                    ├── OSS-04: task React listy i filtrowania
                    │   └── Osobny worktree, wynik i host checks ──┐
                    └── UI-04: task React formularza               │
                        └── Osobny worktree, wynik i host checks ──┤
                                                                  ▼
POŁĄCZENIE wyników + QA-04 live [H19–22]
└── Niezależny review i konkretny finding
    └── Agent poprawia kod → nowa rewizja → ponowne kontrole
        └── OSS-04 [H20–22]: merge wyników, docelowo commit H21
            └── QA-04: pełne testy AC i skany FINALNEGO commitu
                ├── FAIL / missing / not_run → naprawa i ponowny test
                └── G6 [docelowo H22; bramka H24]: poprawka + dowody
                    └── RÓWNOLEGLE [H24–26]
                        ├── OSS-05: report API i decyzje ──────────┐
                        └── UI-05: raport, dowody i zgody ─────────┤
                                                                  ▼
POŁĄCZENIE: G6 + OSS-05 + UI-05
└── Człowiek zatwierdza publikację konkretnej rewizji
    └── QA-05 [H26–27]: publikacja React preview
        └── Weryfikacja URL + build ID/commit + desktop/mobile
            └── Deployment evidence → osobna zgoda release
                └── G7 [do H28]: preview i raport spójne z rewizją
```

W trakcie live EXEC-04 obsługuje wykonanie/recovery, a UI-04 pokazuje stan i ręczne przekazanie. Testy awarii, restartu i duplikatów obejmują EXEC-04, OSS-04 i QA-04. Przy nieznanym stanie procesu najpierw reconciliation, nie ponowny spawn. Wariant manual_handoff zachowuje zależności baseline, review i dowodów; zmienia sposób przekazania zadania/wyniku.

## 4. Boczne gałęzie OM i WordPress — niezależne od React preview

```text
Gotowe export/import OSS + właściwy zatwierdzony pakiet targetu
└── RÓWNOLEGŁE GAŁĘZIE względem głównej ścieżki React
    ├── EXEC-05 [H20–22]: PoC Open Mercato
    │   └── Eksport → rzeczywista walidacja → import wyniku
    │       └── Dowód OM dla QA-05 i końcowego odbioru G8
    └── WP-M01 zakończone + dostępny czas Michała
        └── WP-M02 [H22–26]: MICHAŁ / WP-ACCESS
            ├── Eksport pakietu → świeży run lokalnego orchestratora
            │   └── Pobranie skorelowanego raportu i hashów
            └── Mapowanie/testy/import w OM
                ├── Tę część może wykonać inna osoba na fixture
                └── Dowód obowiązkowego WP PoC dla QA-05 i G8
                    └── OPCJONALNIE: WP-M03 / MICHAŁ / WP-ACCESS
                        └── Tylko gdy został czas w łącznym limicie 6 h
                            └── Apply → upload → verify desktop/mobile
                                └── Dowód bonusowego WP E2E
```

PoC OM i WP nie muszą czekać na React preview ani na siebie. WP-M02 wymaga świeżego, skorelowanego wyniku; historyczny raport nie zalicza nowej próby. WP-M03 nie blokuje odbioru obowiązkowego PoC. Brak obowiązkowego dowodu OM/WP nie blokuje pracy nad Reactem, ale uniemożliwia zadeklarowanie pełnego spełnienia planu.

**Obsada:** WP nie jest piątym strumieniem wykonywanym przez dodatkową osobę. Rezerwuje H0–2 i H22–26 dawnego przydziału QA. Jeśli Michał wybierze inny strumień, trzeba zamienić jego kolidujące zadania z wykonawcą QA według [harmonogramu](README.md). Łącznie WP-M01…03 oraz praca innych osób przy importerze mieszczą się w 6 osobogodzinach.

## 5. Połączenie gałęzi i końcowy odbiór

```text
H28 — FEATURE FREEZE; główna ścieżka dostarcza G7
└── RÓWNOLEGLE, na wspólnej rewizji do odbioru
    ├── QA-06 [H28–30]: uruchomienie pełnego gate i integracji
    │   └── Wyniki + lista błędów + evidence-index ──────────────┐
    ├── OSS-06 [H28–30]: naprawy domeny/kontraktów               │
    │   └── Commit naprawy → ponowna odpowiednia walidacja ─────┤
    ├── EXEC-06 [H28–30]: recovery/cancel/manual_handoff         │
    │   └── Commit naprawy → ponowna odpowiednia walidacja ─────┤
    └── UI-06 [H30–32]: naprawy UX po wynikach QA                │
        └── Commit naprawy → ponowna odpowiednia walidacja ─────┤
                                                              ▼
G8 [H34] POŁĄCZENIE: aktualne wyniki gate + G7 + OM PoC + WP PoC
└── WSPÓLNIE [H34–36]: OSS-06 + EXEC-06 + UI-06 + QA-06
    ├── Oba wejścia, live Figma i zatwierdzenie baseline
    ├── Dwa runy, review, rzeczywista poprawka i aktualne preview
    ├── Raport końcowej rewizji oraz dowody OM/WP
    └── Człowiek zapisuje końcowy verdict
        ├── Kryteria spełnione → ODBIÓR
        └── Kryteria niespełnione → jawne braki, bez deklarowania PASS
```

Gate może pracować poza aktywnymi blokami developera. Nowy commit po zielonym wyniku wymaga ponowienia dotkniętych kontroli; dowodów nie przenosi się automatycznie na nową rewizję. H30–H34 pozostaje buforem, a jego użycie zwiększa faktyczny nakład. Jeśli gałąź boczna ma blocker, gate React/OM i naprawy nadal mogą działać, lecz końcowy raport musi wskazać brak.

## Szczegóły poszczególnych gałęzi

- [OSS — kontrakty, domena, baseline i raport](01-oss-domain.md)
- [EXEC — Cezar, enterprise, recovery i OM PoC](02-execution.md)
- [UI — Figma, oba wejścia i interfejs](03-design-ui.md)
- [QA — testy, preview i odbiór](04-quality-preview.md)
- [WP — zadania Michała wymagające dostępu](05-wordpress-michal.md)

To widok zależności, nie dodatkowa lista postępu. Kryteria odbioru zaznaczamy wyłącznie w [Progress planu głównego](../plan.md#progress).
