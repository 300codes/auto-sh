# Budżet WP — rejestr pracy

**Aktualna decyzja użytkownika 2026-09-19: cap wdrożenia WP zniesiony.**
Wykonujemy niezależne prace do bramki kodu zespołu, potem wspólny merge.
Poniższe limity i pozostałości są historycznym rozliczeniem, nie aktywnym limitem.
Dalszy czas rejestrujemy informacyjnie; zasoby hosta i bramki publikacji bez zmian.

Historyczny stan przed zniesieniem cap:60 min zużyte z360 min, pozostałe300 min.

| Praca | Pomiar / sposób liczenia | Obciążenie |
|---|---|---|
| Mapper i fixture WP-M02, testy i własny przegląd | Agent: 10:17:35–około 10:23 UTC; zaokrąglenie w górę | 6 min |
| Studio Preview probe, odczyt starego wzorca, dokumentacja i review mappera | Root: okno 10:16–10:25 UTC, konserwatywnie całe okno mimo przeplatania QA | 9 min |
| Native focused Jest/TS i niezależny review WP | Krótkie prace równoległe, rezerwa zamiast pozornej precyzji | 5 min |
| F0: paczki ACF/Polylang Free, pobranie, integralność i zakres zgodności | Rezerwa 5 min na tę sesję przygotowania | 5 min |
| Sprawdzenie Loco Translate i zapis rozróżnienia treści/pól | Rezerwa 2 min | 2 min |
| F0 operator: implementacja, trzy próby lokalne, poprawki transportu i review | Root 11:46–12:08 UTC, 23 min zaokrąglone + 10 min rezerwy pracy równoległej F0 | 33 min |
| WP-01 lokalny builder i wzajemny review WP-02 | Agent: mierzone 12:05:52–12:10:54 UTC plus wcześniejszy research, konserwatywnie | 10 min |
| WP-02 mapper, fixture i wzajemny review WP-01 | Agent: początek niemierzony, koniec 12:10:28 UTC; konserwatywnie | 10 min |
| Niezależny review nowych WP-01/02 | Agent: 12:04–12:11 UTC, zaokrąglone; bez poprzedniego F0 | 8 min |
| Integracja dowodów, rzeczywisty lokalny build CLI i snapshot po buildzie, runbook | Root od 12:08 UTC; zaokrąglenie z rezerwą na końcowe kontrole | 8 min |

Historyczne rozliczenie konserwatywne: **156 min zużyte, 204 min (3 h 24 min) pozostało**.
Nie jest to precyzyjny pomiar czasu każdej operacji; jawne zaokrąglenia zabezpieczają limit.
Prace nad środowiskiem OM, ACL, baseline i review domeny nie obciążają tej puli WP.
Dalszy adapter publikacji wymaga osobnego planu/estymaty; nie rozpoczęto jego implementacji
ani live uploadu. Wybrany target: Studio Preview, sprawdzony CLI/auth; dowód w
[studio-preview-readiness.md](studio-preview-readiness.md).

Aktualizacja F0 z 12:08 UTC: lokalny operator przeszedł 65 testów, typecheck/build i
pełny ograniczony probe live. Kolejne niezależne WP-01/WP-02 są w toku; każdy ma limit
45 min, wciąż we wspólnej puli. Rzeczywiste pomiary zostaną doliczone przy domknięciu,
bez traktowania rezerwacji jako automatycznej zgody na przekroczenie sześciu godzin.

Końcowe rozliczenie tej porcji: trzy ograniczone pętle implementacja/review zamknięte.
Prace subagentów doliczono oddzielnie i konserwatywnie, mimo nakładających się okien;
nie jest to precyzyjny czas ścienny. Kolejne WP-01/02 mieszczą się w rezerwacjach45min.
Pełna integracja motywu, edytor/ACF/SEO, autentyczny design, cały build OM oraz Preview
pozostawały wtedy przed nami. Dalsze wykonanie ma obecnie zgodę bez cap WP;
aktualny stan opisuje [wspólny plan QA/WP](../qa-wp-delivery-sequencing/plan.md).
