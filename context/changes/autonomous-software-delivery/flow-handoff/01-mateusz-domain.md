# Mateusz — domena, zgody i powiązania Kanbana

## Wynik

Backend potrafi zapisać cały proces i odmówić przejścia bez odpowiedniej zgody. Feedback Figmy staje się rzeczywistym zadaniem staff, z zachowaniem jednej tożsamości wątku.

## Pliki i granice

Główna własność: `packages/core/src/modules/delivery_os/{data,lib,commands,api,migrations,__integration__}/` i `.ai/specs/2026-09-18-delivery-os-hackathon.md`. Reference CRUD: customers. Staff: `packages/core/src/modules/staff/AGENTS.md`, `api/timesheets/tasks/`, `api/timesheets/time-projects/`, publiczne komendy i spoty; nie edytuj prywatnych encji staff z delivery.

## Kroki

1. F0: przygotuj tabelę dokładnych endpointów/komend i schematów Zod: brief draft/resume, stage artifact/approval, template pinning, staff project/task mapping, import komentarzy. Dla każdej operacji podaj payload/result, ACL/scope, lock, idempotencję, błędy i OpenAPI. Rozpisz addytywne modele/migracje i granicę v1; oddziel UX/KV/UI od starego `design`. Dostarcz positive/negative fixture Adamowi i Marcinowi.
2. Wprowadź wersjonowane artefakty i zależne zgody. Zmiana upstream unieważnia aktualność downstream bez usuwania historii. Dispatch i publikacja sprawdzają całość serwerowo, także gdy wywołano stare API.
3. Zachowaj demo WP na preselektowanym profilu; zaprojektuj docelowy draft/intake tak, by wybór platformy w Scope nie mutował zamrożonego targetu istniejącego projektu.
4. Powiąż DeliveryProject ze scoped staff project. Importuj wątek jako jedną kartę, odpowiedzi jako komentarze, z retry/unikalnością odporną na równoległość. Ustal z Adamem wersjonowany normalized payload i granicę błędów; provider nie zapisuje tabel domeny bezpośrednio.
5. Udostępnij aktualny etap, blokery, pending approvals i report. Stan Done w staff nie ustawia `verified`; jawnie powiąż ewentualny DeliveryTask poprawki.

## Odbiór i zależności

FLOW-01/02/03/04/08/09: API integration dla każdej dodanej operacji, 403/404 scoping, 409 lock/stale, retry po crash, równoległe importy oraz regresja kontraktów v1 i OSS-only. Nie czekaj na live Figma/WP, żeby przetestować domenę. Provider Adama i workflow Marcina integrują się dopiero na Twoim kontrakcie F0.

## Wspólne warunki

Czytaj [dodatek produktowy](../../../../.ai/specs/2026-09-19-delivery-project-flow-addendum.md) oraz [README](README.md). Kierunek z dodatku ma pierwszeństwo nad wcześniejszym React-first/WP-PoC. To zadania do wykonania, nie raport ukończenia. Zachowaj istniejące zmiany innych osób. Nie zmieniaj samodzielnie zamrożonych DTO v1 ani kontraktów innego właściciela.

Przekazanie: commit SHA, lista plików, wersja kontraktu/fixture, wykonane testy i runner, dowody oraz jawne blockery. Testy integracyjne danej funkcji dostarcz razem z nią; nie odkładaj ich na końcowy QA. Generacja po zmianach auto-discovery. Migracje przygotuj z snapshotem, nie aplikuj ich bez zgody. Nie wprowadzaj sekretów do artefaktów.
