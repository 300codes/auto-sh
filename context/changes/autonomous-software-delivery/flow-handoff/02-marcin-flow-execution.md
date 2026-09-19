# Marcin — workflow, scoping i wykonanie

## Wynik

Nowy projekt otrzymuje domyślny flow i wykonuje kroki dopiero po zgodach. Edycja szablonu jest możliwa w Workflows Studio, a istniejące projekty zachowują poprzednią wersję. WordPress jest głównym targetem demo.

## Pliki i granice

Enterprise: `packages/enterprise/src/modules/delivery_agents/`, `packages/delivery-cezar/`, `.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md`. Reuse: `packages/core/src/modules/workflows/AGENTS.md`, DI, publiczne definicje/instancje i visual editor. OSS ustawienia/definicje przez uzgodniony z Mateuszem publiczny seam; frontend ustawień należy do Adama. `packages/delivery-wordpress/` należy do Michała.

## Kroki

1. F0: opisz dokładny podział workflow projektu vs workflow próby oraz API ustawień/publish/pinning w OSS. Z Mateuszem ustal korelację project/stage/artifact/attempt i atomiczną kontrolę zgody; uzupełnij enterprise spec. Nie przenoś całej domeny procesu do enterprise.
2. Podłącz agentowy scoping: brief + rozmowa → pytania i propozycja Scope/wyboru narzędzi. Użyj istniejących typed AI/wykonania i wzorca propose-only. Wznowienie nie dubluje propozycji ani efektów. Decyzje pozostają ludzkie.
3. Dostarcz domyślny template i wersjonowaną publikację. Każda zmiana conditions/config/tool/approval policy, nie tylko topology, tworzy nową wersję. Zachowaj immutable snapshot projektu. Korzystaj z istniejącego buildera; nie zmieniaj globalnej maszyny stanów.
4. Trwałe oczekiwanie na Scope/UX/KV/UI/deploy approvals, reject → poprawki. Retry/sygnał po restarcie nie uruchamia agenta ponownie; backend weryfikuje hash i aktualne prawa przed efektem.
5. Z Michałem podłącz host OM→WP→OM: reserve/claim, walidowany pakiet, scoped handle, realne checks i ResultManifest. Istniejący ToolCheck nie jest ResultCheck — host zbiera dowody AC i revision, nie dorabia PASS.

## Odbiór i zależności

FLOW-02/05/06/08/09: restart podczas oczekiwania, duplicate signals, odrzucenie/stale approval, edycja flow z aktywnym projektem, brak enterprise, anulowanie i niepewny start. Integracja WP wymaga narzędzi Michała oraz kontraktów Mateusza; UX może pracować na fixture. Live automation i manual_handoff muszą być wyraźnie rozróżnione w raporcie.

## Wspólne warunki

Czytaj [dodatek produktowy](../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) oraz [README](README.md). Kierunek z dodatku ma pierwszeństwo nad wcześniejszym React-first/WP-PoC. To zadania do wykonania, nie raport ukończenia. Zachowaj istniejące zmiany innych osób. Nie zmieniaj samodzielnie zamrożonych DTO v1 ani kontraktów innego właściciela.

Przekazanie: commit SHA, lista plików, wersja kontraktu/fixture, wykonane testy i runner, dowody oraz jawne blockery. Testy integracyjne danej funkcji dostarcz razem z nią; nie odkładaj ich na końcowy QA. Generacja po zmianach auto-discovery. Migracje przygotuj z snapshotem, nie aplikuj ich bez zgody. Nie wprowadzaj sekretów do artefaktów.
