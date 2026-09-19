---
change_id: asd-oss-t042-flow-f1-l12a-add-pure-intake-and-sta
title: FLOW-F1 L12a — pure intake and stage-artifact rules
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# T042 — FLOW-F1 pure intake and stage-artifact rules

Medium complexity. Two pure, ORM-free rule modules (`lib/intakeRules.ts`, `lib/stageArtifacts.ts`) that the F1
commands (`intake.update`, `intake.import_proposal`, `stages.create_artifact`) will call, with unit tests driven by
the F0 fixtures. Covers UA-31, UA-35, UA-38 (logic), FLOW-01/02/09 evidence.
