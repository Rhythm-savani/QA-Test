// Launches a real Chrome/Chromium with the built extension and connects Playwright over CDP.
// Spawning the browser ourselves (instead of launchPersistentContext) is the most portable way to
// load an unpacked extension: it works with branded Chrome 137+ (needs the load-extension feature
// switch re-enabled) and with Playwright's bundled Chromium.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext } from '@playwright/test';

export const EXT_PATH = resolve(import.meta.dirname, '..', 'dist');

function findBrowser(): string {
  const candidates = [
    process.env.SQA_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((p): p is string => !!p);
  for (const c of candidates) if (existsSync(c)) return c;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  throw new Error('No Chrome found. Set SQA_CHROME to a Chrome/Chromium executable.');
}

export async function launch(): Promise<{ context: BrowserContext; extId: string }> {
  if (!existsSync(resolve(EXT_PATH, 'manifest.json'))) {
    throw new Error('Run `npm run build:e2e` first.');
  }
  const profile = mkdtempSync(join(tmpdir(), 'sqa-e2e-'));
  const headed = process.env.SQA_HEADED === '1';
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--enable-logging=stderr',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    '--window-size=1400,900',
    ...(headed ? [] : ['--headless=new']),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    'about:blank',
  ];
  const child: ChildProcess = spawn(findBrowser(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise<string>((res, rej) => {
    const t = setTimeout(
      () => rej(new Error('Browser did not expose a DevTools endpoint')),
      30_000,
    );
    let buf = '';
    child.stderr!.on('data', (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(t);
        res(m[1]);
      }
    });
    child.on('exit', () => rej(new Error('Browser exited before DevTools was ready')));
  });
  const browser = await chromium.connectOverCDP(wsUrl);
  const context = browser.contexts()[0];
  // Extensions.loadUnpacked works in branded Chrome, where --load-extension stalls startup.
  const cdp = await browser.newBrowserCDPSession();
  const loaded = (await cdp.send(
    'Extensions.loadUnpacked' as never,
    { path: EXT_PATH } as never,
  )) as unknown as { id: string };
  const extId = loaded.id;
  for (let i = 0; i < 40 && !context.serviceWorkers().some((w) => w.url().includes(extId)); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  const close = async () => {
    await browser.close().catch(() => undefined);
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  };
  context.close = close;
  return { context, extId };
}
