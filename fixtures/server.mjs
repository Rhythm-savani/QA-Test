// Fixture storefronts for tests. Three plain Node HTTP servers (random ports):
//   clean  - Dawn-like site that must produce no errors or warnings
//   broken - the same site with every acceptance-table defect seeded
//   locked - everything redirects to /password
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIMARY_DOMAIN,
  PRODUCTS,
  SITEMAP_PATHS,
  THEME_ID,
  notFound,
  renderRoute,
  suggest,
} from './site.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CSS =
  readFileSync(resolve(here, 'theme.css'), 'utf8') +
  '\n.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}\n';
const JS = readFileSync(resolve(here, 'theme.js'), 'utf8');

function svg(w, h, label, fill = '#d9e4ec') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${fill}"/><text x="50%" y="50%" font-family="Arial" font-size="${Math.round(Math.min(w, h) / 8)}" fill="#1b3a4b" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
}
const IMAGES = {
  'hero.svg': svg(900, 375, 'Northwind'),
  'ring-gold.svg': svg(480, 480, 'Gold ring', '#f3e3b3'),
  'ring-silver.svg': svg(480, 480, 'Silver ring', '#e4e8ec'),
  'wide.svg': svg(400, 200, 'Wide'),
};

function newCartState() {
  return { items: [] };
}
function cartTotals(state) {
  return {
    item_count: state.items.reduce((n, i) => n + i.quantity, 0),
    total_price: state.items.reduce((n, i) => n + i.line_price, 0),
    items: state.items,
  };
}

function findVariant(id) {
  for (const [handle, p] of Object.entries(PRODUCTS)) {
    const v = p.variants.find((x) => x.id === id);
    if (v) return { handle, p, v };
  }
  return null;
}

function addToCart(state, id, qty) {
  const f = findVariant(id);
  if (!f) return null;
  const key = `${id}:fixture`;
  let line = state.items.find((i) => i.key === key);
  if (!line) {
    line = {
      key,
      id,
      quantity: 0,
      title: `${f.p.title} - ${f.v.options.join(' / ')}`,
      price: f.v.price,
      line_price: 0,
    };
    state.items.push(line);
  }
  line.quantity += qty;
  line.line_price = line.price * line.quantity;
  return line;
}

export async function startFixtures() {
  const hits = [];
  const states = { clean: null, broken: null, locked: null };

  function resetState() {
    hits.length = 0;
    // The clean store starts with one item so cart restoration is a real test.
    states.clean = newCartState();
    addToCart(states.clean, 11, 1);
    // The broken store's cart has one item while its badge claims three.
    states.broken = newCartState();
    addToCart(states.broken, 21, 1);
    states.locked = newCartState();
  }
  resetState();

  function makeHandler(site, getOrigin) {
    return async (req, res) => {
      const u = new URL(req.url, 'http://x');
      const path = u.pathname;
      const body = await new Promise((r) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => r(Buffer.concat(chunks).toString('utf8')));
      });
      hits.push({ site, method: req.method, path, search: u.search, body, at: Date.now() });
      const send = (status, type, text, headers = {}) => {
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
        res.end(req.method === 'HEAD' ? undefined : text);
      };
      const json = (data, status = 200) => send(status, 'application/json', JSON.stringify(data));
      const cartState = states[site];
      const ctx = { path, query: u.searchParams, cart: cartTotals(cartState), site };

      if (site === 'locked' && path !== '/password' && !path.startsWith('/assets')) {
        res.writeHead(302, { Location: '/password' });
        return res.end();
      }
      if (path === '/password') {
        return send(
          200,
          'text/html; charset=utf-8',
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Opening soon</title><script>window.Shopify={theme:{id:${THEME_ID},name:'Dawn',role:'main'}};</script></head><body><main><h1>Opening soon</h1><form action="/password" method="post"><label>Password <input type="password" name="password"></label><button type="submit">Enter</button></form></main></body></html>`,
        );
      }
      // static assets
      if (path === '/assets/theme.css') return send(200, 'text/css', CSS);
      if (path === '/assets/theme.js') return send(200, 'application/javascript', JS);
      const im = path.match(/^\/img\/([^/]+)$/);
      if (im && IMAGES[im[1]]) return send(200, 'image/svg+xml', IMAGES[im[1]]);

      // sentinels
      if (path === '/__log') return send(204, 'text/plain', '');
      if (path === '/checkout' || path.startsWith('/checkouts')) {
        return send(200, 'text/html', '<!doctype html><title>Checkout</title><h1>Checkout</h1>');
      }
      if (path === '/account/logout')
        return send(
          200,
          'text/html',
          '<!doctype html><title>Logged out</title><h1>Logged out</h1>',
        );

      // sitemaps (listing a different primary domain on purpose)
      if (path === '/sitemap.xml') {
        const kinds = ['products', 'collections', 'pages', 'blogs'];
        return send(
          200,
          'application/xml',
          `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${kinds.map((k) => `<sitemap><loc>${PRIMARY_DOMAIN}/sitemap_${k}_1.xml</loc></sitemap>`).join('')}</sitemapindex>`,
        );
      }
      const sm = path.match(/^\/sitemap_(\w+)_1\.xml$/);
      if (sm && SITEMAP_PATHS[sm[1]]) {
        return send(
          200,
          'application/xml',
          `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${SITEMAP_PATHS[sm[1]].map((p) => `<url><loc>${PRIMARY_DOMAIN}${p}</loc></url>`).join('')}</urlset>`,
        );
      }

      // JSON endpoints
      const pj = path.match(/^\/products\/([^/]+)\.js$/);
      if (pj && PRODUCTS[pj[1]]) {
        const p = PRODUCTS[pj[1]];
        return json({
          id: p.id,
          title: p.title,
          handle: pj[1],
          options: p.options.map((o, i) => ({ name: o.name, position: i + 1, values: o.values })),
          variants: p.variants.map((v) => ({
            id: v.id,
            title: v.options.join(' / '),
            option1: v.options[0] ?? null,
            option2: v.options[1] ?? null,
            option3: v.options[2] ?? null,
            options: v.options,
            price: v.price,
            available: v.available,
            featured_image: v.image ? { src: v.image } : null,
          })),
        });
      }
      if (path === '/cart.js') return json(cartTotals(cartState));
      if (path === '/cart/add.js' && req.method === 'POST') {
        const data = JSON.parse(body || '{}');
        const line = addToCart(cartState, Number(data.id), Number(data.quantity || 1));
        return line ? json(line) : json({ message: 'not found' }, 404);
      }
      if (path === '/cart/change.js' && req.method === 'POST') {
        const data = JSON.parse(body || '{}');
        const line =
          cartState.items.find((i) => i.key === data.id) || cartState.items[Number(data.line) - 1];
        if (line) {
          line.quantity = Number(data.quantity);
          line.line_price = line.price * line.quantity;
          cartState.items = cartState.items.filter((i) => i.quantity > 0);
        }
        return json(cartTotals(cartState));
      }
      if (path === '/search/suggest')
        return send(200, 'text/html', suggest(u.searchParams.get('q') || ''));
      if (path === '/contact' && req.method === 'POST') {
        const target =
          site === 'broken' ? '/?customer_posted=true' : '/?customer_posted=true#ContactFooter';
        res.writeHead(302, { Location: target });
        return res.end();
      }
      if (path === '/cart' && req.method === 'POST') {
        res.writeHead(302, { Location: '/checkout' });
        return res.end();
      }
      if (path === '/cart/add' && req.method === 'POST') {
        res.writeHead(302, { Location: '/cart' });
        return res.end();
      }

      // pages
      const html = req.method === 'GET' || req.method === 'HEAD' ? renderRoute(site, ctx) : null;
      if (html) return send(200, 'text/html; charset=utf-8', html);
      return send(404, 'text/html; charset=utf-8', notFound(site, ctx));
    };
  }

  const servers = {};
  const origins = {};
  for (const site of ['clean', 'broken', 'locked']) {
    const srv = http.createServer(makeHandler(site));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    servers[site] = srv;
    origins[site] = `http://127.0.0.1:${srv.address().port}`;
  }
  return {
    clean: origins.clean,
    broken: origins.broken,
    locked: origins.locked,
    hits,
    reset: resetState,
    cart: (site) => cartTotals(states[site]),
    close: () => Promise.all(Object.values(servers).map((s) => new Promise((r) => s.close(r)))),
  };
}

// `node fixtures/server.mjs` starts the servers for manual poking.
if (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('fixtures/server.mjs')
) {
  const f = await startFixtures();
  console.log(`clean:  ${f.clean}\nbroken: ${f.broken}\nlocked: ${f.locked}`);
}
