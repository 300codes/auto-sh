# Integracja korekty flow — 2026-09-19

Źródła: [pakiet zespołu](../autonomous-software-delivery/flow-handoff/README.md),
[zakres Michała](../autonomous-software-delivery/flow-handoff/04-michal-wordpress-qa.md),
[dodatek produktu](../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md).
Użytkownik polecił naprawić blocker uruchomienia i kontynuować implementację po analizie tego pakietu.

## Checkpoint po integracji main

Poniższa kolejność i macierz zachowują stan pierwotnego przygotowania. Aktualny
`68361d163` zawiera już domenę FLOW-F1 i EXEC-04/05; opis braku całego kodu nie jest
aktualny. Konkretne pozostałe połączenia, przygotowany mapper WP-M02 i stan builda
opisują [mapa integracji](../qa-wp-delivery-sequencing/integration-call-sites.md) oraz
[bramki](../qa-wp-delivery-sequencing/dependency-gates.md). Pełnego FLOW nie zalicza
samo połączenie main ani udana regresja HTTP v1.

## Pierwszeństwo i granice

Obowiązkowy odbiór zmienia się z React-first/WP-PoC na pełny proces WordPress:
brief → Scope → UX → KV → DS/UI → implementacja → QA → zgoda publikacji → URL i odbiór.
Każda zgoda dotyczy konkretnej wersji; `design` v1 nie oznacza trzech nowych zgód.
Komentarze Figmy muszą trafiać do istniejącego staff Kanbana, a flow używać Workflows Studio.
Historia dowodów i istniejące zaznaczenia planu pozostają bez zmian.

Plan QA faz 1–7 nadal dostarcza regresje istniejącego v1 i przygotowanie do integracji.
Nie jest implementacją całego dodatku. Dołączenie nowych operacji wymaga konkretnego
F0 właścicieli; obecnie są wymagania produktowe, brak zatwierdzonych payloadów nowych etapów.
Nie projektujemy zastępczych API w testach. Naprawa bundlowania jest osobnym,
zatwierdzonym przez użytkownika warunkiem uruchomienia QA, bez zmiany kontraktów v1.

## Bieżąca kolejność

1. Naprawić import serwerowych loaderów message objects do klienta i sprawdzić regresję bundlowania.
2. Powtórzyć fazę 1 w disposable środowisku (JS 4096 MiB, app 6144 MiB / 2 CPU, DB 512 MiB / 1 CPU).
3. Podczas przygotowania środowiska implementować testy fazy 2 istniejącego API i helper dowodów potrzebny od pierwszego wykonania. Nie zaliczać faz przed testami.
4. Kontynuować baseline/proposals, OSS review i testowe mapowanie WP zgodnie z planem, z osobną kwalifikacją mock/HTTP/live.
5. Nowe FLOW i live publikacja pozostają jawnie zależne od F0, dostępu i dodatkowego budżetu; nic nie znika z mianownika odbioru.

## Macierz nowego odbioru

| ID | Właściciele / zależność | Wkład bieżącego QA | Stan pełnego odbioru |
|---|---|---|---|
| FLOW-01 | Mateusz + Adam + Marcin: draft/scoping/wizard | Regresja projects v1; przyszłe save/resume i propose-only | missing F0/implementacja; not_run |
| FLOW-02 | Mateusz: osobne stage artifacts/approvals i dispatch gate | Istniejące requirements/design, ACL i stale lock; nie zastępują Scope/UX/KV/UI | missing F0; not_run |
| FLOW-03 | Adam + Mateusz: komentarze Figma → staff | Scenariusz identity/retry/parallel; realny komentarz wymaga dostępu | missing F0/provider; not_run |
| FLOW-04 | Mateusz + Adam: staff link i approvals | Scoping/409 v1; Done nie może ustawiać verified | missing integracja; not_run |
| FLOW-05 | Marcin + Adam: template publish/pinning i editor | Wymagany test config/conditions v2 + restart; brak gotowego seam | missing F0; not_run |
| FLOW-06 | Marcin + Michał: host i realne wykonanie WP | Reserve/result/review v1 + fixture mappera; żadne nie zalicza live WP | missing host; not_run |
| FLOW-07 | Mateusz + Michał + Adam: decyzje i publikacja/report | Wymagany target/revision/URL proof/rollback | Studio Preview wybrany; missing adapter/R20–22; not_run |
| FLOW-08 | Wszyscy; Michał prowadzi regresję | Faz 1–4 izolacja/ACL/v1/OSS-only; częściowy dowód dopiero po wykonaniu | not_run HTTP; unit nie zalicza całości |
| FLOW-09 | Mateusz + Marcin + Adam: zależności wersji | Stare decyzje nie odblokowują nowego baseline v1; osobne etapy czekają F0 | missing F0; not_run |

## WP F0 i budżet

Potwierdzony stan wejściowy: 1 h wykorzystana, 5 h pozostało z wcześniejszych 6 h.
Praca QA środowiska OM nie jest pracą pakietu WP. Nowy zakres nie ma automatycznie
większego limitu. Przed rozpoczęciem mappera należy zacząć pomiar czasu WP; przed
rozszerzeniem do deploy adaptera zatwierdzić estymatę oraz target.

Wstępna estymata rozszerzenia Michała, poza wcześniejszym mapperem: 2–4 h probe/projekt
adaptera po wskazaniu celu, 6–12 h implementacja deploy/revision verification/recovery
z testami, 4–8 h integracja hosta i pełna próba z gotowym F0/designem. Łącznie 12–24 h,
nie jest to zgoda na wydatek ani termin; nie obejmuje implementacji innych właścicieli,
czekania na dostęp ani poprawek ujawnionych podczas live. Zweryfikować po probe celu.

Użytkownik wybrał Studio Preview i wskazał stary orchestrator jako wzorzec.
[Probe i granice reuse](studio-preview-readiness.md): CLI 1.19.0 i auth potwierdzone,
brak świeżego pakietu/zgód/adaptera. Nie utworzono witryny ani nie rozpoczęto publikacji.

## Dodatkowy blocker uruchomienia — loader współdzielony przez bootstrap

Po poprawnej kompilacji Webpack etap collect page data ujawnił ponowną rejestrację
`auth:commands:acl`. W wygenerowanym rejestrze jest jeden wpis; `bootstrap-api`
(`registrationKey: api`) i pełny bootstrap (`full`) przekazują ten sam obiekt z
`serverFoundationBootstrapData`. Rejestr błędnie traktował powtórzenie tego samego
obiektu jako konkurencyjną definicję.

Minimalna naprawa: poza development ponowna rejestracja dokładnie tego samego obiektu
loadera jest idempotentna. Nowy obiekt z tym samym id/kluczem, nawet z identyczną funkcją,
nadal powoduje błąd; zachowanie HMR pozostaje bez zmian. Nie ma nowego kontraktu,
parametru ani zmiany generatora. To korekta konieczna do uruchomienia, objęta zgodą
użytkownika na usuwanie blockerów. Testy obejmują exact-id i fallback-key oraz brak
ponownego wykonania loadera. Pełny gate pozostaje osobnym warunkiem.
