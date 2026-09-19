# Fixtures demo

`design-manifest.v1.json` jest **przykładem wyniku** skilla `design-from-brief`, nie drugą
definicją schematu. Kontraktowym źródłem prawdy pozostaje fixture OSS
`packages/core/src/modules/delivery_os/lib/fixtures/design-manifest.v1.json`.

Wartości pochodzą z próby UI-01 (`../evidence/figma/manifest.json` i `SHA256SUMS`): plik
`5wOkFtN959W4MFmgRuaU8S`, węzeł `3:2`, render po kroku `update`.

`attachmentId` jest placeholderem — realny identyfikator nadaje upload renderu. Test
`components/detail/__tests__/screenImport.test.ts` konsumuje ten plik i pilnuje, że nie rozjedzie
się z `designManifestV1Schema`.
