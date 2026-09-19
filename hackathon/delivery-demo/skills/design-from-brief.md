# Skill — `design-from-brief`

Agent rysuje ekran w Figmie i oddaje **render pliku** plus metadane. Render wchodzi do projektu
przez dialog *Dodaj ekran* — sha256 liczy przeglądarka z bajtów wgranego pliku, a serwer
weryfikuje te bajty przy zamrożeniu baseline'u. Adres renderu zwrócony przez Figmę **wygasa**;
zapis musi nastąpić od razu, w tym samym kroku.

Sekwencja i jej dowody pochodzą z UI-01: `hackathon/delivery-demo/evidence/figma/`
(`prompts.md`, `manifest.json`, `capture.sh`, `verify.sh`, `SHA256SUMS`).

## Zmierzone ograniczenia — wymień je człowiekowi przed startem

- **10 odczytów na minutę** na tierze `starter` konta Figma. Zapis (`create`/`update`) jest poza
  tym limitem, ale każdy `read` z renderem się liczy. Sekwencja `create → read → update → read`
  zużywa dwa odczyty; powtarzanie jej w pętli wyczerpuje limit i kończy się błędem, a nie pustym
  wynikiem.
- **Autoryzacja MCP wymaga jednorazowego logowania interaktywnego.** W sesji bez zalogowanego
  MCP Figmy żadne wywołanie nie przejdzie — to nie jest coś, co agent obejdzie sam.

## Sekwencja

Powtórz kroki z `evidence/figma/prompts.md`: `create` → `read` → `update` → `read`.

1. **`create`** — utwórz frame w pliku próby. Polecenie w języku naturalnym; agent rysuje
   natywnymi elementami Figmy (frame'y, auto layout, tekst, prostokąty) — **nie** wkleja obrazu
   i nie generuje bitmapy. Zwróć `nodeId`.
2. **`read`** — odczytaj ten `nodeId` i zwróć render. Natychmiast:
   ```bash
   ./capture.sh create <nodeId> "<adres renderu>" prompts.md
   ```
3. **`update`** — zmień **ten sam** frame. Utworzenie drugiego frame'a obok pierwszego nie
   dowodzi zdolności edycji i nie zalicza kroku.
4. **`read`** — odczytaj ponownie i:
   ```bash
   ./capture.sh update <nodeId> "<adres renderu>" prompts.md
   ```

Na koniec `./verify.sh` — sprawdza, że bajty na dysku zgadzają się z `SHA256SUMS`.

## Plik próby

`fileKey` **`5wOkFtN959W4MFmgRuaU8S`** — https://www.figma.com/design/5wOkFtN959W4MFmgRuaU8S

Przy powtórce użyj `nodeId` i adresów renderu **zwróconych w bieżącej sesji**, nie wartości
z UI-01.

## Wyjście dla człowieka

Dla każdego ekranu podaj komplet metadanych, których żąda `screenRefSchema`:

| pole | skąd |
|------|------|
| `name` | nazwa frame'a |
| `fileKey` | plik Figmy |
| `nodeId` | zwrócony przez `create` |
| `viewport.width` / `viewport.height` | wymiary frame'a |
| `figmaVersion` | wersja pliku, jeśli sesja ją zwróciła — pole opcjonalne |
| render | plik `.png` / `.jpeg` / `.webp`, maks. 10 MB |

`attachmentId`, `sha256` i `capturedAt` **nie** są twoje: attachmentId nadaje upload, sha256 liczy
przeglądarka z bajtów, `capturedAt` ustawia moment uploadu. Nie podawaj wymyślonego hasha —
serwer sprawdza bajty przy zamrożeniu i odrzuci niezgodność jako `attachment_hash_mismatch`.

Przykład kompletu metadanych (bez pól nadawanych przez upload):
`hackathon/delivery-demo/fixtures/design-manifest.v1.json`.

## Czego ta instrukcja nie obejmuje

- Odczytu komentarzy Figmy — działający zapis `use_figma` **nie** dowodzi dostępu do API
  komentarzy. To osobny probe, blokujący dla synchronizacji komentarzy do Kanbana.
- Pixel diffu Figma ↔ przeglądarka i automatycznego re-anchoringu uwag między wersjami.
