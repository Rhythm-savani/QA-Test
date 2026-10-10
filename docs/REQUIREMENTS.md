<!-- Source of truth for requirement IDs. Copied from the original build brief. -->
# 1. ROLE AND OUTCOME

You are a senior engineer working alone, end to end, in the current git repository. Build **Storefront QA**: a Chrome (Manifest V3) extension that a Shopify theme developer runs on demand against a storefront (a theme preview URL, a dev store or a live store) to automatically find what is broken or off. It looks for JavaScript and network errors, broken media, dead links, leftover Liquid errors, empty sections, layout overflow, overlapping or unclickable elements, drawers and modals whose close buttons do not work, accessibility problems, slow pages, product-variant and cart inconsistencies, and optionally the newsletter form. The result is a report inside the extension.

Deliver a working, tested, documented, committed repository. "Done" is defined in section 11.

# 2. WORKING RULES

- **Autonomy.** Do not ask questions. When something is ambiguous, make the most reasonable decision and record it in `docs/DECISIONS.md` (decision, alternatives, reason). Stop only if the task becomes impossible, and then say exactly what blocks it.
- **Git.** The repository is the working directory. Run `git status` and `git remote -v` first. Work on a branch named `feat/v1`. Commit after every milestone (section 10) using Conventional Commit messages. Push after each milestone if the remote is reachable; if it is not, keep committing locally and say so at the end. Never force-push, never rewrite history, and never commit secrets, `node_modules`, `dist` or `release` output. Add a proper `.gitignore`.
- **Verify before relying on memory.** Extension APIs change: service-worker lifetime, per-tab script injection at navigation commit, `chrome.debugger` (Emulation, Page, Input, Network), optional permissions, `webNavigation`, `webRequest`. Check current Chrome extension docs and the Dawn source (github.com/Shopify/dawn) with your web tools if you have them. When something cannot be verified, take the more conservative approach and note it in `docs/DECISIONS.md`.
- **Honesty.** Never claim a requirement works unless a test or a real run proved it. Anything fixtures cannot prove goes into `docs/REAL_STORE_VALIDATION.md` as a manual check for the developer. Report failures and gaps plainly at the end.
- **Scope discipline.** Requirements are tagged (M) must, (S) should, (X) stretch. Finish every (M), fully tested, before starting any (S). Start (X) only when everything else is green.
- **Quality.** TypeScript in strict mode, ESLint and Prettier clean, no `any` without a justifying comment, comments explain why and not what, small modules. Keep check logic pure and unit-testable and keep it separate from `chrome.*` calls.
- **Dependencies.** Keep them few: typescript, vite, vitest, playwright, eslint, prettier, axe-core, plus pixelmatch only for the stretch goal. Any other dependency needs a line in `docs/DECISIONS.md`.

# 3. PRODUCT DECISIONS ALREADY MADE (do not revisit)

- Chrome extension, Manifest V3, Chromium browsers only. It runs only when the user clicks Run or presses the shortcut. No background or scheduled activity.
- It checks whichever storefront the active tab is on: a theme preview (`?preview_theme_id=`), a `*.myshopify.com` store, or a custom domain. It never handles passwords. It runs in the user's own logged-in browser profile, so previews and unlocked password-protected stores just work.
- No checkout testing of any kind. The extension never navigates to or interacts with checkout.
- No ClickUp or any other task-manager integration. Output stays inside the extension and its exports.
- No AI or LLM screenshot review in v1. No servers, accounts, cloud, telemetry or analytics.
- Flag, don't fix. The extension never edits the store, the theme or any data.
- The newsletter check is an on/off option, off by default. Every check that changes store-side state (newsletter submit, add to cart) is opt-in and off by default. All other checks are read-only.

# 4. RUN MODEL

- **RUN-1 (M) Popup.** Must fit Chrome's popup limit (about 600 px tall): the content area scrolls and the Run button stays pinned at the bottom. Top to bottom: store card, mode selector (Quick / Pages / Full / Live tab), the Pages list card when Pages is selected, Devices card, Check groups card, the "Changes store data" opt-ins (newsletter, cart actions, off by default), then the pinned Run button with a "last run" link and the shortcut hint. Also a keyboard command `run-check` that starts the last-used mode (suggest Alt+Shift+Q), and a link to the options page.
  - **Devices card (default view).** A small "All devices / Choose" segmented control. "All devices" is the default and shows Desktop 1440, Tablet 768 and Mobile 390 as three informational tiles, not as selected buttons. "Choose" turns the tiles into toggle buttons (`aria-pressed`) where at least one must stay on. A one-line note under them says mobile and tablet use the debugging permission. Saved choice is kept in options.
  - **Check groups card (default view).** Collapsed: the title, an "N of 11 on" count, a segmented meter (one segment per group, filled when on), a one-line summary of what is off, and a "Customize" button. "Customize" expands the card in place into the full list (see UI-POPUP-1). Do not render eleven toggle chips in the collapsed view.
- **UI-POPUP-1 (M) Customize view.** Expanded check groups: a preset control (Recommended / All / Custom, where Custom is selected automatically when the user changes any single switch), then the groups under four headings with one row each (icon, name, one-line description, switch): Page health (Health, Links, Page basics); Content and looks (Media, Content, Layout); Behaviour (Interactions, Accessibility, Performance); Shopify and custom (Shopify reads, Custom rules). Same on/off functionality and same saved options as before, only the presentation changes. "Recommended" is every group on except Custom rules, which stays off until the user has defined rules.
- **UI-POPUP-2 (M) Permission step.** The debugging-permission explanation (dialog with a mock of Chrome's banner text) appears at the start of the first run that needs it, with "Allow" and "Skip these checks" choices.
- **RUN-2 (M) Modes.**
  - Quick: check only the active tab's URL.
  - Pages: check only a user-chosen list of pages, with no sitemap crawl. The popup shows a "Pages to check" card: one row per entry (path in monospace, remove button), a text field accepting a full URL or a `/path` with an Add button, and an "Add this page" button that appends the active tab's path (the first row is tagged "this tab" when it matches). Entries are normalised to the active tab's origin, carry over `preview_theme_id` and other preview parameters from the start URL (as in RUN-6), are deduplicated and capped at 25. External origins are rejected with a message. The list is saved per origin in `chrome.storage.local` so it can be re-run after a fix, and the Run button reads "Run Pages check · N pages" and is disabled with a hint when the list is empty. Each page is checked at every enabled viewport, in the QA window, with the same checks, screenshots and report as Full mode. The "last-used mode" keyboard command also replays the saved list.
  - Full: crawl a sampled set of pages (RUN-6).
  - Live tab: analyse the active tab as it is right now, with no reload. Early console and network events cannot be captured in this mode, so the report must say so. Interaction checks warn that they change the page state.
  - If the active tab is not http(s), show a clear message. If the page is not a Shopify store (no `window.Shopify`), still run the generic checks, hide the Shopify-specific groups and show a notice. If the storefront redirects to `/password`, stop with a message telling the user to unlock it in their browser first.
- **RUN-3 (M) QA window.** Quick, Pages and Full open pages in a dedicated, separate browser window (unfocused where the OS allows). The user's own tab is never reloaded, resized or emulated, except in Live tab mode. The window is closed at the end unless the option "keep QA window open" is on.
- **RUN-4 (M) Instrumented load.** Hooks are installed before any page script runs, so early errors and requests are captured. Use per-tab injection at navigation commit (for example `webNavigation.onCommitted` plus `scripting.executeScript` with `world: 'MAIN'` and `injectImmediately: true`), applied only to QA tabs. After `load`, wait for the page to settle (no network activity for about 1 s, hard cap 10 s), then scroll through the page in steps to trigger lazy-loaded content, return to the top, and only then run checks.
- **RUN-5 (M) Viewports.** Every run checks all three viewports by default: Desktop 1440x900, Tablet 768x1024 and Mobile 390x844 (DPR 3, touch, mobile flag). The user can narrow this ("Choose" in the popup, or the viewport cards in options) but at least one viewport must stay on, and the Run button is disabled with a hint if none is. Each page is checked at each enabled viewport, one viewport after another on the same QA tab. Emulate via the debugger Emulation API on QA tabs only. Non-desktop viewports and evidence screenshots need the debugger permission, requested at the start of the first run that needs it with a plain-language reason (see UI-POPUP-2). If it is denied, skip those parts, run Desktop only, and say so in the report as skipped. Live tab mode never emulates: it checks the viewport the tab already has.
- **RUN-6 (M) Full-mode discovery and shared page rules.** Read `/sitemap.xml` from the active tab's origin and follow child sitemaps. Sample per type, with defaults home 1, collections 3, products 3, pages 2, blog 1, article 1. Always add `/cart`, `/search?q=a` and a guaranteed-404 URL. Let the user edit the counts and add custom paths. Deduplicate. Sitemaps list the primary domain, so rewrite each URL to the active tab's origin. Carry over `preview_theme_id` and any other preview parameters present on the start URL to every visited URL. Cap total pages (default 25). Concurrency default 1, maximum 3. Choose one product, one collection and so on deterministically (for example the first N) so runs are comparable.
- **RUN-7 (M) Theme consistency.** On every page read `window.Shopify.theme` (id, name, role, schema_name, schema_version) and show it in the report header. Raise an Error finding (`shopify/theme-changed`) if the theme id differs between pages of one run, or if the start URL had `preview_theme_id` and a visited page is not showing that theme.
- **RUN-8 (M) Progress and control.** Live progress (page x of y, current check), a Cancel button, partial results kept on cancel. Timeouts: page load 30 s, per-page budget 90 s. A page that times out is reported as a finding and is not fatal to the run.
- **RUN-9 (M) Survive MV3 suspension.** The service worker can be suspended mid-run. Orchestrate the run from a persistent extension page (the run/report page, which stays open) and use the service worker only for privileged calls, or checkpoint state and keep the worker alive. Whichever you pick, a long run must not die silently. Persist run state after each page.

# 5. CHECKS

Each check group is a toggle in the popup and options.

| Group | Checks | Default | Changes store state |
|---|---|---|---|
| Health | CHK-01, CHK-02 | on | no |
| Media | CHK-03 | on | no |
| Links | CHK-04 | on | no |
| Content | CHK-05, CHK-06, CHK-07 | on | no |
| Layout | CHK-08 | on | no |
| Interactions | CHK-09 | on | no |
| Accessibility | CHK-10 | on | no |
| Performance | CHK-11 | on | no |
| Page basics | CHK-12 | on | no |
| Shopify reads | CHK-13, CHK-14, CHK-15 | on | no (GET requests only) |
| Newsletter | CHK-16 | **off** | yes, at level 2 only |
| Cart actions | CHK-17 | **off** | yes |
| Custom rules | CHK-18 | on if rules exist | per rule |
| Visual baseline | CHK-19 (X) | off | no |

Severity scale: Error (broken for users), Warning (probably wrong or risky), Info (worth knowing).

- **CHK-01 (M) Runtime errors.** Uncaught exceptions, unhandled promise rejections, `console.error` calls and CSP violations are Errors. `console.warn` is Info and hidden unless the option is on. Include message, source file, line and top stack frame. Support an ignore list of regexes.
- **CHK-02 (M) Network failures.** HTTP 4xx/5xx and failed requests for any page resource or fetch/XHR. Same-origin and Shopify CDN failures are Errors, other third-party failures are Warnings, and `net::ERR_BLOCKED_BY_CLIENT` is Info. Report URL, status and initiator type. Collapse repeats. Use `webRequest` or the CDP Network domain, whichever you verify works best with minimal permissions.
- **CHK-03 (M) Media.** Broken images (judged after the lazy-load scroll), a missing `alt` attribute (`alt=""` is valid and not flagged), stretched images (rendered aspect ratio more than 5 percent from the natural one with `object-fit: fill`), videos in an error state, and oversized images (natural width more than 2x the rendered width times DPR, Info).
- **CHK-04 (M) Links.** Check same-origin links with HEAD, falling back to GET. Cap 100 per page, with a run-wide cache. 404/5xx is an Error. Empty, `#` or `javascript:` hrefs on non-button elements are Warnings. Malformed `mailto:` or `tel:` is a Warning. `target=_blank` without `rel=noopener` is Info. External links are not fetched unless the option is on.
- **CHK-05 (M) Template leftovers.** Visible text and attributes (`alt`, `aria-label`, `placeholder`, `title`) matching `Liquid error`, `Liquid syntax error`, `translation missing`, raw `{{` or `{%`, `[object Object]`, and standalone `undefined`, `null` or `NaN` in text nodes. `Lorem ipsum` is a Warning. Rules: `content/liquid-error`, `content/translation-missing`, `content/raw-template-syntax`, `content/placeholder-text`.
- **CHK-06 (M) Empty content.** Elements with id prefix `shopify-section-` that render with zero visible height or no visible text, media or controls. Warning, or Info for header, footer and announcement sections. Headings with no text are Warnings. Report the section type parsed from the id.
- **CHK-07 (M) Fonts.** Any `document.fonts` entry in status `error` is a Warning (`content/font-failed`).
- **CHK-08 (M) Layout, per viewport.**
  - Horizontal overflow: `documentElement.scrollWidth > clientWidth + 1`. Name up to 5 offending elements. Error on mobile and tablet, Warning on desktop.
  - Obscured interactive elements: for each visible interactive element (`a[href]`, `button`, `input`, `select`, `textarea`, `[role=button]`, `summary`), scroll it into view and run `elementFromPoint` at its centre and one off-centre point. If the topmost element is not the element, a descendant or an ancestor, report an Error naming the covering element.
  - Clipped text: `overflow:hidden` elements (not ellipsis or line-clamp) whose scroll size exceeds client size by more than 2 px and which contain text. Info.
  - Tap targets on mobile and tablet: interactive elements under 24x24 CSS px are Warnings. A "strict" option also reports anything under 44x44 as Info.
  - Fixed or sticky elements covering more than 35 percent of the mobile viewport height are Warnings.
- **CHK-09 (M) Interactions.** See section 6.
- **CHK-10 (M) Accessibility.** Bundle axe-core and run it with WCAG 2.0/2.1 A and AA plus best-practice rules. Map impact: critical or serious to Error, moderate to Warning, minor to Info. Cap 20 nodes per rule per page. Include rule id, help URL, selector, HTML snippet and failure summary. Rules are named `a11y/axe:<ruleId>`.
- **CHK-11 (M) Performance.** At the first viewport only, record TTFB, FCP, LCP (identify the LCP element and flag `loading="lazy"` on it as Warning `performance/lcp-lazy`, and a missing `fetchpriority="high"` as Info), CLS (top shifting elements if available), total transfer size, request count, third-party host count, render-blocking head scripts, and DOM node count. Use configurable web.dev thresholds (LCP 2.5 s and 4 s, CLS 0.1 and 0.25, TTFB 0.8 s and 1.8 s, FCP 1.8 s and 3 s): Warning for "needs improvement", Error for "poor". Always label the numbers as indicative, since they are measured in the developer's browser. Do not bundle Lighthouse.
- **CHK-12 (M) Page basics.** `<title>` present, non-empty and not "undefined"; meta description present; exactly one `h1` (Warning for none or several); `<html lang>`; viewport meta; canonical. `noindex` is Info only, since preview themes are noindex by design. Rules are named `seo/*`.
- **CHK-13 (S) Product variants (product pages, read-only).** Fetch `/products/<handle>.js` as ground truth. For up to N variants (default 8), select each through the UI and verify: the URL gets `variant=<id>` (Info if the theme doesn't); the displayed price equals the JSON price after normalising money text to digits (Error `shopify/variant-price-mismatch`); the add-to-cart state matches `available` (Error `shopify/variant-availability-mismatch`); the main media changes when the variant has a featured image (Warning, best effort); no console errors during the change. Restore the original selection afterwards.
- **CHK-14 (S) Cart badge (read-only).** Compare the header cart-count badge with `/cart.js` `item_count`. Mismatch is an Error `shopify/cart-badge-mismatch`. Skip if there is no badge.
- **CHK-15 (S) Search (GET only).** Open the search UI, type the query (default "a", configurable), verify the predictive panel or results appear without console errors, and verify `/search?q=` renders results or a proper empty state.
- **CHK-16 (S) Newsletter (opt-in).** Detect the form: Dawn's `form` with `input[name="contact[email]"]` and `form_type=customer`. Detect third-party forms (Klaviyo, Mailchimp, Omnisend, Privy and similar) and report "form detected, not testable" as Info instead of guessing.
  - Level 1 (no submit, no state change): the input is `type=email`, `required`, has an accessible name; the submit control exists and is enabled; the form `action` and `method` are sensible; the message regions exist. Use `checkValidity()` with empty and invalid values and never submit. Rules: `newsletter/form-invalid`.
  - Level 2 (submits, creates a real subscriber): submit the configured test address (for example `name+qa@domain.com`). Expect the success state (Dawn redirects with `customer_posted=true` and shows `.newsletter-form__message--success`). Handle `/challenge` captcha as "blocked by captcha, cannot test" (Info). Rule: `newsletter/no-success-state`. The report must state which test address was submitted and that it needs removing from the store manually. Show a one-time confirmation before the first Level 2 run.
- **CHK-17 (S) Cart actions (opt-in).** On a product page, choose the first available variant and click add to cart. Within 3 s verify the drawer, notification or cart page shows the item, that `/cart.js` has +1 line, and that the badge updated. Change quantity +1 then -1 and verify subtotal and `/cart.js` agree. Remove the item and verify the empty state. Cleanup is covered in SAF-5.
- **CHK-18 (S) Custom rules.** A JSON list in options, run through the same open and close engine, so developers can cover custom features such as a wishlist drawer or quote form. Shape: `{ "name", "urlPattern", "trigger", "expectVisible", "close", "closeExpectHidden" }`. Validate it in the options UI with clear errors and ship working examples.
- **CHK-19 (X) Visual baseline.** "Save this run as baseline" per origin, path and viewport. On later runs, diff screenshots (pixelmatch, with a masking option for carousels and video) and show overlays. Off by default.

# 6. INTERACTION ENGINE (CHK-09)

- **INT-1 (M) Discovery.** Generic first, Dawn hints second (appendix A). Candidates are visible, enabled elements that are `summary` inside `details`, or have `[aria-expanded]`, `[aria-controls]`, `[aria-haspopup]`, `[role=tab]`, `data-modal` or `data-drawer` style attributes, or are buttons whose accessible name or class suggests open, menu, search, cart, filter, quick view, size guide and so on. Also include carousel next and previous buttons. Skip anchors with a real `href` (they navigate) except known JS-intercepted ones such as Dawn's cart icon when `cart-drawer` exists. Cap 40 candidates per page (configurable).
- **INT-2 (M) Open test.** Scroll the trigger into view, record the baseline state, click it (trusted CDP input if the debugger is attached, otherwise `element.click()` plus pointer events), then wait up to 1.5 s for an observable change: `aria-expanded` true, `open` attribute, target visibility, a new visible dialog or drawer, or class changes. No change at all is a Warning `interaction/trigger-no-effect` (Info when the element cannot be classified).
- **INT-3 (M) Close tests**, for each container that opened:
  - Every close control inside it (accessible name or text containing close, dismiss or ×, `.modal__close-button`, `.drawer__close`, `button[class*=close]`, or the `summary` of a disclosure) is hit-tested first. Covered means Error `interaction/close-obscured`. Then click it. Still open after 1.5 s means Error `interaction/close-no-effect`.
  - Reopen and press Escape. Not closing is a Warning `interaction/escape-not-closing`.
  - Reopen and click the backdrop (only for modal or drawer patterns). Not closing is Info.
  - After closing, scroll lock must be released (compare `overflow` and `position` on html and body plus known lock classes such as `overflow-hidden`). Still locked is Error `interaction/scroll-lock-stuck`.
  - Focus moving into the dialog on open and returning to the trigger on close are Info.
- **INT-4 (M) Restore.** After each test leave the page as found. If that is impossible, reload the QA tab and continue with the next candidate.
- **INT-5 (M) Carousels, tabs, accordions.** Carousels: click next, verify scroll position, transform or `aria-current` changed unless at the end and disabled, then previous. No effect is Warning `interaction/carousel-no-effect`. Tabs and accordions: activate and verify the matching panel shows and the others hide.
- **INT-6 (X) Hover menus (desktop).** Hover top-level nav items with submenus and verify the submenu appears and is not clipped.

# 7. SAFETY RULES (non-negotiable, and tested)

- **SAF-1 (M) Click denylist.** Never click elements whose text, accessible name, `href` or `action` matches: log out, sign out, delete, remove account, checkout, pay, place order, buy it now, subscribe, submit, send, apply. Also never click inside dynamic checkout or payment buttons (`.shopify-payment-button`, `shopify-accelerated-checkout` and similar). The options page can extend the list but not shrink the built-in part.
- **SAF-2 (M) No form submits** except the newsletter Level 2 and cart actions when explicitly opted in.
- **SAF-3 (M) Checkout is off limits.** Detect any navigation of a QA tab to `/checkout*` or `/cart/c/*`, cancel or close it, and record `safety/left-safe-zone`. A request to checkout must never be made on purpose.
- **SAF-4 (M) Unexpected navigation.** After each interaction, verify the tab URL is unchanged. If it changed, record it, return to the page, and skip the rest of that element's tests.
- **SAF-5 (M) Cart cleanup.** Before cart actions, snapshot `/cart.js`. Afterwards remove only the lines the test added (via `/cart/change.js`), also on cancel and on error as best effort, and report whether the cart ended exactly as it began. Show a one-time confirmation before the first cart-actions run explaining what changes.
- **SAF-6 (M) No outside traffic.** The extension makes requests only to the audited origin and to what the page itself loads. No telemetry, no remote code, no `eval`, strict extension CSP.
- **SAF-7 (M) Rate limiting.** At least 150 ms between the extension's own fetches to the store. On HTTP 429, back off and report it.
- **SAF-8 (M) Least privilege.** Request optional permissions (`debugger`, broad host access) only at the moment of use, with a plain-language reason. Everything must degrade gracefully when a permission is denied: the affected checks are marked "skipped, permission not granted" in the report.

# 8. REPORT, OPTIONS, NON-FUNCTIONAL

## Report
- **RPT-1 (M)** Opens in a full extension tab (`report.html`) and updates live during the run.
- **RPT-2 (M)** Header: store origin, theme info, mode, viewports, enabled check groups, duration, date, extension version.
- **RPT-3 (M)** Summary counts by severity and category. A collapsed "Passed checks" list with counts, so the developer can see what was actually verified, plus a "Skipped" list with reasons.
- **RPT-4 (M)** Findings are grouped by fingerprint (`sha1(checkId + rule + normalizedSelector + normalizedMessage)`), shown as "seen on N pages / viewports" with an expandable list.
- **RPT-5 (M)** Each finding shows title, severity, category, rule id, page URL, viewport, selector, HTML snippet and a short fix hint (Dawn-aware where known).
- **RPT-6 (M)** Filters by severity, category, page and viewport, plus text search.
- **RPT-7 (M) Screenshots for visible issues.** Every finding that points at a visible element or region gets an evidence screenshot, with that element outlined (temporary outline injected, captured via CDP `Page.captureScreenshot` with a clip that includes some surrounding page for context, then the outline removed). This covers layout and overflow, broken, missing or oversized media, covered or clipped elements, small tap targets, empty or placeholder sections, leftover Liquid text, and interaction failures (take the shot after the failed action, for example the modal still open after clicking close). Capture one screenshot per finding group per viewport it appears on, from the first occurrence, so a mobile-only problem is shown on mobile. Findings with no visible element (console and network errors, missing meta tags, broken link targets, performance numbers) get no screenshot and show their message, URL, selector or snippet instead. Each finding group shows a "Screenshot" badge or "No visual" label so the reader knows which it is. Limits: JPEG quality 70, at most 800 px wide, stored in IndexedDB with the run, cap 120 per run. If the cap is hit, prefer errors over warnings over info, say how many were dropped, and still list the findings without images. If the debugging permission is denied, say that screenshots were skipped.
- **RPT-8 (S)** History of the last 20 runs per origin, and compare two runs into New, Fixed and Unchanged by fingerprint.
- **RPT-9 (M)** Export: standalone HTML (screenshots inlined, no external requests), JSON, and a copyable Markdown summary.
- **RPT-10 (M)** **Safe rendering.** Everything derived from the audited page is untrusted. Render with `textContent` and never `innerHTML`. The HTML export must escape it. A test must prove an XSS payload shows as inert text.
- **RPT-11 (S)** The extension's own UI is keyboard accessible, has proper contrast and labels, supports light and dark, and has a print stylesheet.

## Options (OPT-1, M)
Check-group toggles, viewports (all three on by default, at least one required), page sample counts, concurrency, timeouts, ignore lists (console regexes, network URL regexes, selectors to skip), extra click-denylist entries, performance thresholds, newsletter level and test address, cart-actions toggle, custom rules JSON with validation, "keep QA window open", "show console.warn", "strict tap targets", history size. Stored in `chrome.storage.local`, with sane defaults and import/export as JSON.

## Non-functional
- **NFR-1 (M)** Manifest V3 with `minimum_chrome_version` set to what you actually need. Permissions as small as possible, optional ones requested at point of use (SAF-8).
- **NFR-2 (M)** Caps everywhere: findings per rule per page, nodes per rule, links per page, interactions per page, pages per run, screenshots per run (120). Report truncation explicitly ("showing 20 of 143").
- **NFR-3 (M)** A new check must be addable with one file plus one registry line, using the contract in section 9.
- **NFR-4 (M)** The extension never throws away a run because one check crashed. A crashing check becomes `errored` in the report with its error message, and the run continues.
- **NFR-5 (S)** CI: `.github/workflows/ci.yml` running lint, typecheck, unit tests, build and the e2e suite (headed Chromium under xvfb if headless cannot load extensions).

# 9. ARCHITECTURE GUIDANCE (recommended; deviate with a reason in DECISIONS.md)

```
src/
  background/     service worker, privileged API calls only, thin
  orchestrator/   run pipeline, queue, checkpointing; runs in the persistent run/report page
  inject/         instrument.ts (MAIN-world hooks), collector.ts (page-side runner)
  checks/         one file per check, registry.ts, rules.ts (all rule slugs)
  engine/         interaction engine, hit-testing, selector generator, settle logic
  shopify/        theme info, Dawn hints, sitemap parser and sampler, cart/product helpers
  report/         report UI, grouping, diff, exporters
  popup/  options/
  shared/         types, schemas, typed messaging, storage
fixtures/  e2e/  tests/  docs/ (including docs/design/)  scripts/
```

Pattern for checks: **collect** (runs in the page, dumb, returns serializable data) and **analyze** (pure function in the orchestrator, turns data into findings). This makes unit tests feed JSON in and compare findings out.

Contract:

```ts
type Severity = 'error' | 'warning' | 'info';
type Category =
  | 'health' | 'media' | 'links' | 'content' | 'layout' | 'interaction'
  | 'a11y' | 'performance' | 'seo' | 'shopify' | 'newsletter' | 'cart' | 'safety';

interface Finding {
  id: string;                 // stable fingerprint, see RPT-4
  checkId: string;            // e.g. 'CHK-08'
  rule: string;               // e.g. 'layout/horizontal-overflow'
  severity: Severity;
  category: Category;
  title: string;
  message: string;
  url: string;
  viewport: string;           // 'desktop' | 'mobile' | 'tablet'
  selector?: string;
  htmlSnippet?: string;
  rect?: { x: number; y: number; w: number; h: number };
  screenshotId?: string;
  hint?: string;
  meta?: Record<string, unknown>;
}

interface CheckResult {
  checkId: string;
  status: 'passed' | 'failed' | 'skipped' | 'errored';
  findings: Finding[];
  skippedReason?: string;
  durationMs: number;
}

interface Check<TData = unknown> {
  id: string;
  title: string;
  category: Category;
  mutatesState: boolean;
  defaultEnabled: boolean;
  needs?: Array<'debugger' | 'productPage' | 'cartPage' | 'shopify'>;
  collect(ctx: PageContext): Promise<TData>;        // page side
  analyze(data: TData, ctx: RunContext): Finding[]; // pure
}
```

Other guidance:
- Selector generator: prefer id, then stable data attributes, then a short class and `:nth-of-type` chain. Unit test it.
- Money normalisation: strip everything but digits and compare minor units. Unit test several locales.
- Persist runs in IndexedDB and options in `chrome.storage.local`.
- Typed message passing between popup, background, orchestrator and injected code, with runtime validation of every message.

# 10. TEST STRATEGY AND MILESTONES

## Tests
- **TST-1 Unit (Vitest).** All `analyze` functions, grouping and diff, sitemap parser and sampler, origin rewriting and preview-parameter carry-over, selector generator, money normaliser, severity mapping, options and custom-rules validation, exporters and escaping.
- **TST-2 Fixture site.** `fixtures/server.mjs`, a plain Node server on a random port, serving a `clean` Dawn-like site and a `broken` Dawn-like site (HTML structured like Dawn: `cart-drawer`, `details-modal`, `header-drawer`, `slider-component`, `variant-selects`, newsletter form), with mocked Shopify endpoints: `/sitemap.xml` (listing a different primary domain on purpose), `/products/<handle>.js`, `/cart.js`, `/cart/add.js`, `/cart/change.js`, `/search`, a predictive search endpoint, `/contact` (newsletter POST that redirects with `customer_posted=true`), `/checkout` and `/account/logout` (both record hits), and a `/__log` beacon for click sentinels.
- **TST-3 E2E (Playwright).** Launch Chromium with a persistent context and the built extension. Add an E2E-only build flag that moves the optional permissions into required ones, so tests need no user gesture, and that allows starting a run through a URL such as `run.html?auto=1&mode=quick&url=...`. This hook must be compiled out of the production build and a test must prove that. If headless cannot load extensions or use `chrome.debugger`, run headed under xvfb and document it. The E2E suite must also cover: Pages mode (a saved list runs only those pages, preview parameters carried over, empty list disables Run), the all-viewports default (a default run produces desktop, tablet and mobile results, narrowing to one viewport works, zero viewports is blocked), the popup Customize view (preset switches to Custom on a single toggle, saved options survive reopening the popup), and that findings tied to a visible element have a screenshot while console and network findings do not.

## UI design reference

The screens are designed and live in `docs/design/` as `.dc.html` files (plain HTML with inline styles, readable as source) plus `canvas.json`, which lists them. Copy the layout, copy text, spacing, colours (graphite and teal), and type (Instrument Sans for text, JetBrains Mono for paths, selectors and code) from them, and build the real UI with accessible semantics (real buttons, `aria-pressed`, `role="switch"`, visible focus, labelled controls). The files are static mockups with sample data; do not copy sample values such as `northwind-demo.myshopify.com` into product code.

| File | Screen |
|---|---|
| `Main.dc.html` | Popup, Quick mode (default view with All devices and collapsed check groups) |
| `Pages.dc.html` | Popup, Pages mode (list of specific pages) |
| `Customize.dc.html` | Popup, devices set to Choose and check groups expanded |
| `Confirmations.dc.html` | Opt-in confirmations (newsletter Level 2, cart actions) and the debugging-permission prompt |
| `ReportRunning.dc.html` | Report page while a run is in progress |
| `ReportFinished.dc.html` | Finished report with summary, filters, grouped findings, evidence screenshot, compare, passed and skipped |
| `Options.dc.html` | Options page |

If a design file and a requirement disagree, the requirement wins and the difference goes into `docs/DECISIONS.md`.

## Acceptance table (the `broken` fixture must produce each finding; the `clean` fixture must not)

| # | Seeded in `broken` fixture | Expected rule | Severity |
|---|---|---|---|
| 1 | Uncaught exception on load | `health/uncaught-exception` | error |
| 2 | `console.error` call | `health/console-error` | error |
| 3 | Unhandled promise rejection | `health/unhandled-rejection` | error |
| 4 | Image returning 404 | `media/broken-image` and `health/network-failure` | error |
| 5 | `<img>` without alt | `media/missing-alt` | warning |
| 6 | Stretched image | `media/stretched-image` | warning |
| 7 | Text "Liquid error (...)" and "translation missing: ..." | `content/liquid-error`, `content/translation-missing` | error |
| 8 | Empty section `shopify-section-template--1__empty` | `content/empty-section` | warning |
| 9 | Internal link to a 404 page | `links/broken-internal` | error |
| 10 | `href="#"` link | `links/dead-anchor` | warning |
| 11 | 600 px element on the 390 px viewport | `layout/horizontal-overflow` | error |
| 12 | Button covered by an overlay | `layout/obscured-interactive` | error |
| 13 | Modal whose close button is covered | `interaction/close-obscured` | error |
| 14 | Modal whose close button has no handler | `interaction/close-no-effect` | error |
| 15 | Drawer that leaves body scroll locked | `interaction/scroll-lock-stuck` | error |
| 16 | Drawer that ignores Escape | `interaction/escape-not-closing` | warning |
| 17 | Trigger that does nothing | `interaction/trigger-no-effect` | warning |
| 18 | Carousel next button that does nothing | `interaction/carousel-no-effect` | warning |
| 19 | Low-contrast text, unlabeled input | `a11y/axe:color-contrast`, `a11y/axe:label` | per axe impact |
| 20 | LCP image with `loading="lazy"` | `performance/lcp-lazy` | warning |
| 21 | Variant price in the DOM differs from JSON | `shopify/variant-price-mismatch` | error |
| 22 | Sold-out variant with enabled add to cart | `shopify/variant-availability-mismatch` | error |
| 23 | Cart badge shows 3, `/cart.js` says 1 | `shopify/cart-badge-mismatch` | error |
| 24 | No `<title>`, two `h1` | `seo/title-missing`, `seo/h1-count` | warning |
| 25 | Tiny tap target on mobile | `layout/tap-target-small` | warning |
| 26 | Newsletter input without `type=email` or `required`; and a variant of the fixture with no success message after submit | `newsletter/form-invalid` (level 1), `newsletter/no-success-state` (level 2) | warning / error |
| 27 | Font file returning 404 | `content/font-failed` | warning |
| 28 | Different `Shopify.theme.id` on one page of a Full run | `shopify/theme-changed` | error |
| 29 | XSS payload in page text and attributes | no finding; the report and HTML export must show it as inert text and no script may run | n/a |

Safety sentinels that must hold (each is a test):
- "Log out" button and `/account/logout` link: zero clicks and zero hits.
- Element leading to `/checkout`: never clicked, any navigation to it aborted, zero hits on `/checkout`, and `safety/left-safe-zone` recorded if it was attempted.
- With newsletter and cart opt-ins off: zero POSTs to `/contact`, `/cart/add.js` and `/cart/change.js`.
- With cart actions on: the cart ends exactly as it started, including after Cancel.
- The user's own tab is never reloaded or resized in Quick, Pages and Full modes.
- `clean` fixture: zero Errors and zero Warnings, except an explicit, documented allow-list kept in the test file.

## Milestones (commit and push after each; tests green before moving on)
1. **M0 Scaffold.** Tooling (Vite, TypeScript strict, ESLint, Prettier, Vitest, Playwright), manifest, build, placeholder icons generated by a script, CI workflow, README skeleton, docs folder with this requirement list saved as `docs/REQUIREMENTS.md`.
2. **M1 Core.** Types, registry, runner, run persistence, orchestrator, QA window and tab management, instrumented load and settle logic, console and network collection, popup with all four modes (Quick, Pages, Full, Live tab), minimal live report page, Live tab mode, fixture server with `clean` and `broken` sites.
3. **M2 Passive checks.** CHK-01 to CHK-07, CHK-10, CHK-11, CHK-12 with unit tests and acceptance rows 1 to 10, 19, 20, 24, 27, 29.
4. **M3 Layout, viewports, evidence.** CHK-08, CDP emulation, optional debugger permission flow, screenshot evidence. Rows 11, 12, 25.
5. **M4 Interaction engine.** INT-1 to INT-5, SAF-1 to SAF-4. Rows 13 to 18 and the click and checkout sentinels.
6. **M5 Shopify checks.** Theme info, CHK-13, CHK-14, CHK-15, CHK-16, CHK-17, CHK-18, SAF-5. Rows 21 to 23, 26 and the cart sentinels.
7. **M6 Full mode.** Sitemap discovery and sampling, origin rewrite, preview-parameter carry-over, theme consistency, concurrency and caps. Row 28.
8. **M7 Report and options.** Grouping, filters, history and compare, all exports, safe rendering, the full options page, accessibility pass on the UI.
9. **M8 Stretch.** CHK-19 and INT-6, only if everything else is green.
10. **M9 Finish.** README, architecture doc, decisions log, requirements status, real-store validation checklist, `npm run package` producing `release/storefront-qa-<version>.zip`, final full verification run.

# 11. DEFINITION OF DONE

All of these pass from a clean clone: `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`. Plus:

- Every (M) requirement is implemented and mapped to a test or a documented manual check. (S) and (X) items are either done or listed as not done, with the reason.
- The acceptance table and every safety sentinel pass in e2e.
- `docs/` contains `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `REQUIREMENTS_STATUS.md` (one row per requirement ID: done, partial or not done, plus the evidence, meaning test name or manual step), and `REAL_STORE_VALIDATION.md` (a step-by-step manual checklist for one real Dawn store: load unpacked, run Quick on a preview URL, confirm key checks, plus anything fixtures could not prove such as preview-theme persistence across pages and real newsletter behaviour).
- `README.md` explains installing the unpacked extension, using each mode, what every permission is for and when it is requested, how to add a check, and the known limitations.
- The release zip builds and loads unpacked without errors, and the production build contains no E2E hooks.

# 12. OUT OF SCOPE

Checkout testing; ClickUp or any task integration; AI or LLM review; any backend, cloud, accounts, telemetry; Firefox and Safari; Chrome Web Store publishing; Shopify Admin API use; editing or auto-fixing themes; customer login or account flows; contact-form submission; payment of any kind; scheduled or automatic runs; choosing a license (leave the repo without one and say so in the README).

# 13. FINAL OUTPUT

When finished, print a short summary: what was built, the exact commands to build and load the extension, the test results (counts, not adjectives), every requirement not fully done with the reason, and the three things the developer should check first on a real store.

# APPENDIX A: Dawn selector hints (verify against Dawn source before relying on any of them)

Treat these as boosts to the generic discovery in INT-1, never as the only way a component is found. Custom themes will differ.

- Cart: `cart-drawer`, `#CartDrawer`, `.drawer__close`, cart icon `#cart-icon-bubble`, badge `.cart-count-bubble`.
- Menu: `header-drawer`, `details#Details-menu-drawer-container`, `summary.header__icon--menu`.
- Search: `details-modal.header__search`, `summary.header__icon--search`, `.modal__close-button`.
- Product: `product-info`, `product-form`, `variant-selects`, `button[name="add"]`, `.price`, `.price-item--sale`, media modal `product-modal`, `quick-add-modal`.
- Carousels: `slider-component`, `.slider-button--next`, `.slider-button--prev`.
- Newsletter: `form.newsletter-form`, `.newsletter-form__message--success`.
- Sections: `.shopify-section` with id `shopify-section-<id>`.
