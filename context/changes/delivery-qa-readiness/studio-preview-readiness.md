# Studio Preview — wybrany cel demo

Użytkownik wskazał Studio Preview oraz istniejącą implementację
`/var/www/html/ai-tools/ai-wordpress-orchestrator` jako wzorzec. Jest to cel publikacji
demo FLOW-07, nie produkcja. Nie uruchomiono starego runtime/API/DB ani publikacji.

## Probe 2026-09-19

- Lokalny `studio --version`: 1.19.0. Dostępne create/update/list preview.
- `studio preview create --help`: jawny `--path` i `--name`.
- `studio preview update --help`: host i `--path`; domyślnie brak `--overwrite`.
- Odczytowy `studio auth status`: pierwszy przebieg bez sieci exit 1 (network_unavailable),
  powtórzenie z dostępem sieciowym exit 0 (authenticated). Konto i surowe wyjście nie zapisane.
- Nie odczytano tokenów ani plików poświadczeń. Nie użyto starego URL jako dowodu.
- Brak świeżej witryny powiązanej z zatwierdzonym pakietem OM; live upload/verify not_run/dependency.

Oficjalny kontrakt poleceń: [Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/).
Preview jest czasowy i wymaga ponownego uploadu zmian; według
[dokumentacji Preview Sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/)
wygasa po siedmiu dniach od ostatniej aktualizacji. Nie traktować go jako trwałego wdrożenia.

## Wzorzec do przeniesienia do własnego pakietu

Przeczytano: `docs/studio-preview.md`, `src/server/modules/preview/{studioCli,studio,deployment,verify}.js`
i AGENTS starego repo. To referencja zachowania, nie nowa zależność produkcyjna.

| Wzorzec | Wymóg nowej integracji OM |
|---|---|
| Inventory dopasowuje `localSiteId`; lista CLI 1.19 może obejmować inne witryny | Scope tenant/org/project + istniejący scoped handle, jawne dopasowanie siteId, nigdy samo `--path` |
| Odtworzenie saved host po restart/timeout | Trwałe powiązanie próby/baseline/snapshot/target i stanu uploadu; nie tworzyć drugiej publikacji w ciemno |
| Create tylko bez istniejącego preview; update tego samego hosta | Brak zgadywania domen i automatycznego zastępowania wygasłego/missing hosta; ambiguity → reconcile |
| `.deployignore` zachowuje reguły użytkownika, wyklucza sekrety/logi/referencje | Audyt paczki; zachować aktywne `.ht.sqlite` i wymagane WAL, wykluczyć backupy; nie publikować cudzych danych |
| Deployment-only MU guard i sekrety poza repo/site | Stabilne hasło, prywatny preview/noindex; brak modyfikacji produkcyjnego motywu; cleanup w finally i po crash |
| Weryfikacja czeka na dokładny znacznik wysłanej rewizji | Marker powiązać z zatwierdzonym contentHash; samo HTTP 200 i stary gate nie są dowodem nowego snapshotu |
| Przeglądarka desktop/mobile, hasło/sesje/robots/media/local URL leaks | Zapis bezpiecznych wyników i hashy raportów; brak tokenów/haseł w logach i screenshotach |
| Verify-only bez kolejnego uploadu | Błąd przeglądarki zachowuje URL i unverified; ponowić sprawdzenie tej samej rewizji |
| Brak udokumentowanego atomic rollback Studio update | Nie zapewniać, że poprzednia zawartość przetrwała timeout; reconcile i ewentualny re-upload zatwierdzonego snapshotu |

Statyczne media mogą być dostępne bez bramki PHP. To konkretna granica wzorca,
którą trzeba uwzględnić przy wyborze danych demo; nie deklarować pełnej prywatności mediów.

## Kolejny krok integracyjny

Własny typowany adapter preview w `packages/delivery-wordpress/` musi otrzymać scoped
site handle, zatwierdzoną rewizję i konkretną zgodę publikacji z F0. Obecne v1 tools
create/status/start/stop/captureSnapshot nie implementują tego adaptera. Nie rozszerzono
ich kontraktu podczas probe. Nie można uznać historycznego uploadu innego projektu
za dzisiejszy FLOW-06/07. Plan mapowania WP na fixture pozostaje niezależny od live preview.

## Doprecyzowanie użytkownika: build lokalny przed Preview

Cała instalacja, konfiguracja, build i testy odbywają się lokalnie. Dopiero gotowa,
zweryfikowana i zatwierdzona rewizja/snapshot trafia do Studio Preview jako deployment.
Na Preview nie instalujemy wtyczek ani zależności i nie uruchamiamy builda; wykonujemy
odczytową weryfikację wysłanej rewizji. Poprawki przygotowujemy lokalnie i wysyłamy jako
kolejny deployment po lokalnych kontrolach. Obecny probe F0 działa wyłącznie lokalnie;
nie jest dowodem pełnego builda systemu ani wykonanej publikacji Preview.
