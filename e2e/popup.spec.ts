import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { launch, startFixtures, type Fixtures } from './harness';

test.describe.configure({ mode: 'serial' });

let fx: Fixtures;
let context: BrowserContext;
let extId: string;
let tabId: number;

test.beforeAll(async () => {
  fx = await startFixtures();
  ({ context, extId } = await launch());
  const store = await context.newPage();
  await store.goto(fx.clean + '/products/aurora-ring?preview_theme_id=148302771');
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${extId}/options.html`);
  tabId = await probe.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => (t.url ?? '').includes('/products/aurora-ring'))!.id!;
  });
  await probe.close();
});
test.afterAll(async () => {
  await context?.close();
  await fx?.close();
});

async function openPopup(): Promise<Page> {
  const p = await context.newPage();
  await p.setViewportSize({ width: 380, height: 600 });
  await p.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
  await p.waitForSelector('#run');
  return p;
}

test('default view: store card, all-devices tiles, collapsed groups, pinned Run', async () => {
  const p = await openPopup();
  await expect(p.locator('.store-host')).toContainText('127.0.0.1');
  await expect(p.locator('.store-card')).toContainText('Dawn');
  // modes
  await expect(p.getByRole('button', { name: 'Quick', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // devices: informational tiles, not toggle buttons
  const devices = p.locator('[data-testid=devices-card]');
  await expect(devices.getByRole('button', { name: 'All devices' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(devices.locator('.tile')).toHaveCount(3);
  await expect(devices.locator('button.tile')).toHaveCount(0);
  await expect(devices).toContainText('1440');
  await expect(devices).toContainText('768');
  await expect(devices).toContainText('390');
  // groups: collapsed card, no eleven toggle chips
  const groups = p.locator('[data-testid=groups-card]');
  await expect(groups).toContainText('10');
  await expect(groups).toContainText('of 11 on');
  await expect(groups.locator('.seg-bar')).toHaveCount(11);
  await expect(groups.locator('.seg-bar.on')).toHaveCount(10);
  await expect(groups.locator('[role=switch]')).toHaveCount(0);
  await expect(groups.getByRole('button', { name: /Customize/ })).toBeVisible();
  // opt-ins are off by default
  await expect(p.getByRole('switch', { name: 'Newsletter form check' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(p.getByRole('switch', { name: 'Cart actions check' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // Run stays pinned inside the 600px popup and the content area scrolls
  const run = p.locator('#run');
  await expect(run).toHaveText('Run Quick check');
  const box = (await run.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  expect(await p.locator('.content').evaluate((e) => getComputedStyle(e).overflowY)).toBe('auto');
  await expect(p.getByText('Alt+Shift+Q')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Open options' })).toBeVisible();
  await p.close();
});

test('Choose turns tiles into toggles and keeps at least one on', async () => {
  const p = await openPopup();
  const devices = p.locator('[data-testid=devices-card]');
  await devices.getByRole('button', { name: 'Choose' }).click();
  const tiles = devices.locator('button.tile');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  await expect(tiles.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(tiles.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(tiles.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await tiles.nth(2).click(); // the last one cannot be switched off
  await expect(tiles.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(p.locator('#run')).toBeEnabled();
  // restore the default for later tests
  await devices.getByRole('button', { name: 'All devices' }).click();
  await p.close();
});

test('Customize: presets switch to Custom on a single toggle and the choice is saved', async () => {
  const p = await openPopup();
  const groups = p.locator('[data-testid=groups-card]');
  await groups.getByRole('button', { name: /Customize/ }).click();
  for (const h of ['Page health', 'Content and looks', 'Behaviour', 'Shopify and custom']) {
    await expect(groups).toContainText(h);
  }
  await expect(groups.locator('[role=switch]')).toHaveCount(11);
  const preset = groups.getByRole('group', { name: 'Preset' });
  await expect(preset.getByRole('button', { name: 'Recommended' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await groups.getByRole('switch', { name: 'Accessibility' }).click();
  await expect(preset.getByRole('button', { name: 'Custom' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(preset.getByRole('button', { name: 'Recommended' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await preset.getByRole('button', { name: 'All' }).click();
  await expect(groups.getByRole('switch', { name: 'Custom rules' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await preset.getByRole('button', { name: 'Recommended' }).click();
  await expect(groups.getByRole('switch', { name: 'Custom rules' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await groups.getByRole('switch', { name: 'Layout' }).click();
  await p.close();

  // reopened popup remembers it
  const again = await openPopup();
  const g2 = again.locator('[data-testid=groups-card]');
  await expect(g2).toContainText('9');
  await expect(g2).toContainText('Off: Layout');
  await g2.getByRole('button', { name: /Customize/ }).click();
  await expect(g2.getByRole('switch', { name: 'Layout' })).toHaveAttribute('aria-checked', 'false');
  await expect(
    g2.getByRole('group', { name: 'Preset' }).getByRole('button', { name: 'Custom' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await g2.getByRole('switch', { name: 'Layout' }).click();
  await g2
    .getByRole('group', { name: 'Preset' })
    .getByRole('button', { name: 'Recommended' })
    .click();
  await again.close();
});

test('Pages mode: list management, validation, saved per origin, Run disabled when empty', async () => {
  const p = await openPopup();
  await p.getByRole('button', { name: 'Pages', exact: true }).click();
  const card = p.locator('[data-testid=pages-card]');
  await expect(card).toBeVisible();
  await expect(p.locator('#run')).toBeDisabled();
  await expect(p.getByRole('status')).toContainText('Add at least one page');

  // add by path, by full URL, and from the active tab
  await p.getByLabel('Add a URL or path').fill('/collections/all');
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(card.locator('.page-row')).toHaveCount(1);
  await p.getByLabel('Add a URL or path').fill(fx.clean + '/cart');
  await p.keyboard.press('Enter');
  await expect(card.locator('.page-row')).toHaveCount(2);
  await card.getByRole('button', { name: /Add this page/ }).click();
  await expect(card.locator('.page-row')).toHaveCount(3);
  await expect(card.locator('.page-row').nth(2)).toContainText('this tab');
  // preview parameters of the active tab are carried onto every entry
  await expect(card.locator('.page-row').nth(0)).toContainText('preview_theme_id=148302771');
  // duplicates are ignored, external origins rejected
  await card.getByRole('button', { name: /Add this page/ }).click();
  await expect(card.locator('.page-row')).toHaveCount(3);
  await p.getByLabel('Add a URL or path').fill('https://evil.example/x');
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('Only pages on');
  await expect(card.locator('.page-row')).toHaveCount(3);
  await expect(p.locator('#run')).toHaveText('Run Pages check · 3 pages');
  await expect(p.locator('#run')).toBeEnabled();
  await p.close();

  // saved for next time
  const again = await openPopup();
  await expect(again.locator('[data-testid=pages-card] .page-row')).toHaveCount(3);
  await again.getByRole('button', { name: 'Remove /cart?preview_theme_id=148302771' }).click();
  await expect(again.locator('[data-testid=pages-card] .page-row')).toHaveCount(2);
  for (let i = 0; i < 2; i++)
    await again.locator('[data-testid=pages-card] .icon-btn').first().click();
  await expect(again.locator('#run')).toBeDisabled();
  await again.getByRole('button', { name: 'Quick', exact: true }).click();
  await again.close();
});

test('cart actions ask for confirmation before the first run', async () => {
  const p = await openPopup();
  await p.getByRole('switch', { name: 'Cart actions check' }).click();
  await p.locator('#run').click();
  const dlg = p.getByRole('dialog');
  await expect(dlg).toContainText('Run cart actions on this store?');
  await expect(dlg).toContainText('Checkout is never opened');
  await dlg.getByRole('button', { name: 'Not now' }).click();
  await expect(p.getByRole('switch', { name: 'Cart actions check' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await p.close();
});
