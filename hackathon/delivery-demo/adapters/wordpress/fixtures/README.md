# Synthetic WordPress tool evidence

`tool-evidence.fixture.json` is a synthetic example for future adapter authors. It
was not exported from a WordPress site, a previous orchestrator, or an OM run.
The IDs, timestamps, and all three check outcomes are illustrative. `passed`
does not establish that a real command or acceptance criterion passed.

This example has no approved baseline or AC, no connection to delivery_os, and no
public preview. It is not a `SiteResult`, a complete database/theme snapshot, or
an accepted delivery_os `ResultManifest`. `sourceRevision` and snapshot hashes
are deliberately null: a CSS file alone cannot establish a WordPress revision.
Do not import this example as evidence of a live attempt or turn missing checks
into PASS.

The one artifact, `artifacts/theme-style.css`, is included here. Its SHA-256 and
byte length in the JSON describe the actual included bytes, not a live website.
No database, credentials, account identifiers, private filesystem paths, or
signed URLs are included. Synthetic UUIDs identify no real tenant or project.

Verify the artifact from this directory with:

```sh
sha256sum artifacts/theme-style.css
wc -c artifacts/theme-style.css
```

The `checks` entries use the package's `toolCheckSchema`; the surrounding example
envelope is documentation, not a new public DTO. A future importer must retain
`provenance: fixture`, require correlation to its own trusted scope and baseline,
and keep illustrative outcomes separate from executable validation evidence.
