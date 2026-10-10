# Decisions log

Each entry: decision, alternatives considered, reason. Where a design file and a requirement
disagreed the requirement won; those are listed at the end.

## Architecture

**D1. Orchestrate runs from the report page, not the service worker (RUN-9).**
Alternatives: orchestrate in the worker and checkpoint / keep it alive. An open extension tab cannot
be suspended mid-run, and `chrome.debugger`, `chrome.scripting` and `chrome.webNavigation` are all
available to extension pages, so the worker stays a thin command handler. State is still persisted to
IndexedDB after every page-viewport so a closed tab leaves an `interrupted` run with partial results.

**D2. One shared check registry; `collect` runs in the page, `analyze` in the report page.**
Alternative: two registries (page bundle and orchestrator bundle). A single `registry.ts` keeps "one
file plus one registry line" literally true; the unused half of each check is a few kilobytes of
dead code in each bundle. axe-core is the exception: it is injected as a separate file only when
CHK-10 runs, so the ~600 KB library is not parsed on every page.

**D3. Early instrumentation (RUN-4).**
Primary: `Page.addScriptToEvaluateOnNewDocument` over the debugger when it is attached (it runs
before any page script, reliably). Fallback: `webNavigation.onCommitted` +
`scripting.executeScript({world: 'MAIN', injectImmediately: true})`, which is documented as
best-effort ordering. Both paths guard on `window.__sqa` so double installation is harmless. Only QA
tabs are ever injected at navigation time.

**D4. Network failures (CHK-02) use page hooks, Resource Timing and, when attached, the CDP Network
domain; no `webRequest`.**
`webRequest` would need broad host permissions in the manifest for little gain. Page hooks catch
element load errors and failing fetch/XHR; `responseStatus` from Resource Timing catches same-origin
status codes; CDP adds cross-origin statuses and `net::ERR_BLOCKED_BY_CLIENT`. Results are merged and
de-duplicated by URL and status.

**D5. Safety is enforced twice (SAF-1..3).**
Selection logic (denylist) plus a network net: `declarativeNetRequest` session rules scoped to QA
tab ids block checkout navigation, `/account/logout` navigation and, unless opted in, POSTs to
`/cart/add|change|update|clear` and `/contact`. This makes "zero hits on /checkout" independent of
any bug in element selection. Uses `declarativeNetRequestWithHostAccess` (no install warning; rules
apply only to hosts the user granted).

**D6. The interaction engine runs page-side; trusted input and screenshots go over a CDP binding.**
Alternative: drive every step from the orchestrator. The binding (`Runtime.addBinding`) lets the
page-side loop request a trusted click, key press or evidence screenshot and wait for the answer,
which keeps the engine one coherent, testable module. Without the debugger it falls back to
synthetic pointer events + `element.click()`. Progress is also streamed through the binding so a
mid-run navigation (for example a blocked checkout redirect) loses nothing; the driver reloads and
resumes after the last attempted candidate.

**D7. Mobile click coordinates are mapped through `visualViewport`.**
When a page overflows horizontally the mobile emulation zooms out; `Input.dispatchMouseEvent` works in
visual-viewport space, so layout coordinates would miss. Found with the seeded overflow fixture.

**D8. Newsletter Level 2 submits with `fetch` and the form's own `FormData`.**
Alternative: a real form submit (navigation). `fetch` follows the same redirect and lets the check
read the resulting page for the success state without losing the page context. `/challenge` or a
captcha in the response is reported as "blocked by captcha, cannot test" (Info).

**D9. Evidence screenshots: capture many, keep the 120 most severe.**
Screenshots are captured as findings appear (up to 3x the cap), then trimmed at the end of the run by
severity (errors, then warnings, then info). The report says how many were dropped. One capture per
fingerprint per viewport, from the first occurrence.

**D10. Page budget is per page-viewport visit** (default 90 s), not per page across viewports.
Each viewport is a fresh load and a full set of checks, so a per-page budget would starve later
viewports.

## Permissions and packaging

**D11. Debugger permission is requested only when a run needs it** (a non-desktop viewport or
screenshots on). A desktop-only run with screenshots off never asks. `minimum_chrome_version` is
116 (`world: 'MAIN'`, `injectImmediately`, session-rule `tabIds`, `checkVisibility`).

**D12. Extra permissions beyond the brief's list:** `webNavigation` (required by the brief's
RUN-4/SAF-3 mechanisms), `declarativeNetRequestWithHostAccess` (D5), `activeTab` (read the active
tab without a broad grant), `unlimitedStorage` (screenshots).

**D13. UI fonts are not loaded from Google Fonts.** The design files link them, but SAF-6 forbids
outside traffic and the extension CSP blocks it. The CSS lists Instrument Sans / JetBrains Mono first
and falls back to system fonts; bundling the font files is a follow-up if the licence allows.

**D14. Placeholder icons are generated by `scripts/make-icons.mjs`** (no image dependency).

## Checks

**D15. axe-core experimental rules are filtered out** even though tag-based `runOnly` enables them.
Rules still map `critical|serious → error`, `moderate → warning`, `minor → info`.

**D16. Links check:** pure `#fragment` hrefs are not fetched (they point at the current document, which
is a 404 on the guaranteed-404 sample). Protected URLs (`/checkout*`, `/account/logout`) are never
fetched, not even with HEAD.

**D17. Tap targets:** inline links inside running text are exempt (WCAG 2.5.8); everything else under
24x24 CSS px is a Warning on mobile and tablet.

**D18. Horizontal overflow only counts content extending past the right edge**, because only that
creates a scrollbar (skip links parked at a negative `left` are not overflow).

**D19. Click denylist additions:** besides the brief's list, "add to cart/bag", "remove", "buy",
"purchase" and "unsubscribe" are never clicked by the generic engine because they would change cart
or subscription state, which is opt-in only.

**D20. The guaranteed-404 sample** (`/pages/storefront-qa-404-check`) is flagged `expect404`; its
document response is not reported as a network failure. A real 4xx/5xx document on any other page is.

**D21. Theme consistency (RUN-7):** a mismatch is reported against both the first page's theme id and
the `preview_theme_id` of the start URL.

## Testing

**D22. E2E loads the extension with `Extensions.loadUnpacked`** (`--enable-unsafe-extension-debugging`)
against a browser the harness spawns itself. Branded Chrome 137+ ignores `--load-extension`, and in
this environment Playwright's bundled Chromium would not start (side-by-side manifest error).
`SQA_CHROME` selects another executable.

**D23. Timing thresholds are relaxed in E2E** (FCP/LCP/TTFB) because headless timings vary by machine
and the clean-fixture "zero warnings" assertion must not be flaky. Unit tests cover the grading.

**D24. The LCP fixture image is seeded noise (PNG).** Chrome ignores low-entropy images for LCP, so a
flat SVG never becomes the LCP element.

**D25. Extra dev dependencies** beyond the brief: `@eslint/js` and `typescript-eslint` (needed for
ESLint on TypeScript), `jsdom` (DOM environment for the selector generator and exporter tests),
`@playwright/test` (the Playwright runner), `@types/chrome` and `@types/node`.

## Design vs requirements

- The popup's pinned footer link reads "Last run N min ago · X errors" and opens the stored report;
  the design's sample numbers are not used.
- "Evidence screenshots" and "Debugging permission: Granted / Revoke" appear in Options as designed;
  the screenshot switch is stored as `screenshots`.
- The Options page's performance thresholds are shown in seconds (as designed) and stored in
  milliseconds.

## Stretch items

**D26. CHK-19 visual baseline** stores one capture per run, origin, path and viewport under the
`baselines` object store and promotes them with "Save this run as baseline". Captures are scaled to at
most 800 px wide JPEG (the same capture path as evidence), so a diff is a coarse regression signal, not
a pixel-perfect one. Mask regions come from a selector list (default: video, iframe, slider-component,
carousels) instead of an interactive mask editor. `pixelmatch` is the only added runtime dependency.

**D27. INT-6 hover menus** only run on the desktop viewport with trusted input, over top-level `nav li`
items whose submenu is hidden until hover. They report "does not open" and "clipped or covered".

## Not done

- AI screenshot review (out of scope for v1).
- Interactive mask editor for CHK-19.
