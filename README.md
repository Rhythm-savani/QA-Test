# Storefront QA

A Chrome (Manifest V3) extension that audits a Shopify storefront on demand: theme preview URLs, dev
stores and live stores. It finds JavaScript and network errors, broken media, dead links, leftover
Liquid errors, empty sections, layout overflow, covered or unclickable controls, drawers and modals
whose close buttons do not work, accessibility problems, slow pages, variant and cart
inconsistencies, and (opt-in) the newsletter form. Results open in a report page inside the
extension, with evidence screenshots and HTML / JSON / Markdown export.

It only runs when you click **Run** (or press `Alt+Shift+Q`). There is no background activity, no
server, no account and no telemetry. It never edits the store, the theme or any data; the two
checks that change store state (newsletter submit, add to cart) are opt-in and off by default.

> "Storefront QA" is a working name. This repository has no license yet; choose one before sharing.

## Install (unpacked)

```bash
npm ci
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the
`dist/` folder. To use a packaged build: `npm run package` writes
`release/storefront-qa-<version>.zip`; unzip it and load that folder the same way.

## Using it

1. Open a storefront page (a theme preview, a `*.myshopify.com` store or a custom domain) in your
   normal, logged-in browser profile. Password-protected stores must be unlocked first.
2. Click the extension icon. The popup shows the store and theme, then:
   - **Run mode**: _Quick_ (this URL), _Pages_ (a saved list), _Full_ (sampled from the sitemap) or
     _Live tab_ (this tab as it is now).
   - **Devices**: all three sizes (Desktop 1440, Tablet 768, Mobile 390) by default; _Choose_ to
     narrow it. At least one stays on.
   - **Check groups**: _Customize_ for presets (Recommended / All / Custom) and individual switches.
   - **Changes store data**: newsletter form and cart actions, off by default.
3. Press **Run**. A report tab opens and updates live. Quick, Pages and Full open the pages in a
   separate QA window; your own tab is never reloaded, resized or emulated. Live tab analyses the tab
   you are on without reloading it (early console and network events cannot be captured there, and
   interaction checks change page state).

### Modes in detail

| Mode     | What it checks                                                                       | Notes                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Quick    | the active tab's URL                                                                 | fastest way to re-check after a fix                                                                                        |
| Pages    | up to 25 pages you list                                                              | saved per store; entries carry `preview_theme_id` and other preview parameters; external origins are rejected              |
| Full     | home, 3 collections, 3 products, 2 pages, a blog, an article, cart, search and a 404 | sitemap URLs are re-pointed at the audited origin; sample counts, page cap and concurrency are configurable in **Options** |
| Live tab | the active tab, no reload, no emulation                                              | only the viewport the tab already has                                                                                      |

### The report

Summary counts, issue groups (findings with the same fingerprint are merged into "seen on N pages /
viewports"), filters by severity, category, page and viewport plus text search, a "Passed checks" list
so you can see what was actually verified, a "Skipped" list with reasons, run history per store and
a compare view (New / Fixed / Unchanged). Findings that point at a visible element carry an outlined
evidence screenshot; console and network findings show their message, URL or selector instead.
Export as a standalone HTML file (screenshots inlined, no external requests), JSON, or a Markdown
summary copied to the clipboard.

## Permissions: what each is for and when it is asked

| Permission                                        | Why                                                                                     | When                                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `storage`, `unlimitedStorage`                     | options, page lists, run history and screenshots (IndexedDB)                            | install                                                                                                                        |
| `activeTab`                                       | read the Shopify theme of the tab you opened the popup on, and analyse it in Live tab   | when you open the popup or use the shortcut                                                                                    |
| `scripting`                                       | inject the instrumentation and collectors into QA tabs                                  | install                                                                                                                        |
| `webNavigation`                                   | know when a QA page has loaded, and record attempts to leave the safe zone              | install                                                                                                                        |
| `declarativeNetRequestWithHostAccess`             | network-level safety net: block checkout navigation and unrequested cart/contact POSTs  | install                                                                                                                        |
| optional host access (`http(s)://<store host>/*`) | open and instrument the store in the QA window                                          | first run for that store, with a plain-language prompt                                                                         |
| optional `debugger`                               | tablet and mobile emulation, trusted clicks and keys, evidence screenshots, early hooks | first run that needs it (non-desktop viewport or screenshots), with a mock of Chrome's "started debugging this browser" banner |

If a permission is declined the affected parts are listed as **skipped** in the report and the run
continues with what it can do (for example desktop only, no screenshots). Only the QA window is
debugged; your own tabs are not.

## Safety rules

- Never clicks elements whose text, accessible name, `href` or `action` matches: log out, sign out,
  delete, remove account, checkout, pay, place order, buy it now, subscribe, submit, send, apply (plus
  add to cart / remove, which belong to the opt-in cart check). **Options** can extend this list but not
  shrink it.
- No form submits except the newsletter Level 2 and cart actions checks when you opted in.
- Checkout is off limits: navigation to `/checkout*` or `/cart/c/*` is blocked at the network level
  and recorded as `safety/left-safe-zone`.
- Cart actions snapshot `/cart.js` first, remove only the lines the test added, restore on cancel and
  on error, and the report states whether the cart ended exactly as it began.
- The extension only talks to the audited origin and to what the page itself loads. No eval, no
  remote code, strict extension CSP.

## Adding a check

A check is one file plus one registry line.

1. Create `src/checks/chk19-my-check.ts` exporting a `Check` (see `src/shared/types.ts`):

   ```ts
   export const chk19: Check<{ count: number }> = {
     id: 'CHK-19',
     title: 'My check',
     category: 'health',
     group: 'health', // which popup/options group toggles it
     mutatesState: false,
     defaultEnabled: true,
     viewportScope: 'first', // or 'each'
     async collect(ctx) {
       /* runs in the page: return plain JSON */
     },
     analyze(data, ctx) {
       /* pure: JSON in, Finding[] out (use makeFinding) */
     },
   };
   ```

2. Add `chk19` to `src/checks/registry.ts`.
3. Add any new rule slugs to `src/checks/rules.ts` (title, category, fix hint).
4. Unit test `analyze` by feeding JSON in (see `tests/checks.test.ts`).

`collect` runs in the page's MAIN world, `analyze` in the report page. A check that throws becomes
`errored` in the report; the run continues.

## Development

```bash
npm run lint         # eslint + prettier --check
npm run typecheck    # tsc --noEmit
npm test             # vitest unit tests (includes a production-build hook check)
npm run build        # production build -> dist/
npm run test:e2e     # builds with E2E hooks, then runs Playwright against the fixture sites
npm run package      # release/storefront-qa-<version>.zip (build first)
```

Fixture sites live in `fixtures/` (`clean`, `broken`, `locked`) and are started by the tests; run
`node fixtures/server.mjs` to browse them by hand. End-to-end tests drive a real Chrome through the
DevTools protocol; set `SQA_CHROME` to a Chrome/Chromium executable if it is not found, and
`SQA_HEADED=1` to watch. Extensions load via `Extensions.loadUnpacked` because branded Chrome 137+
ignores `--load-extension`. On Linux CI run under `xvfb-run` if headless cannot load extensions.

The E2E build (`--e2e`) promotes `debugger` and host access to required permissions and enables a
`report.html?auto=1&...` start hook. The hook is compiled out of the production build; a unit test
proves it.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md),
[docs/REQUIREMENTS_STATUS.md](docs/REQUIREMENTS_STATUS.md) and
[docs/REAL_STORE_VALIDATION.md](docs/REAL_STORE_VALIDATION.md).

## Known limitations

- Performance numbers are measured in your own browser and are indicative only. Lighthouse is not
  bundled.
- Third-party newsletter forms (Klaviyo, Mailchimp, Omnisend, Privy, ...) are detected but not
  tested ("form detected, not testable").
- AI screenshot review is not part of v1. Hover-menu testing (INT-6) needs the debugging permission
  (trusted mouse input) and is desktop only.
- The visual baseline (CHK-19, off by default, enable it in Options) compares a viewport capture with
  the saved baseline per store, path and viewport. Masked regions (video, iframes, carousels by
  default) are blanked out; the diff threshold is configurable.
- Full mode samples pages; it is not a crawler. Links are checked per page (cap 100) with HEAD,
  falling back to GET; external links are only reachability-checked when enabled.
- Only Chromium browsers are supported. The bundled UI fonts fall back to system fonts (no remote
  fonts are loaded, by design).
- The service worker is intentionally thin; closing the report tab during a run stops that run
  (partial results are kept and marked interrupted).
