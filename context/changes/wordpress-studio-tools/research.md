# Studio — ustalenia po korekcie zakresu

Data: 2026-09-19 (Europe/Warsaw). Badanie obejmuje źródła, nie prywatne raporty.

- Użytkownik wymaga nowej witryny i własnego wykonania w OM. Stary orchestrator
  jest referencją zachowania narzędzi, nie usługą wykonawczą ani źródłem danych.
- `packages/delivery-wordpress`, `delivery_os`, `delivery_agents`, `delivery-cezar`
  nie istnieją w aktualnym checkoutcie. Pierwszy pakiet można wykonać niezależnie.
- Root `package.json` wymaga Node 24.x. Host ma Node 24.13.1 i Studio 1.19.0.
  Sprawdzono `studio auth status`: exit 0; surowe dane konta nie zostały zapisane.
- Root nie ma zainstalowanego node_modules. Testowanie wymaga przygotowania
  lokalnego zestawu zależności; nie należy zmieniać wersji całego monorepo.
- Referencje w `/var/www/html/ai-tools/ai-wordpress-orchestrator`:
  `src/server/modules/preview/studioCli.js` — execFile, redakcja błędów, JSON po bannerze;
  `workspaces/studioAdapter.js` — polecenia site create/start/stop i Studio WP;
  `wordpress/studio.js` — nowy motyw blokowy, aktywacja i baseline Git;
  `workspaces/snapshots.js` — bezpieczne ścieżki, SHA256 i snapshot SQLite z WAL.
- `workspaces/service.js` zależy od prywatnej bazy, runs, kolejki i recovery.
  Nie przenosimy tego silnika. Implementacja narzędzi będzie własna, zgodna
  z kontraktem CLI; nie kopiujemy prywatnego repo do OM.
- Root plan przydziela domenę do OSS, wykonanie do enterprise. Narzędzia Studio
  nie mogą importować enterprise ani przyznawać biznesowego verified/release.
- Utworzenie witryny jest skutkiem zewnętrznym bez gwarancji exactly-once.
  Rezerwacja musi poprzedzać create; timeout wymaga uzgodnienia, nie ślepego retry.
- Git motywu nie obejmuje danych WordPress. Dowód wersji musi obejmować także
  zamrożony snapshot danych. Hash pliku SQLite i logiczny fingerprint to różne rzeczy.
- Publiczne preview wymaga uploadu i osobnej weryfikacji prywatności; nie jest
  skutkiem lokalnego create. Nie jest konieczne do autoryzowanej nowej lokalnej witryny.

Wcześniejszy test API starego orchestratora potwierdził jedynie jego dostępność
i walidację. Nie stanowi dowodu nowej architektury ani nowego projektu.
