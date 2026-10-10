// Dawn-like storefront generator for the fixture servers. `clean` must produce no errors or
// warnings; `broken` seeds every defect in the acceptance table.

export const THEME_ID = 148302771;
export const PRIMARY_DOMAIN = 'https://primary.example.com';

export const PRODUCTS = {
  'aurora-ring': {
    id: 1001,
    title: 'Aurora Ring',
    options: [
      { name: 'Size', values: ['6', '7', '8'] },
      { name: 'Color', values: ['Gold', 'Silver'] },
    ],
    variants: [
      {
        id: 11,
        options: ['6', 'Gold'],
        price: 12900,
        available: true,
        image: '/img/ring-gold.svg',
      },
      {
        id: 12,
        options: ['6', 'Silver'],
        price: 12900,
        available: true,
        image: '/img/ring-silver.svg',
      },
      {
        id: 13,
        options: ['7', 'Gold'],
        price: 13900,
        available: true,
        image: '/img/ring-gold.svg',
      },
      {
        id: 14,
        options: ['7', 'Silver'],
        price: 13900,
        available: false,
        image: '/img/ring-silver.svg',
      },
      {
        id: 15,
        options: ['8', 'Gold'],
        price: 14900,
        available: true,
        image: '/img/ring-gold.svg',
      },
      {
        id: 16,
        options: ['8', 'Silver'],
        price: 14900,
        available: true,
        image: '/img/ring-silver.svg',
      },
    ],
  },
  'pearl-studs': {
    id: 1002,
    title: 'Pearl Studs',
    options: [{ name: 'Material', values: ['Pearl', 'Opal'] }],
    variants: [
      { id: 21, options: ['Pearl'], price: 8900, available: true, image: '/img/ring-silver.svg' },
      { id: 22, options: ['Opal'], price: 9900, available: true, image: '/img/ring-gold.svg' },
    ],
  },
  'broken-ring': {
    id: 1003,
    title: 'Broken Ring',
    options: [{ name: 'Size', values: ['6', '7', '8'] }],
    variants: [
      { id: 31, options: ['6'], price: 12900, available: true, image: '/img/ring-gold.svg' },
      { id: 32, options: ['7'], price: 13900, available: true, image: '/img/ring-gold.svg' },
      { id: 33, options: ['8'], price: 14900, available: false, image: '/img/ring-gold.svg' },
    ],
  },
};

const money = (c) => '$' + (c / 100).toFixed(2);
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const XSS = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';

function shopifyObject(site, ctx) {
  let id = THEME_ID;
  let role = 'main';
  const preview = ctx.query.get('preview_theme_id');
  if (preview) {
    id = Number(preview);
    role = 'unpublished';
  }
  if (site === 'broken' && ctx.path === '/pages/about') {
    id = 999; // seeded: a different theme on one page (row 28)
    role = 'unpublished';
  }
  return `window.Shopify = { shop: 'fixture.myshopify.com', theme: { id: ${id}, name: 'Dawn', role: '${role}', schema_name: 'Dawn', schema_version: '15.0.0' } };`;
}

function layout(
  site,
  ctx,
  {
    title,
    body,
    description = 'A fixture storefront for Storefront QA.',
    head = '',
    bodyAttrs = '',
    noH1Title = false,
  },
) {
  const broken = site === 'broken';
  const cartCount = ctx.cart.items.reduce((n, i) => n + i.quantity, 0);
  const badge =
    broken && ctx.path !== '/cart'
      ? 3 // seeded: badge says 3 while /cart.js says 1 (row 23)
      : cartCount;
  const titleTag = noH1Title ? '' : `<title>${esc(title)}</title>`;
  return `<!doctype html>
<html lang="en" data-site="${site}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${titleTag}
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${PRIMARY_DOMAIN}${esc(ctx.path)}">
<link rel="icon" href="data:,">
<script>${shopifyObject(site, ctx)}</script>
${
  broken
    ? `<script>nonexistentFunction(); /* seeded uncaught exception */</script>
<script>console.error('Seeded console.error from the broken fixture');</script>
<script>Promise.reject(new Error('Seeded unhandled rejection'));</script>`
    : ''
}
<link rel="stylesheet" href="/assets/theme.css">
${broken ? `<style>@font-face { font-family: 'QAFont'; src: url('/assets/missing-font.woff2') format('woff2'); font-display: swap; } h1 { font-family: 'QAFont', Arial, sans-serif; }</style>` : ''}
${head}
</head>
<body ${bodyAttrs}>
<a class="skip-to-content-link" href="#MainContent">Skip to content</a>
<header class="header">
  <header-drawer class="header-drawer">
    <details id="Details-menu-drawer-container">
      <summary class="header__icon header__icon--menu" role="button" aria-expanded="false" aria-controls="menu-drawer"><span aria-hidden="true">&#9776;</span><span class="visually-hidden">Menu</span></summary>
      <div id="menu-drawer" class="menu-drawer">
        <button type="button" class="menu-drawer__close-button" aria-label="Close menu">&times;</button>
        <nav aria-label="Menu drawer"><ul>
          <li><a href="/collections/all">Shop</a></li>
          <li><a href="/pages/about">About</a></li>
          <li><a href="/blogs/news">Journal</a></li>
        </ul></nav>
      </div>
    </details>
  </header-drawer>
  <a class="header__heading-link" href="/">Northwind</a>
  <nav aria-label="Main menu"><ul class="header__menu">
    <li><a href="/collections/all">Shop</a></li>
    <li><a href="/pages/about">About</a></li>
    <li><a href="/blogs/news">Journal</a></li>
  </ul></nav>
  <div class="header__icons">
    <details-modal class="header__search">
      <details id="Details-search-modal">
        <summary class="header__icon header__icon--search" role="button" aria-expanded="false" aria-controls="search-modal"><span aria-hidden="true">&#9906;</span><span class="visually-hidden">Search</span></summary>
        <div id="search-modal" class="search-modal modal__content" role="dialog" aria-modal="true" aria-label="Search">
          <form action="/search" method="get" role="search">
            <input type="search" name="q" aria-label="Search the store" autocomplete="off">
            <button type="submit" class="button">Search</button>
            <button type="button" class="modal__close-button" aria-label="Close search">&times;</button>
          </form>
          <div id="predictive-search-results" class="predictive-search" hidden></div>
        </div>
      </details>
    </details-modal>
    <a href="/account" class="header__icon"><span aria-hidden="true">&#9786;</span><span class="visually-hidden">Account</span></a>
    <a id="cart-icon-bubble" class="header__icon" href="/cart"><span aria-hidden="true">&#128722;</span><span class="visually-hidden">Cart</span>${
      badge > 0
        ? `<div class="cart-count-bubble"><span aria-hidden="true">${badge}</span><span class="visually-hidden">${badge} items</span></div>`
        : ''
    }</a>
  </div>
</header>
<cart-drawer class="drawer">
  <div class="cart-drawer__overlay"></div>
  <div id="CartDrawer" class="drawer__inner" role="dialog" aria-modal="true" aria-label="Cart" tabindex="-1">
    <div class="drawer__header">
      <h2>Your cart</h2>
      <button type="button" class="drawer__close" aria-label="Close cart">&times;</button>
    </div>
    <ul id="CartDrawer-Items"></ul>
    <p>Subtotal: <span id="CartDrawer-Total"></span></p>
    <form id="CartDrawer-Form" action="/cart" method="post">
      <button type="submit" name="checkout" class="button" data-beacon="checkout-button">Check out</button>
    </form>
  </div>
</cart-drawer>
${body}
<footer class="footer">
  <div class="footer__inner">
    ${newsletter(site, ctx)}
    <ul>
      <li><a href="/pages/about">About us</a></li>
      <li><a href="/account/logout" data-beacon="logout-link">Log out</a></li>
      <li><a href="/checkout" data-beacon="checkout-link">Check out</a></li>
    </ul>
    <form action="/account/logout" method="post"><button type="submit" class="button" data-beacon="logout-button">Log out</button></form>
    ${broken ? '<button type="button" class="button" data-qa-go-checkout>Show more</button>' : ''}
    <p class="muted">&copy; Northwind fixture</p>
  </div>
</footer>
<script src="/assets/theme.js"></script>
</body>
</html>`;
}

function newsletter(site, ctx) {
  const broken = site === 'broken';
  const posted = ctx.query.get('customer_posted') === 'true';
  const msg =
    posted && !broken
      ? `<p class="newsletter-form__message newsletter-form__message--success form__message" role="status" tabindex="-1">Thanks for subscribing</p>`
      : `<p class="newsletter-form__message" role="status"></p>`;
  const emailInput = broken
    ? `<input id="NewsletterForm--footer" name="contact[email]" class="field__input" placeholder="Email address" autocomplete="email">`
    : `<input id="NewsletterForm--footer" name="contact[email]" type="email" class="field__input" required autocomplete="email" placeholder="Email address">`;
  return `<section aria-labelledby="newsletter-title" id="ContactFooter">
    <h2 id="newsletter-title">Subscribe to our emails</h2>
    <form method="post" action="/contact#ContactFooter" class="newsletter-form">
      <input type="hidden" name="form_type" value="customer">
      <input type="hidden" name="utf8" value="✓">
      <input type="hidden" name="contact[tags]" value="newsletter">
      <div class="field"><label for="NewsletterForm--footer" class="field__label">Email</label>${emailInput}</div>
      <button type="submit" class="button" name="commit">Sign up</button>
    </form>
    ${msg}
  </section>`;
}

function card(handle, alt, level = 3) {
  const p = PRODUCTS[handle];
  return `<li><a href="/products/${handle}"><img src="/img/${handle === 'pearl-studs' ? 'ring-silver' : 'ring-gold'}.svg" alt="${esc(alt || p.title)}" width="240" height="240" loading="lazy"></a>
    <h${level}><a href="/products/${handle}">${esc(p.title)}</a></h${level}><p class="price">From ${money(p.variants[0].price)}</p></li>`;
}

function home(site, ctx) {
  const broken = site === 'broken';
  const heroImg = broken
    ? `<img src="/img/hero.png" alt="Hero" width="900" height="375" loading="lazy">`
    : `<img src="/img/hero.png" alt="Handmade jewellery on a stone surface" width="900" height="375" fetchpriority="high">`;
  const brokenBlocks = broken
    ? `
  <div class="section" id="shopify-section-template--1__seeded">
    <img src="/img/missing-hero.jpg" alt="Missing image" width="120" height="60">
    <img src="/img/ring-gold.svg" width="120" height="120">
    <img src="/img/wide.svg" alt="Stretched" width="100" height="200">
    <p>Liquid error (sections/hero line 12): undefined method 'foo'</p>
    <p>translation missing: en.sections.hero.cta</p>
    <p><a href="/pages/does-not-exist">Gift guide</a> · <a href="#">Read more</a></p>
    <div style="width:600px;height:20px;background:#ccc" role="presentation"></div>
    <p class="qa-lowcontrast">Low contrast promotional text</p>
    <input type="text" name="promo">
    <button type="button" style="width:16px;height:16px;padding:0;font-size:8px" aria-label="Tiny">x</button>
    <div style="position:relative;height:60px"><button type="button" class="button" id="covered-btn" style="position:absolute;left:0;top:0">Covered button</button><div class="qa-cover" style="left:0;top:0;width:200px;height:48px"></div></div>
  </div>
  <div id="shopify-section-template--1__empty" class="shopify-section"></div>
  <div class="section">
    <button type="button" class="button" data-qa-modal-open="qa-modal-covered" aria-haspopup="dialog">Open quote request</button>
    <div id="qa-modal-covered" class="qa-modal" role="dialog" aria-modal="true" aria-label="Quote request">
      <div class="qa-modal__panel"><h2>Quote request</h2>
        <div style="position:relative"><button type="button" class="modal__close-button" data-qa-modal-close="qa-modal-covered" aria-label="Close quote request">&times;</button><div style="position:absolute;inset:0;background:rgba(255,255,255,0.01)"></div></div>
      </div>
    </div>
    <button type="button" class="button" data-qa-modal-open="qa-modal-dead" aria-haspopup="dialog">Open size guide</button>
    <div id="qa-modal-dead" class="qa-modal" role="dialog" aria-modal="true" aria-label="Size guide">
      <div class="qa-modal__panel"><h2>Size guide</h2><button type="button" class="modal__close-button" aria-label="Close size guide">&times;</button></div>
    </div>
    <button type="button" class="button" data-qa-drawer-open="qa-drawer" aria-expanded="false" aria-controls="qa-drawer">Open filters drawer</button>
    <div id="qa-drawer" class="qa-modal is-open" hidden role="dialog" aria-modal="true" aria-label="Filters"><div class="qa-modal__panel"><h2>Filters</h2><button type="button" class="drawer__close" data-qa-drawer-close="qa-drawer" aria-label="Close filters">&times;</button></div></div>
    <button type="button" class="button" aria-expanded="false" aria-controls="gift-options">Open gift options</button>
    <div id="gift-options" hidden>Gift options</div>
  </div>`
    : '';
  return layout(site, ctx, {
    title: 'Northwind — Handmade jewellery',
    bodyAttrs: broken ? 'data-broken="1"' : '',
    body: `<main id="MainContent">
  <div id="shopify-section-template--1__hero" class="section hero shopify-section">
    <h1>Northwind jewellery</h1>
    <p>Handmade rings and studs, finished by hand in small batches.</p>
    ${heroImg}
    <p><a href="/collections/all">Shop the collection</a></p>
  </div>
  <div id="shopify-section-template--1__featured" class="section shopify-section">
    <h2>Featured products</h2>
    <ul class="card-grid">${card('aurora-ring')}${card('pearl-studs')}</ul>
  </div>
  <div id="shopify-section-template--1__slider" class="section shopify-section">
    <h2>Journal highlights</h2>
    <slider-component ${broken ? 'data-broken="1"' : ''} aria-roledescription="carousel" aria-label="Journal highlights">
      <ul class="slider" tabindex="0" aria-label="Slides">
        ${[1, 2, 3, 4, 5].map((n) => `<li class="slider__slide"><h3>Story ${n}</h3><p>A short note about our craft, part ${n}.</p></li>`).join('')}
      </ul>
      <div class="slider-buttons">
        <button type="button" class="slider-button slider-button--prev" aria-label="Previous slide" disabled>&lsaquo;</button>
        <button type="button" class="slider-button slider-button--next" aria-label="Next slide">&rsaquo;</button>
      </div>
    </slider-component>
  </div>
  ${brokenBlocks}
</main>`,
  });
}

function productPage(site, ctx, handle) {
  const broken = site === 'broken';
  const p = PRODUCTS[handle];
  // Embedded JSON drives the theme JS. In the broken site it disagrees with /products/<h>.js.
  const embedded = JSON.parse(JSON.stringify(p));
  if (broken && handle === 'broken-ring') {
    embedded.variants[1].price = 11900; // row 21: displayed price differs from JSON
    embedded.variants[2].available = true; // row 22: sold-out variant with enabled add to cart
  }
  const optionsHtml = p.options
    .map((o, idx) => {
      if (o.values.length <= 3 && idx === 0) {
        return `<fieldset class="pill"><legend>${esc(o.name)}</legend>${o.values
          .map(
            (v, i) =>
              `<input type="radio" id="opt-${idx}-${i}" name="${esc(o.name)}" value="${esc(v)}" data-option-index="${idx}"${i === 0 ? ' checked' : ''}><label for="opt-${idx}-${i}">${esc(v)}</label>`,
          )
          .join('')}</fieldset>`;
      }
      return `<div class="field"><label for="opt-${idx}">${esc(o.name)}</label><select id="opt-${idx}" name="options[${esc(o.name)}]" data-option-index="${idx}" class="field__input">${o.values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></div>`;
    })
    .join('');
  const first = p.variants[0];
  return layout(site, ctx, {
    title: `${p.title} — Northwind`,
    body: `<main id="MainContent">
  <div id="shopify-section-template--1__main" class="section shopify-section">
    <product-info class="product" ${broken ? 'data-nomedia="1"' : ''}>
      <div class="product__media"><img src="${first.image}" alt="${esc(p.title)}" width="480" height="480"></div>
      <div class="product__info">
        <h1>${esc(p.title)}</h1>
        <div class="price"><span class="price-item price-item--regular">${money(first.price)}</span></div>
        <form method="post" action="/cart/add" id="product-form" accept-charset="UTF-8">
          <input type="hidden" name="id" value="${first.id}">
          ${optionsHtml}
          <button type="submit" name="add" class="button">Add to cart</button>
        </form>
        <script type="application/json" data-product-json>${JSON.stringify(embedded)}</script>
        <div class="accordion">
          <details><summary>Materials</summary><p>Recycled sterling silver and gold plating.</p></details>
          <details><summary>Shipping</summary><p>Ships within two working days.</p></details>
        </div>
      </div>
    </product-info>
  </div>
</main>`,
  });
}

function collection(site, ctx, name) {
  return layout(site, ctx, {
    title: `${name} — Northwind`,
    body: `<main id="MainContent"><div class="section"><h1>${esc(name)}</h1>
    <ul class="card-grid">${card('aurora-ring', undefined, 2)}${card('pearl-studs', undefined, 2)}${site === 'broken' ? card('broken-ring', 'Broken ring', 2) : ''}</ul></div></main>`,
  });
}

function aboutPage(site, ctx) {
  const broken = site === 'broken';
  const body = `<main id="MainContent"><div class="section">
    ${broken ? '<h1>About us</h1><h1>Our story</h1>' : '<h1>About us</h1>'}
    <p>We make jewellery in small batches.</p>
    <div class="tabs">
      <div role="tablist" aria-label="Care guide">
        <button type="button" role="tab" id="tab-care" aria-selected="true" aria-controls="panel-care">Care</button>
        <button type="button" role="tab" id="tab-ship" aria-selected="false" aria-controls="panel-ship">Shipping</button>
      </div>
      <div role="tabpanel" id="panel-care" aria-labelledby="tab-care"><p>Wipe with a soft cloth.</p></div>
      <div role="tabpanel" id="panel-ship" aria-labelledby="tab-ship" hidden><p>Free shipping over $100.</p></div>
    </div></div></main>`;
  return layout(site, ctx, { title: 'About us — Northwind', body, noH1Title: broken });
}

function xssPage(site, ctx) {
  return layout(site, ctx, {
    title: 'Notes — Northwind',
    body: `<main id="MainContent"><div class="section"><h1>Notes</h1>
    <p>${esc(XSS)}</p>
    <img src="/img/ring-gold.svg" title="${esc(XSS)}" data-note="${esc(XSS)}" width="120" height="120">
    <a href="/pages/about" aria-label="${esc(XSS)}" title="${esc(XSS)}">Read about us</a>
    </div></main>`,
  });
}

function cartPage(site, ctx) {
  const c = ctx.cart;
  const items = c.items
    .map((i) => `<li>${esc(i.title)} × ${i.quantity} — ${money(i.line_price)}</li>`)
    .join('');
  return layout(site, ctx, {
    title: 'Your cart — Northwind',
    body: `<main id="MainContent"><div class="section"><h1>Your cart</h1>
    ${c.items.length ? `<ul>${items}</ul>` : '<p>Your cart is empty</p>'}
    <p>Subtotal: <span class="totals__total-value">${money(c.items.reduce((s, i) => s + i.line_price, 0))}</span></p>
    <form action="/cart" method="post"><button type="submit" name="checkout" class="button" data-beacon="checkout-cart-page">Check out</button></form>
    </div></main>`,
  });
}

function searchPage(site, ctx) {
  const q = (ctx.query.get('q') || '').toLowerCase();
  const hits = Object.entries(PRODUCTS)
    .filter(([, p]) => site === 'broken' || p.id !== 1003)
    .filter(
      ([, p]) =>
        !q || p.title.toLowerCase().includes(q.slice(0, 1)) || p.title.toLowerCase().includes(q),
    );
  return layout(site, ctx, {
    title: 'Search — Northwind',
    body: `<main id="MainContent"><div class="section"><h1>Search results</h1>
    ${hits.length ? `<p>${hits.length} results for “${esc(q)}”</p><ul class="card-grid product-grid">${hits.map(([h]) => card(h, undefined, 2)).join('')}</ul>` : `<p>No results found for “${esc(q)}”</p>`}
    </div></main>`,
  });
}

function simplePage(site, ctx, title, text) {
  return layout(site, ctx, {
    title: `${title} — Northwind`,
    body: `<main id="MainContent"><div class="section"><h1>${esc(title)}</h1><p>${esc(text)}</p></div></main>`,
  });
}

export function notFound(site, ctx) {
  return layout(site, ctx, {
    title: '404 Not Found — Northwind',
    body: `<main id="MainContent"><div class="section"><h1>404 Page Not Found</h1><p>The page you requested does not exist.</p><p><a href="/">Continue shopping</a></p></div></main>`,
  });
}

export function suggest(q) {
  const hits = Object.entries(PRODUCTS).filter(
    ([, p]) => p.title.toLowerCase().includes(q.toLowerCase()) || q.length === 1,
  );
  return hits.length
    ? `<ul>${hits.map(([h, p]) => `<li><a href="/products/${h}">${esc(p.title)}</a></li>`).join('')}</ul>`
    : '<p>No suggestions</p>';
}

/** Returns HTML for a known route, or null for unknown paths. */
export function renderRoute(site, ctx) {
  const { path } = ctx;
  if (path === '/') return home(site, ctx);
  let m;
  if ((m = path.match(/^\/products\/([^/]+)$/)) && PRODUCTS[m[1]]) {
    if (m[1] === 'broken-ring' && site !== 'broken') return null;
    return productPage(site, ctx, m[1]);
  }
  if (path === '/collections/all') return collection(site, ctx, 'All products');
  if (path === '/collections/rings') return collection(site, ctx, 'Rings');
  if (path === '/collections/studs') return collection(site, ctx, 'Studs');
  if (path === '/collections/new') return collection(site, ctx, 'New arrivals');
  if (path === '/pages/about') return aboutPage(site, ctx);
  if (path === '/pages/care')
    return simplePage(site, ctx, 'Care guide', 'Keep your jewellery dry.');
  if (path === '/pages/notes') return xssPage(site, ctx);
  if (path === '/blogs/news') return simplePage(site, ctx, 'Journal', 'News from the workshop.');
  if (path === '/blogs/news/welcome')
    return simplePage(site, ctx, 'Welcome', 'Our first journal entry.');
  if (path === '/cart') return cartPage(site, ctx);
  if (path === '/search') return searchPage(site, ctx);
  if (path === '/account') return simplePage(site, ctx, 'Account', 'Sign in to see your orders.');
  return null;
}

export const SITEMAP_PATHS = {
  products: ['/products/aurora-ring', '/products/pearl-studs'],
  collections: ['/collections/all', '/collections/rings', '/collections/studs', '/collections/new'],
  pages: ['/pages/about', '/pages/care'],
  blogs: ['/blogs/news', '/blogs/news/welcome'],
};
