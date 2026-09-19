# OSS-03 (L7b) Design-Review Validation and Attachment Verification — Plan Brief

> Full plan: `context/changes/asd-oss-t020-oss-03-l7b-add-design-review-validat/plan.md`
> Research: `context/changes/asd-oss-t020-oss-03-l7b-add-design-review-validat/research.md`

## What & Why

A baseline is what two humans approve and what every agent task is pinned to. Today it only checks that the referenced
attachment ids exist in the organization. This change verifies the stored bytes (sha256), type and size, adds the pure
design-review rules (screens, comments, tokens, DesignManifest v1) and freezes the verified snapshot into the content.

## Starting Point

`delivery_os.baselines.create` does a scope-by-id lookup; `lib/designReview.ts` does not exist; `temporary_url_only` is
never produced.

## Desired End State

Foreign/missing attachment → identical `422 attachment_scope_mismatch`; wrong bytes → `422 attachment_hash_mismatch`;
non-image / oversize render → `422 missing_render`; valid draft → baseline whose content carries
`attachmentId + sha256 + sizeBytes + mimeType`; identical draft → the existing baseline.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Injectable seam | DI key `deliveryOsAttachmentInspector` returning `{ sha256, sizeBytes }` | The frozen fixture hash is arbitrary, a byte-level fake cannot match it; real hashing gets its own unit test | Research |
| Size/type in the contract | optional `sizeBytes` + `mimeType` on screen and attachment refs; command always writes stored values | v1 is additive-only; deterministic hash | Plan |
| Error codes | no new codes; screen type/size → `missing_render`, byte/declared mismatch → `attachment_hash_mismatch`, all 422 | catalogue frozen (T019 decision); task acceptance asks for 422 | Plan |
| One body | all problems collected, top code scope > missing_render > hash | same as T019, suits an unattended agent loop | Plan |
| Render types | png, jpeg, webp; no SVG | SVG is scriptable and not a pixel render | Plan |
| Max size | 10 MiB per attachment, checked on the row before reading bytes | bounded I/O inside the lock | Plan |
| Where design rules run | at freeze, not on draft save | drafts stay editable while screens are swapped | Plan |
| URL-only screens | detected on raw input (`temporary_url_only`) | the zod schema strips URL fields | Research |

## Scope

**In scope:** `lib/designReview.ts`, `commands/attachments.ts`, `commands/baselines.ts`, `di.ts`, optional contract fields,
test kits + unit tests, spec + hand-over.

**Out of scope:** import commands/routes, uploads, SVG, result-artifact verification (OSS-04), UI, integration specs.

## Architecture / Approach

Pure comparison in lib; one command helper loads scoped `Attachment` rows by id and asks the inspector (storage driver
factory from DI) for the byte facts; the baseline command applies the snapshot before hashing.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure rules | designReview.ts + optional fields + tests | over-strict token rule |
| 2. Command verification | inspector, DI, command order, kits, docs | three suites depend on the fixture draft |

**Prerequisites:** none. **Estimated effort:** one session.

## Open Risks & Assumptions

- Bytes are read inside the project-lock transaction (bounded by count × 10 MiB).
- UI must upload renders to the attachments module first and send the sha256 of the same bytes.

## Success Criteria (Summary)

- The five acceptance cases are proven by command tests; jest scope and core typecheck green; no ORM relation.
