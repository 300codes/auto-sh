# OSS-01 T002: bootstrap the React Vite/TS demo repo — Plan

Low complexity, single phase. See [plan-brief.md](plan-brief.md).

## Phase 1: Scaffold, verify, record

**Steps**
1. Scaffold `../delivery-demo-react` with Vite `react-ts`; add Vitest, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
2. Add a service-catalogue placeholder (`ServiceCatalogue` component listing seeded services) rendered by `App`.
3. Add `src/__tests__/service-catalogue.test.tsx` with `AC-001: service list renders seeded services`.
4. Configure Vitest reporters `default` + `json` (`reports/vitest-report.json`); scripts `build`, `test`, `test:report`.
5. `.env.example` with `PREVIEW_TARGET_REF` (parameter only), README with the AC-id convention; `git init` + initial commit.
6. Run `npm run build`, `npm test`, `npm run test:report`; check `dist/`, JSON report, `git log`.
7. Append the readiness section to `context/changes/delivery-os-oss-domain/handover/OSS-01-readiness.md` (path, SHA, node, results, AC-id convention).
8. Verify nothing from the demo app is in the open-mercato git tree.

**Success criteria**
- Automated: `npm run build` exits 0 with `dist/`; `npm test` exits 0, AC-001 passes, JSON report exists; `git log` has an initial commit.
- Automated: readiness note contains path, SHA, node, build/test exit codes and AC-id convention; `git status` in open-mercato shows only `context/changes/**`.
- Manual: human acceptance of master-plan row 1.3 (left open).

## References

- `context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md` (OSS-01)
- `context/changes/autonomous-software-delivery/plan.md` (ResultManifest `checks[].testId/acIds`, `rawReportHash`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scaffold, verify, record

#### Automated

- [x] 1.1 Demo repo scaffolded with Vite, React, TS, Vitest and Testing Library
- [x] 1.2 Service-catalogue placeholder and AC-001 test written
- [x] 1.3 build, test and test:report pass; JSON report and dist produced; initial commit made
- [x] 1.4 Readiness note appended in the open-mercato repo and demo app absent from its git tree

#### Manual

- [ ] 1.5 Human acceptance of master-plan Progress row 1.3
