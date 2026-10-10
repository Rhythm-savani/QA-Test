# Real-store validation checklist (one Dawn store)

Fixtures prove the logic; these steps prove it against a real Dawn store. Use a **development store
or an unpublished preview theme**, not a live store, for steps marked (changes data).

## 0. Load the extension

1. `npm ci && npm run build`.
2. `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.
3. Confirm: no errors on the extension card, the toolbar icon appears, `Alt+Shift+Q` is listed under
   _Keyboard shortcuts_.

## 1. Quick run on a preview theme

1. Open a theme preview URL (`https://<store>.myshopify.com/?preview_theme_id=<id>`). Unlock the
   storefront password first if the store is protected.
2. Open the popup. Expect: the store host, "Dawn · Preview theme #<id>", a green _Shopify_ tag,
   _All devices_ selected with three informational tiles, "10 of 11 on".
3. Press **Run Quick check**. Expect the host-access prompt, then the debugging-permission dialog
   with a mock of Chrome's banner. Press **Allow**.
4. A report tab opens. Confirm: a separate QA window appears (unfocused where the OS allows), your
   original tab is not reloaded or resized, and the window closes at the end.
5. In the report confirm the header shows the store, theme (id/name/role), mode, three viewports,
   enabled groups, duration and extension version.
6. Cross-check at least three findings by hand in DevTools (a console error, a missing alt, a
   layout issue) and confirm the evidence screenshot outlines the right element.

## 2. Things fixtures cannot prove

| #    | Check                                                                                                                        | Expected                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | **Preview theme persistence across pages.** Run **Full** from a preview URL.                                                 | Every page reports the same theme id; no `shopify/theme-changed`. Pages in the report keep `preview_theme_id`.                                                                               |
| 2.2  | **Real sitemap shape.** Full run on a store with many products.                                                              | Sample is the first N per type, in a stable order across two runs; cart, search and a 404 are included.                                                                                      |
| 2.3  | **Real Dawn components.** Run Quick on a product page.                                                                       | Cart drawer, search modal, menu drawer (mobile) are exercised, close correctly, no `interaction/*` errors; the report's "Passed checks" lists them.                                          |
| 2.4  | **Dynamic checkout buttons.** Product page with Shop Pay / PayPal buttons.                                                   | Never clicked; no navigation to a payment provider; `Skipped`/refused count mentions them.                                                                                                   |
| 2.5  | **Third-party apps.** Store with a review widget or chat bubble.                                                             | App errors appear as Warnings/Errors by origin rule; known noise can be ignored in Options → Ignore lists.                                                                                   |
| 2.6  | **Real newsletter, Level 1.** Enable _Newsletter form_ (Level 1).                                                            | Form validations reported without submitting anything (check the store's customer list is unchanged).                                                                                        |
| 2.7  | **(changes data) Real newsletter, Level 2.** Dev store only. Options → Newsletter Level 2, set `you+qa@yourdomain.com`, run. | One-time confirmation shown; success state detected; the report names the address; **remove that customer from Shopify admin**. Captcha-protected stores report "blocked by captcha".        |
| 2.8  | **(changes data) Cart actions.** Dev store only. Put one item in the cart first, then enable _Cart actions_.                 | Confirmation shown; a test item is added and removed; afterwards the cart is exactly as before (verify in the browser); report says so. Repeat and press **Cancel** mid-run: still restored. |
| 2.9  | **Checkout is never touched.** Watch the Network panel of the QA window (or the store's analytics) during a Full run.        | No request to `/checkout*`; the cart page's "Check out" is never clicked.                                                                                                                    |
| 2.10 | **Password-protected store.** Run against a locked storefront.                                                               | Run stops with a message to unlock it in the browser first.                                                                                                                                  |
| 2.11 | **Non-Shopify page.** Run Quick on any non-Shopify site.                                                                     | Notice shown; generic checks run; Shopify reads are skipped with a reason.                                                                                                                   |
| 2.12 | **Permission denial.** Press **Skip these checks** on the debugging prompt.                                                  | Desktop only, no screenshots; both listed under _Skipped_ with "debugging permission not granted".                                                                                           |
| 2.13 | **Service worker suspension.** Start a Full run and wait > 1 minute with the popup closed.                                   | The run keeps going (it lives in the report tab); closing the tab marks the run interrupted with partial results.                                                                            |
| 2.14 | **Locales and currencies.** Store with a comma-decimal currency or a locale prefix (`/fr`).                                  | Variant price check does not report false mismatches; Full sampling handles `/fr/products/...`.                                                                                              |
| 2.15 | **Large DOM / slow store.** Page with > 1500 DOM nodes.                                                                      | `performance/dom-size` Warning; run completes within the per-page budget or reports `health/page-timeout`.                                                                                   |

## 3. Exports and history

1. Export **Standalone HTML**; open it from disk with the network disabled. Confirm screenshots are
   inline and nothing requests an external URL.
2. Export **JSON** and use **Copy Markdown summary**; paste into a note.
3. Run the same page twice, change something, run again; **Compare with previous run** shows
   New / Fixed / Unchanged sensibly.

## 4. Clean up

Remove any test subscriber (2.7), confirm the cart (2.8), and unload the extension if it was only for
the test.
