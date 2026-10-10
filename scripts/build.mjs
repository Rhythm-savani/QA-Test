// Builds the extension into dist/. `--e2e` adds the test-only hooks and promotes the optional
// permissions to required ones so Playwright needs no user gesture.
import { build } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const e2e = process.argv.includes('--e2e');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const dist = resolve(root, 'dist');

const define = {
  __E2E__: JSON.stringify(e2e),
  __VERSION__: JSON.stringify(pkg.version),
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. Extension pages and the service worker (ES modules, shared chunks are fine).
await build({
  configFile: false,
  root: resolve(root, 'src/pages'),
  base: './',
  logLevel: 'warn',
  define,
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: 'chrome116',
    minify: true,
    rollupOptions: {
      input: {
        popup: resolve(root, 'src/pages/popup.html'),
        options: resolve(root, 'src/pages/options.html'),
        report: resolve(root, 'src/pages/report.html'),
        background: resolve(root, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

// 2. The injected page bundle must be a single self-contained IIFE.
await build({
  configFile: false,
  logLevel: 'warn',
  define,
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: 'chrome116',
    minify: true,
    lib: {
      entry: resolve(root, 'src/inject/page.ts'),
      name: 'sqaPage',
      formats: ['iife'],
      fileName: () => 'inject/page.js',
    },
  },
});

// 3. axe-core is injected on demand; ship the vendor minified file untouched.
mkdirSync(resolve(dist, 'inject'), { recursive: true });
cpSync(resolve(root, 'node_modules/axe-core/axe.min.js'), resolve(dist, 'inject/axe.js'));

// 4. Icons.
if (!existsSync(resolve(root, 'public/icon-128.png'))) {
  await import('./make-icons.mjs');
}
mkdirSync(resolve(dist, 'icons'), { recursive: true });
for (const s of [16, 32, 48, 128]) {
  cpSync(resolve(root, `public/icon-${s}.png`), resolve(dist, `icons/icon-${s}.png`));
}

// 5. Manifest.
const hostPerms = ['http://*/*', 'https://*/*'];
const manifest = {
  manifest_version: 3,
  name: 'Storefront QA',
  version: pkg.version,
  description:
    'On-demand QA for Shopify storefronts: finds JS errors, broken media, dead links, layout and interaction bugs. Runs only when you click Run.',
  minimum_chrome_version: '116',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_popup: 'popup.html',
    default_title: 'Storefront QA',
    default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
  },
  options_page: 'options.html',
  background: { service_worker: 'background.js', type: 'module' },
  permissions: [
    'storage',
    'unlimitedStorage',
    'scripting',
    'webNavigation',
    'activeTab',
    'declarativeNetRequestWithHostAccess',
    ...(e2e ? ['debugger', 'tabs'] : []),
  ],
  ...(e2e
    ? { host_permissions: hostPerms }
    : { optional_permissions: ['debugger'], optional_host_permissions: hostPerms }),
  commands: {
    'run-check': {
      suggested_key: { default: 'Alt+Shift+Q' },
      description: 'Run the last-used Storefront QA mode on the active tab',
    },
  },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};
writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`built ${e2e ? 'E2E' : 'production'} extension v${pkg.version} -> dist/`);
