# Preview readiness and pure transition safety review

2026-09-19. Independent review of `preview.ts` and its focused tests. **PASS for read-only readiness and structural transition logic only.** No upload adapter, authenticated approval enforcement, frozen-package transfer or remote revision verification is implemented or certified by this verdict.

Reviewed hashes:

- preview.ts: `47a4206c8fd414609e670f88da63fb2db616c4f84ddfcd5274c05df1c08efdb0`
- preview.test.ts: `c2f86200e141064d06c56be68b2b80d090c6d2244975da1d4933722005c98f0b`

The inspector validates local scope/ownership/Studio registration, checks the pinned CLI version, performs auth status and preview list only, and filters the account-wide response by exact localSiteId. Ambiguous matches and saved-host mismatches fail closed. It does not adopt an observed Preview or treat readiness as publication authority. Private auth output is not returned; unexpected failures become safe codes.

Host handling is HTTPS-only, one bounded DNS label under wp.build, with no credentials, arbitrary port, path, query or fragment. Review corrections now reject raw URL control characters, whitespace/trailing newline and overlong DNS labels. Empty/whitespace listing output now fails instead of falsely establishing absence; recognized no-sites output and a valid empty list remain legitimate absence. Final CLI version line is checked rather than an incidental older-version banner.

Final re-review also accepts an upgrade banner preceding the exact terminal no-sites message. Only that exact final message is interpreted as an empty listing; raw empty output remains an error. This does not turn auth status or readiness into authenticated publication approval.

The pure reducer binds begin to matching declared package hash and target, makes interrupted uploads uncertain, refuses a second begin from uncertain state and requires a matching observed host/revision for its verified state. These values are caller-supplied assertions. A future trusted host must obtain authenticated approvals and independent remote evidence before invoking corresponding events; the reducer itself proves neither. No create/update command or remote install/build is present.

Owner reports four focused tests PASS after corrections. Reviewer inspected implementation and tests without executing publication or starting another runtime. Studio rewriting of URLs/DB and the registered-site-only upload boundary remain explicit host integration work; exact package-hash equality must not be claimed from remote DB bytes without a justified mapping.
