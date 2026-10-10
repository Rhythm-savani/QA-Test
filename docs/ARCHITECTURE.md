# Architecture

```
src/
  background/     service worker: the keyboard command only (thin)
  orchestrator/   run pipeline (run.ts), CDP session (cdp.ts), network safety net (safety-net.ts)
  inject/         instrument.ts (MAIN-world hooks), page.ts (the single injected IIFE bundle)
  checks/         one file per check, registry.ts, rules.ts (every rule slug, title and hint)
  engine/         dom helpers + selector generator, interaction engine, click denylist
  shopify/        sitemap parser and sampler, page-side product/cart helpers
  report/         report page, grouping/filter/diff, exporters
  popup/ options/ extension UIs
  shared/         types, options + validation, storage, IndexedDB, url/money helpers, DOM builder
fixtures/         clean / broken / locked Dawn-like storefronts (plain Node servers)
e2e/              Playwright suites (launch.ts spawns Chrome and loads the extension)
tests/            Vitest unit tests
scripts/          build, icon generation, packaging
```

## Run flow

```
popup / shortcut ──▶ chrome.storage (pending run) ──▶ report.html?run=<id>
                                                          │  (persistent extension page)
                                                          ▼
                              executeRun()  ─ plan pages (Quick | Pages | Full | Live)
                                  │
                                  ├─ QA window + tab(s)      (not for Live tab)
                                  ├─ CdpSession per tab      (optional `debugger` permission)
                                  │     Page/Network/Runtime domains, binding __sqaBinding
                                  ├─ declarativeNetRequest session rules scoped to those tab ids
                                  └─ for each page × viewport:
                                        emulate → navigate → settle → scroll pass
                                        for each enabled check:  executeScript(collect) → analyze()
                                        evidence screenshots (passive findings)
                                        interaction engine (CHK-09) with reload/resume
                                        persist run to IndexedDB, update the live report
```

### Collect / analyze

Every check is `{ collect(ctx): Promise<Data>, analyze(data, ctx): Finding[] }`.

- `collect` runs inside the page (MAIN world) through `window.__sqa.runCollect(id, ctx)`. It
  returns JSON only and must not decide severity.
- `analyze` is a pure function in the report page. Unit tests feed JSON in and compare findings out.
- A throwing check is recorded as `errored`; the run continues (NFR-4).

### Instrumentation

`inject/instrument.ts` installs, before page scripts: `error` and `unhandledrejection` listeners,
CSP violation listener, `console.error/warn` wrappers, `fetch`/XHR wrappers and PerformanceObservers
(LCP, CLS, FCP). Events are buffered on `window.__sqa.events`. `inject/page.ts` adds the API used by
the orchestrator (`runCollect`, `facts`, `settle`, `scrollPass`, `prepareShot`, `makeIO`, RPC) and
in-page click/submit guards.

### Interaction engine

`engine/interactions.ts`: discovery (generic first, Dawn hints second, deny-listed controls skipped),
open test, close tests (hit-test, click, Escape, backdrop, scroll lock, focus), restore, carousels,
tabs. All trusted input and screenshots go through an `IO` object so the engine is independent of
how the orchestrator performs them.

### Safety

Selection: `engine/safety.ts` (built-in list plus user extras; pure string logic is unit tested).
Enforcement: `orchestrator/safety-net.ts` session rules, in-page click/submit guards, and the cart
snapshot/restore bracket around the cart-actions check (`restoreCart` in `orchestrator/run.ts`).

### Persistence

- Options, page lists per origin, last-run summary, pending run requests: `chrome.storage.local`.
- Runs and screenshots: IndexedDB database `storefront-qa` (`runs`, `screenshots`, `baselines`).
  History is pruned to the configured size per origin.

### Rendering untrusted data

Everything derived from the audited page is rendered with `textContent` through `shared/dom.ts`
(`h()`), never `innerHTML`. The HTML exporter escapes every value and only inlines `data:image/jpeg`
or `data:image/png` URLs. Unit and E2E tests prove an XSS payload shows as inert text.

## Build

`scripts/build.mjs` runs Vite three times: extension pages + worker (ES modules), the injected page
bundle (single IIFE), and a copy of `axe-core` as `inject/axe.js`; then writes `manifest.json`.
`--e2e` promotes optional permissions to required and defines `__E2E__`, which gates the
`report.html?auto=1` start hook and the popup's `tabId` override. `--out=<dir>` redirects output.
