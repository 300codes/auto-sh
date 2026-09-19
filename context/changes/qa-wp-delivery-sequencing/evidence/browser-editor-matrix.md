# Browser editor acceptance checkpoint

The complete repository-native browser regression **passed in run 8** on HEAD `68361d163`, including native fixture cleanup (1 test, 5.6 minutes). Exact source/configuration hashes, assertions and retained-content hashes are recorded in `browser-editor-run-8.json`. Earlier failed/interrupted attempts remain separate evidence; run 7 required narrowly scoped reconciliation after host failure.

| Criterion | Current evidence | Acceptance state |
|---|---|---|
| Native heading, paragraph and CTA edits | Run 8 exact server-side readback before and after rebuild | Passed on owned fixture |
| Replace existing image, alt and rendering | Native Media Library replacement between two owned attachments; exact content, alt and decoded frontend image | Passed; new-file upload not tested |
| Section addition, reordering and deletion | Native UI operations and server-side added/order/removed assertions | Passed |
| Real ACF text and Yoast title/description | Exact native values and frontend SEO metadata | Passed |
| Navigation, header and footer | Real Edit original/keyboard/save; correct owned entity identity and successful save; mandatory native readback | Passed |
| Global Styles | Native Styles layout edit; persisted blockGap 1.5rem unchanged after rebuild | Passed |
| Frontend/editor Tailwind | Both computed padding 32px and stylesheet version equal actual second-build CSS SHA256 | Passed |
| SEO canonical/noindex/sitemap | Canonical absent under pinned Yoast noindex policy; robots noindex; sitemap HTTP 200 and owned page present | Passed for observed policy; noindex does not provide sitemap privacy |
| 3.1 single-language WP-03/04 matrix | One complete current-spec native browser run | **Technical fixture acceptance passed** |
| 3.2 content retention after real update/build | Actual template and CSS hashes changed; page/ACF/SEO/native entities/Global Styles before and after hashes identical | **Passed** |
| 3.2 design-conflict protection | Package theme-update tests cover missing/different/prepared/matching applied design | Separate unit evidence; not browser proof |
| Native fixture cleanup | Run 8 cleaned, zero remaining resources, no operation lock | Passed |
| Persisted local theme changes | Explicitly authorized page-template updates and private before-images/journals | Retained intentionally |
| G1 design approval | Fixture tokens only | Not evaluated; approved design/visual acceptance missing |
| G2 editor permissions | Actual scoped capabilities and authenticated plugins/users HTTP 403 | Technical proof passed; human permission acceptance pending |
| 3.3 human desktop/mobile design acceptance | Private fixture screenshots exist; no approved design or human decision | Not run |

Browser traces/videos are disabled. Credentials, screenshots, storage state and raw private journals are not published. UI changes use native controls and keyboard; `wp.data.select` observations are read-only. All required final values are checked through native server-side readback.

The shared repository runner and discovery remain in use. A private wrapper changes only `use.actionTimeout=20000` and `use.navigationTimeout=60000`; the exact spec ran with CLI `--timeout=900000 --retries=0 --workers=1`. This is an explicit scoped runtime configuration, not an unchanged shared-config run. The temporary owned dependency symlink was removed. The owned WordPress site was stopped after cleanup, and the runtime slot was released to QA.

The authorized single-language Phase 3 implementation and technical regression are complete. Actual design approval, human acceptance and user-deferred translations remain separate outstanding acceptance inputs.
