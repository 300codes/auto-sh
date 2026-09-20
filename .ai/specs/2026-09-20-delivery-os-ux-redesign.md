# Delivery OS — UX redesign of the operator screens

Status: in progress (2026-09-20)

## Why

The delivery flow works end to end, but an operator cannot tell what is happening or what to do
next. Observed on the live screens:

1. **No "what next".** The domain already answers it — `GET /flow` returns `nextAction.kind`,
   `blockers[]`, `stages[].currency`, `pendingApprovals` — but `ProjectOverview` renders it as a bare
   `<p>`, a `<ul>` of link-buttons, and **three competing buttons** on one row (next action, pin
   template, materialize baseline). Nothing says which one is the step to take.
2. **Everything expanded at once.** The project detail stacks seven panels flat: overview, raw brief
   paragraph, execution widget, design import, baseline, tasks, evidence — plus the intake wizard
   *and* the stage review inline underneath. No hierarchy, no collapsing, one long scroll.
3. **Raw JSON in the operator's face.** `StageReview.generateDraft` dumps the AI-drafted artifact as
   `JSON.stringify(artifact, null, 2)` into a 14-row textarea and asks the operator to review and
   re-submit it. Same shape in `ProposalImportDialog`, `ResultImportDialog`, `DesignManifestImport`,
   `ScopingConversation`. Content hashes and `dependsOn` entries render as mono hash strings.
4. **"Brief" means four different things** — the pasted client text, the structured intake object, a
   wizard step, and a section heading ("Brief i zakres").
5. **The design system is ignored.** `NextStepCallout`, `ContextHelp`, `CollapsibleSection`,
   `SectionHeader`, `EmptyState`, `TabEmptyState` all exist and none are used; the module hand-rolls
   `<p>`/`<ul>`/`<h2>` instead.

## Decisions

### D1 — Vocabulary (chosen by the product owner)

| Concept | Polish | English | Was |
|---|---|---|---|
| Raw text the client sent, pasted at project creation | **Zlecenie klienta** | Client request | "Brief" |
| Structured discovery from the wizard (goal, audience, features, unknowns) | **Wywiad** | Discovery | "Brief" |
| `inputMode: from_brief` | **Ze zlecenia** | From client request | "Z briefu" |

Renames: `flow.step.brief` → "Wywiad", `flow.step.review` → "Przegląd wywiadu",
`flow.step.submitted` → "Wywiad wysłany", `flow.brief.title` → "Wywiad" (drop "i zakres" — scope is
a separate stage), `flow.blocker.intake_incomplete` → "Wywiad niekompletny",
`flow.nextAction.complete_intake` → "Dokończ wywiad", `projects.form.fields.brief` → "Zlecenie
klienta". The i18n **keys stay as they are** — only the values change, so no contract surface moves.

### D2 — Project detail becomes tabs, not a scroll

Same URL, same API. A persistent header holds identity + the next step; the panels move into tabs:

```
┌─ Aster Works — strona firmowa ─────────── W trakcie ─┐
│ ► CO DALEJ: Dokończ wywiad                           │
│   Wywiad ● › Zakres › UX › Key visual › DS i UI      │
│   Blokada: Wywiad niekompletny                       │
└──────────────────────────────────────────────────────┘
  [Proces] [Baseline] [Zadania 10] [Dowody]
```

`?stage=`, `?taskId=` and `?baselineId=` MUST keep working and MUST select the tab that shows them.

### D3 — No raw JSON in front of an operator

A JSON document is a machine contract, never a UI. Every place that shows or demands one is
replaced by a rendered view of the same data:

- **Reviewing a drafted stage artifact**: render the parsed content (summary, in/out of scope,
  requirements, acceptance criteria, screens, notes) as readable sections. The operator approves or
  rejects what they read; they never edit the envelope.
- **Importing**: file drop / paste stays available for the machine payload, but it MUST be parsed and
  shown as a human-readable preview before anything is submitted — counts, names, what will change —
  with parse errors named in prose, not as a schema dump.
- **Hashes and ids**: never a bare mono string in the primary reading flow. Shorten to 8 chars behind
  a tooltip/`TruncatedCell`, or move to a collapsed "technical details" area.
- Raw JSON MAY remain reachable behind an explicit "advanced / technical" disclosure for debugging,
  never as the default or only path.

### D4 — Reuse the design system, do not hand-roll

| Need | Use |
|---|---|
| "Do this next" + step tracker | `NextStepCallout` (`@open-mercato/ui/backend/NextStepCallout`) — has `steps[{id,label,state:'pending'\|'active'\|'completed'}]`, `actionLabel`, `onAction`, `disabled`, `disabledMessage`, `busy` |
| Section heading with count + action | `SectionHeader` / `CollapsibleSection` (`@open-mercato/ui/backend/SectionHeader`) |
| Explaining a screen inline | `ContextHelp` (`@open-mercato/ui/backend/ContextHelp`) |
| Nothing here yet | `EmptyState` / `TabEmptyState` |
| Loading / error / missing record | `LoadingMessage` / `ErrorMessage` / `RecordNotFoundState` |
| Status words | `StatusBadge` + `{property}-status-{status}-{role}` tokens |

## Hard constraints

1. **Preserve behavior.** No API, contract, schema, hash, event or ACL change. Presentation,
   copy and information architecture only.
2. Keep every existing `data-testid` and every element tests assert on; the module's tests MUST stay
   green. Add testids, never rename.
3. `apiCall`/`apiCallOrThrow` only; writes stay inside `useGuardedMutation`/`CrudForm`; optimistic
   lock headers and `surfaceRecordConflict` stay exactly as they are.
4. No hardcoded user-facing strings, no hardcoded status colors, no arbitrary Tailwind values, no
   `dark:` overrides on semantic tokens.
5. **Do not edit `i18n/*.json`.** Write needed keys to the scratchpad file named in your brief; the
   orchestrator merges all five locales in one pass.
6. Stay inside the file list in your brief. If a shared file needs changing, report it instead.

## Test coverage

Each area keeps its existing tests green and adds rendering tests for: the next-step affordance
(label, blocked state), tab selection from `?stage=`/`?taskId=`/`?baselineId=`, and that a drafted
artifact renders as readable content rather than a JSON textarea.
