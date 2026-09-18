# OSS-01 T002 — plan brief

**Goal:** a buildable, testable React/TS target repo at `../delivery-demo-react` that later tasks (EXEC bridge, ResultManifest) can point at.

**Decisions (self-answered)**
- Sibling dir, own git repo, never added to open-mercato (keeps OM tree clean; planer decision).
- Vite `react-ts` template via `npm create vite@latest` (registry reachable); Vitest + `@testing-library/react` + `jsdom`.
- Test titles carry a stable AC id prefix `AC-NNN:`; JSON report via Vitest's built-in `json` reporter to `reports/vitest-report.json` (`test:report`).
- `previewTargetRef` is only an env parameter (`.env.example`); no deploy, no hosting account.
- Reports/`dist` gitignored; the AC id convention is documented in the demo repo README and in the readiness note.

**Failure paths:** registry failure → manual scaffold, else record an H3 blocker; test failing → non-zero exit + JSON report still written; JSON report path not writable → `mkdir` via config `outputFile`.
