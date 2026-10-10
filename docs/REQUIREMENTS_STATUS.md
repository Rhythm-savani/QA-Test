# Requirements status

Legend: **done** = implemented and covered by a test (unit `U:` or end-to-end `E:`), **manual** =
implemented, cannot be proven by fixtures; the step is in `REAL_STORE_VALIDATION.md` (`RSV §`),
**partial** / **not done** = see the note. Test names are abbreviated; files are
`tests/*.test.ts` (Vitest) and `e2e/*.spec.ts` (Playwright).

## Run model

| ID                         | Status  | Evidence / note                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RUN-1 popup                | done    | E: popup.spec "default view…" (store card, modes, devices, groups, opt-ins, pinned Run, shortcut hint, options link). Keyboard command `run-check`: manual (RSV §0).                                                                                                                             |
| UI-POPUP-1 customize       | done    | E: popup.spec "Customize: presets switch to Custom…" (4 headings, 11 rows, preset auto-Custom, saved across reopen).                                                                                                                                                                             |
| UI-POPUP-2 permission step | partial | Dialog implemented (popup + report fallback). The E2E build grants the permissions up front, so the prompt itself is manual: RSV §1.3, §2.12.                                                                                                                                                    |
| RUN-2 modes                | done    | E: acceptance "Pages mode…", "Full mode…", "Live tab mode…", "a password-protected storefront…"; popup.spec "Pages mode: list management…" (add/remove/dedupe/cap/external rejected/disabled Run/saved per origin). Non-Shopify notice + hiding Shopify groups: U: run-config; manual RSV §2.11. |
| RUN-3 QA window            | done    | E: "quick run covers all three viewports…" (user tab keeps its document marker, size and URL). Unfocused window behaviour is OS-dependent: RSV §1.4.                                                                                                                                             |
| RUN-4 instrumented load    | done    | E: broken home "console, network and media defects" (exception/rejection/console.error from inline head scripts are captured).                                                                                                                                                                   |
| RUN-5 viewports            | done    | E: "all three viewports by default", "narrowing to one viewport works"; U: options (≥1 viewport kept), run-config. Zero viewports blocked: U + popup.spec "Choose…". Debugger-denied fallback: manual RSV §2.12.                                                                                 |
| RUN-6 Full discovery       | done    | U: sitemap parse/sample/rewrite/dedupe/cap; E: "Full mode samples the sitemap, rewrites origins…" (primary-domain URLs rewritten, preview params carried, cart/search/404 added).                                                                                                                |
| RUN-7 theme consistency    | done    | E: "Full mode…" (`shopify/theme-changed`, row 28).                                                                                                                                                                                                                                               |
| RUN-8 progress and control | done    | E: "cancelling mid-run still restores the cart" (Cancel; partial results kept). Timeouts implemented (`health/page-timeout`); only exercised indirectly.                                                                                                                                         |
| RUN-9 survive suspension   | done    | Orchestrator lives in the report page (DECISIONS D1); run state persisted per page. Closing the tab mid-run: manual RSV §2.13.                                                                                                                                                                   |

## Checks

| ID                         | Status   | Evidence / note                                                                                                                                               |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHK-01 runtime errors      | done     | U: chk01 (kinds, warn visibility, ignore list, collapse); E: broken home rows 1–3.                                                                            |
| CHK-02 network failures    | done     | U: chk02 (same-origin/CDN/third-party/blocked, merge, ignore); E: row 4.                                                                                      |
| CHK-03 media               | done     | U: chk03; E: rows 4–6. Video error state: U only.                                                                                                             |
| CHK-04 links               | done     | U: chk04 (dead anchors, mailto/tel, noopener, broken, cap); E: rows 9–10; clean fixture produces no findings. 429 back-off: implemented, U-untested.          |
| CHK-05 template leftovers  | done     | U: chk05 (classification); E: row 7.                                                                                                                          |
| CHK-06 empty content       | done     | U: chk06; E: row 8 (with screenshot).                                                                                                                         |
| CHK-07 fonts               | done     | U: chk07; E: row 27.                                                                                                                                          |
| CHK-08 layout              | done     | U: chk08 severity mapping; E: rows 11 (mobile only), 12, 25. Fixed/sticky and clipped-text collection: E only through the clean fixture (no false positives). |
| CHK-09 interactions        | done     | E: rows 13–18 + clean fixture passes on all viewports. See INT-*.                                                                                             |
| CHK-10 accessibility       | done     | U: severity mapping, node cap/truncation; E: row 19 (color-contrast, label); clean fixture passes axe A/AA + best-practice.                                   |
| CHK-11 performance         | done     | U: thresholds grading, lcp-lazy, fetchpriority; E: row 20. Numbers labelled indicative.                                                                       |
| CHK-12 page basics         | done     | U: chk12; E: row 24.                                                                                                                                          |
| CHK-13 variants (S)        | done     | U: chk13; E: rows 21–22 and clean product page.                                                                                                               |
| CHK-14 cart badge (S)      | done     | U: chk14; E: row 23.                                                                                                                                          |
| CHK-15 search (S)          | done     | E: clean product page (predictive panel + `/search`). Failure paths: U only.                                                                                  |
| CHK-16 newsletter (S)      | done     | U: chk16 (L1 rules, third party, L2 outcomes); E: row 26 both levels, clean L2 success, unconfirmed L2 never POSTs. Real behaviour: RSV §2.6–2.7.             |
| CHK-17 cart actions (S)    | done     | U: chk17; E: "cart actions leave the cart exactly as it was", "cancelling mid-run…". Real store: RSV §2.8.                                                    |
| CHK-18 custom rules (S)    | partial  | U: validation + analyze. The page-side open/close run is not covered end-to-end (no seeded rule in the fixtures).                                             |
| CHK-19 visual baseline (X) | not done | Stretch; out of v1 scope (DECISIONS).                                                                                                                         |

## Interaction engine and safety

| ID                              | Status   | Evidence / note                                                                                                                                     |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| INT-1 discovery                 | done     | E: engine finds menu/search/cart/accordion/carousel/quick triggers on clean; denylisted controls excluded (note "refused by the click denylist").   |
| INT-2 open test                 | done     | E: `interaction/trigger-no-effect` (row 17).                                                                                                        |
| INT-3 close tests               | done     | E: rows 13–16; backdrop (Info) and focus (Info) emitted on the broken fixture.                                                                      |
| INT-4 restore                   | done     | E: clean fixture leaves state restorable on all viewports; reload-and-resume path exercised by the blocked `/checkout` redirect on the broken home. |
| INT-5 carousels/tabs/accordions | done     | E: row 18; tabs on `/pages/about` pass; accordions are disclosures.                                                                                 |
| INT-6 hover menus (X)           | not done | Stretch; out of v1 scope.                                                                                                                           |
| SAF-1 click denylist            | done     | U: core "click denylist"; E: sentinels (zero `/account/logout`, zero click beacons).                                                                |
| SAF-2 no form submits           | done     | E: zero POSTs with opt-ins off (clean + broken).                                                                                                    |
| SAF-3 checkout off limits       | done     | E: zero hits on `/checkout`, `safety/left-safe-zone` recorded when a script navigates there.                                                        |
| SAF-4 unexpected navigation     | done     | E: same scenario; `interaction/unexpected-navigation` for same-document URL changes is U-untested.                                                  |
| SAF-5 cart cleanup              | done     | E: restore after run and after Cancel.                                                                                                              |
| SAF-6 no outside traffic        | done     | U: prod build has no eval/remote script; CSP asserted.                                                                                              |
| SAF-7 rate limiting             | done     | 150 ms spacing for links and sitemap fetches; 429 handling for both. Not unit tested.                                                               |
| SAF-8 least privilege           | done     | U: prod-build test (debugger and host access optional); debugger asked only when needed (U: run-config).                                            |

## Report, options, non-functional

| ID                            | Status  | Evidence / note                                                                                                                                        |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RPT-1 live report tab         | done    | E: report UI test; progress view during runs.                                                                                                          |
| RPT-2 header                  | done    | E: "report UI".                                                                                                                                        |
| RPT-3 counts, passed, skipped | done    | E: "report UI" (summary line, Passed checks, Skipped).                                                                                                 |
| RPT-4 fingerprint grouping    | done    | U: grouping; E: "findings are grouped by fingerprint".                                                                                                 |
| RPT-5 finding detail          | done    | E: "report UI" (title, severity, rule, selector, snippet, hint, occurrences).                                                                          |
| RPT-6 filters                 | done    | U: filterGroups; E: "report UI" (severity + text).                                                                                                     |
| RPT-7 screenshots             | done    | E: "evidence: visible findings have screenshots, console and network findings do not". Cap logic (120, most severe kept): code only.                   |
| RPT-8 history and compare (S) | done    | U: diffRuns; E: "report UI" compare; history list in the report.                                                                                       |
| RPT-9 export                  | done    | U: exportHtml/Json/Markdown. Download buttons: manual RSV §3.                                                                                          |
| RPT-10 safe rendering         | done    | U: export escaping; E: XSS page (`window.__pwned` undefined, payload shown as text).                                                                   |
| RPT-11 UI a11y (S)            | partial | Real buttons, `aria-pressed`, `role=switch`, visible focus, labels, light/dark, print stylesheet. No automated axe run over the extension's own pages. |
| OPT-1 options                 | done    | U: sanitize/import/export/custom rules; Options page implemented. UI itself is not driven by an E2E test.                                              |
| NFR-1 manifest                | done    | U: prod-build manifest assertions.                                                                                                                     |
| NFR-2 caps                    | done    | Per page: 60 findings per rule, 20 axe nodes, 100 links, 40 interactions, 25 pages, 120 screenshots; truncation is reported.                           |
| NFR-3 one file + one line     | done    | README "Adding a check"; registry is the only list.                                                                                                    |
| NFR-4 crash isolation         | done    | Collect/analyze failures become `errored` (orchestrator). U-untested directly.                                                                         |
| NFR-5 CI (S)                  | done    | `.github/workflows/ci.yml`.                                                                                                                            |
| TST-1/2/3                     | done    | See `tests/`, `fixtures/`, `e2e/`.                                                                                                                     |
