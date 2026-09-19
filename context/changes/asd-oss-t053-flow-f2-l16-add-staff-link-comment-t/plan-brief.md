# T053 — Plan Brief
> Full plan: `plan.md`. Data layer + pure rules for Figma comment import (F10–F13). Decisions D1–D10 in plan.md;
> key one: batch key/hash stored in `sync_cursors[fileKey]` (A14), cursor advances only on a fully successful batch.
> Phases: 1 data (entities/migration/encryption/validators), 2 rules (`lib/commentImport.ts`), 3 verification/docs.
> Risk: `yarn db:generate` noise from other modules (delete it); generator column order in DDL must be reviewed.
