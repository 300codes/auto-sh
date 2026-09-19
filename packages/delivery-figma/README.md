# Delivery Figma

Optional provider for Delivery comment synchronization. Enable `delivery_figma`
from `@open-mercato/delivery-figma` using the application's module configuration.
Configure and enable its integration in the Integrations UI. Tokens require
`file_comments:read`; no Figma write operation is performed.

`POST /api/delivery_figma/projects/:id/sync` accepts `fileKey`, `stageId` and
nullable `artifactId`. It requires `delivery_os.comments.import`, resolves the
session's tenant and organization, and imports guarded batches through the public
Delivery command. HTTP 207 means partial progress requiring retry, never success.
The cursor advances only after Delivery has durably reconciled Staff records.

Figma's comments endpoint returns a complete snapshot without pagination. The
provider bounds it to 8 MB / 5000 comments, then batches at most 200 threads per
Delivery import. It refuses oversized or incomplete responses before inferring
deletions. Missing previously imported comments become tombstones; history stays.
The API does not supply a design version or comment edit timestamp: version is
explicitly unconfirmed, and a detected edit uses its observation time.

Requests use a fixed Figma HTTPS origin with redirects disabled, a 10-second
timeout and at most three attempts. Long rate-limit delays are surfaced for a
later retry. Secrets are resolved per request via the scoped credentials service.

Optional deployment variables, consumed only by this provider during tenant setup:

- `OM_INTEGRATION_FIGMA_TOKEN`
- `OM_INTEGRATION_FIGMA_AUTH_TYPE` (`personal` or `oauth`)
- `OM_INTEGRATION_FIGMA_HEALTH_FILE_KEY` (accessible file for the health probe)

An existing tenant can configure the same fields in Integrations; the exported
`applyFigmaEnvPreset` supports deployment bootstrap without core preconfiguration.

API reference: https://developers.figma.com/docs/rest-api/comments-endpoints/
and https://developers.figma.com/docs/rest-api/comments-types/ (checked 2026-09-19).
