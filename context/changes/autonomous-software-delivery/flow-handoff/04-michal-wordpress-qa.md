# Michał — WordPress E2E, publikacja i odbiór

## Wynik

Świeży projekt rozpoczęty w OM przechodzi przez design i klientowskie zgody do rzeczywistej witryny WordPress, publikacji i raportu dowodów. Lokalny smoke narzędzi pozostaje tylko częścią tego dowodu.

## Pliki i granice

`packages/delivery-wordpress/`, `.ai/specs/2026-09-19-wordpress-studio-tools.md`, testy integracyjne przy właścicielskich modułach oraz uzgodnione artefakty w `hackathon/delivery-demo/`. Istniejące niezacommitowane acceptance/runbook/evidence-index i fixture helpery nie należą automatycznie do tego zadania — przejrzyj i zintegruj bez nadpisywania pracy. Host enterprise należy do Marcina.

## Kroki

1. F0: probe Studio, świeża witryna i motyw, snapshot, możliwości wykonania kodu i kontroli. Oddzielnie zapisz konkretny cel publikacji, dostęp i sposób sprawdzenia URL. Brak celu/dostępu oznacza blocker publikacji, nie gotowe demo. Podaj estymatę rozszerzenia; dawny limit 6 h nie daje automatycznej zgody na więcej pracy.
2. Uzupełnij spec WP o implementację zatwierdzonego designu i publikację — obecny pakiet create/status/start/stop/captureSnapshot nie zapewnia całej ścieżki. Ustal ograniczony, typowany adapter deploy dla wybranego celu, credential refs, scope, retry, weryfikację rewizji i procedurę odzyskania/rollback. Nie dodawaj dowolnego shella ani starego orchestratora jako zależności.
3. Z Marcinem wykonaj OM→WP→OM na aktualnym baseline: zapis przed/po, rzeczywiste checks, ResultManifest, review/poprawka i ponowna walidacja. Retry istniejącego projektu używa jego handle, nie tworzy kolejnej witryny. Timeout nie daje automatycznego ponowienia side effect.
4. Testuj cały zestaw FLOW-01…09 z dodatku. Deterministyczne integration przy API/UI shipping razem z funkcją; live Figma/Studio osobno z jawną provenance. Izolacja tenant/org, ACL, konflikty, stale approvals i retry mają testy negatywne.
5. Publikuj dopiero po zgodzie dla konkretnej rewizji i środowiska. Zapisz URL, snapshot/revision, wynik HTTP/przeglądarki oraz końcowy odbiór. Stary URL, fixture albo localhost nie zalicza docelowej publikacji.

## Demo i dowody

Scenariusz w README jest obowiązkowy, włącznie z klientowskim KV/UI approval i zmianą flow. Każdy FLOW-ID mapuj na test lub manualny dowód z rewizją/czasem i osobą; nie oznaczaj niewykonanych kontroli jako PASS. Wizualny odbiór WP porównuje zatwierdzone UI na desktop/mobile; automatyczne testy nie zastępują zgody klienta.

Runner walidacji wybierz raz na gate zgodnie z `.ai/docs/agent-instructions.md`: Docker app jeśli działa, inaczej local. Zapisz runner i wynik; wybierz kontrole adekwatne do zmian, pełny końcowy gate według `.ai/agentic.config.json`. Nie aplikuj migracji/resetów ani nie publikuj na produkcję bez odpowiedniej zgody.

## Wspólne warunki

Czytaj [dodatek produktowy](../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) oraz [README](README.md). Kierunek z dodatku ma pierwszeństwo nad wcześniejszym React-first/WP-PoC. To zadania do wykonania, nie raport ukończenia. Zachowaj istniejące zmiany innych osób. Nie zmieniaj samodzielnie zamrożonych DTO v1 ani kontraktów innego właściciela.

Przekazanie: commit SHA, lista plików, wersja kontraktu/fixture, wykonane testy i runner, dowody oraz jawne blockery. Testy integracyjne danej funkcji dostarcz razem z nią; nie odkładaj ich na końcowy QA. Generacja po zmianach auto-discovery. Migracje przygotuj z snapshotem, nie aplikuj ich bez zgody. Nie wprowadzaj sekretów do artefaktów.
