# Handoff po integracji zespołu

Aktualny punkt wejścia: [przekazanie na drugi komputer](offline-handoff.md).

Status roboczy: implementacja lokalnych gałęzi i review loop trwają. Ten dokument
nie jest potwierdzeniem pełnego QA, publikacji ani gotowości merge.

Aktualizacja 2026-09-19: na polecenie użytkownika włączono `origin/main`
`d403ca1f927d42ec1144052aa5a19f5dfdcb97ff` oraz OSS `dev-mateusz`
`a74cfe8fff86cb3c2b8fc31d00dec3b6c8a367f5` i UI `feature/design-ui`
`0b1cce2847d73ac8280a1c1de25c06ebe0c3af62`; lokalny merge HEAD `67aa2d1f8`, zachowując lokalne prace QA/WP.
Kod EXEC-04/05, OSS oraz UI-02–04 jest już w tym checkoutcie. Poniższa tabela jest
listą wymagań integracji, nie aktualną listą nieistniejących modułów. Sprawdzamy
rzeczywiste styki i kontrakty; poprzedni build QA nie zalicza tej nowej rewizji.

## Kontrakty potrzebne od zespołu

| Właściciel | Potrzebny kod / artefakt | Kontrole po połączeniu |
|---|---|---|
| EXEC | delivery_agents execute API, worker/bridge, trwały park-before-enqueue, signal/reconcile, probe procesu i worktree | REC01–10, pojedynczy spawn, evidence i effective-resume; dwa runy naprawdę współbieżne |
| EXEC + OSS | Istniejące reconcile stopped wymaga potwierdzenia rzeczywistego zakończenia procesu | Mid-run cancel, late result, retry/reconcile; zachować istniejącą regresję TC007 |
| OSS | Wersjonowane Scope/UX/KV/UI approvals, stale-version guards, downstream invalidation i zgoda wdrożenia na target/revision | FLOW01–09 wymagające tych bramek; blokada wykonania/publikacji bez decyzji |
| Design/Figma | Rzeczywisty zaakceptowany eksport DS/UI + fonty i rewizje/approval | Pełne WP02, desktop/mobile comparison; fixture nie jest źródłem zatwierdzonego designu |
| Host WP/EXEC | Zaufane powiązanie project/task/attempt/baseline/package/workspace i aktualnych checks | Żywy OM→WP→OM; wynikowy workspace musi zgadzać się z witryną bazową |
| Host deployment/OSS | Zweryfikowane decyzje oraz transport dokładnego przygotowanego pakietu do Studio | Native CLI przyjmuje registered site, nie frozen ZIP; brak użycia --overwrite/adopcji cudzej strony; G4/G5 i exact-revision verify |

Znany brak walidacji wynikowego workspace w obecnym OSS pozostaje osobnym defektem
przekazanym właścicielowi; mapper fixture odrzuca go bez zmiany publicznego API.
Kod delivery_agents jest już połączony. Niezgodne DTO Cezar/OSS, powiązanie rzeczywistego
snapshotu WP i dowody procesu nadal blokują pełny automatyczny REC live.

## Kolejność po integracji

1. Odświeżyć manifest źródeł (HEAD + localdiff/config/dependencies); historyczne raporty zachować.
2. Przygotować własne środowisko API/DB i potwierdzić sentinel przed DB counters.
3. Uruchomić regresję v1 oraz nowe stage approvals. Naprawy w kodzie odpowiedniego właściciela.
4. W kontrolowanym oknie OM+WP+worker wykonać REC i pełny roundtrip z rzeczywistym designem.
5. Odbiór edytora/designu, pełny ordered gate finalnej rewizji, prywatny kompletny pakiet.
6. Przedstawić target/hash/checks do zgody; dopiero potem upload i odczytowy odbiór.

Manualne QA1.3/7.3 i odbiór WP3.3/6.2 wymagają własnych potwierdzeń. Not_run nie jest
PASS. Udany reducer timeout/reconcile nie jest testem uploadu ani dowodem autoryzacji.
Tłumaczenia pozostają deferred_by_user, cap WP został zniesiony. Main został połączony lokalnie; nie wykonano publikacji ani końcowego merge prac do main.

## Osobny defekt inicjalizatora znaleziony podczas QA

CLI `packages/cli/src/lib/init-secrets.ts` wyprowadza email administratora z domeny
superadmina, lecz `packages/core/src/modules/auth/lib/setup-app.ts` przy braku
OM_INIT_ADMIN_EMAIL używa admin@acme.com. Footer może wskazać inne konto niż
faktycznie utworzone. QA używa jawnie rzeczywistego konta i prywatnego losowego
hasła; bezpośredni login potwierdzono przed retestem. Poprawka produkcyjnego
bootstrapu pozostaje osobnym zadaniem właściciela, nie blockerem tego środowiska.
