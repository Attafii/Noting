import { expect, test, type Page } from '@playwright/test';

/**
 * Visual regression pass for the ink & ember redesign (Phase 8 gate).
 *
 * Captures the three shader screens (welcome, unlock, invite) at mobile
 * (390px) and desktop (1440px), dark + light, plus two behavioural frames:
 * reduced-motion must park the shader (byte-identical stills), and the
 * assistant FAB must never appear on public screens.
 *
 * Determinism notes:
 *  - `networkidle` is deliberately avoided (the PWA service worker keeps a
 *    connection open — navigation waits on a stable DOM selector instead).
 *  - Baselines set `ambient-motion=0` so the canvas paints exactly one
 *    static frame; the animated path is covered by the reduced-motion test.
 *  - `animations: 'disabled'` freezes CSS animations (ember dot, transitions).
 *
 * No credentials needed — these are all public screens.
 */

const PAGES = [
  { name: 'welcome', path: '/welcome', ready: 'h1' },
  // No stored token → the gate opens on the "New token" step.
  { name: 'unlock', path: '/', ready: 'text=Choose your security question' },
  { name: 'invite', path: '/invite', ready: 'text=Redeem an invite' },
] as const;

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

/** Theme + a parked shader so baseline captures are byte-stable. */
async function seedStableState(page: Page, mode: 'dark' | 'light'): Promise<void> {
  await page.addInitScript(
    (state) => {
      localStorage.setItem(
        'noting-theme',
        JSON.stringify({ mode: state.mode, accent: 'ember', density: 'comfortable' }),
      );
      // Park the ink field on its static frame for deterministic baselines.
      localStorage.setItem('ambient-motion', '0');
    },
    { mode },
  );
}

async function gotoReady(page: Page, path: string, ready: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 20_000 });
  // Fonts first (Newsreader swap would otherwise change text pixels between
  // frames), then let the entrance fade settle before any capture/probe.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(1200);
}

for (const viewport of VIEWPORTS) {
  for (const entry of PAGES) {
    for (const mode of ['dark', 'light'] as const) {
      test(`shader screen · ${entry.name} · ${viewport.name} · ${mode}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await seedStableState(page, mode);
        await gotoReady(page, entry.path, entry.ready);
        await expect(page).toHaveScreenshot(`${entry.name}-${viewport.name}-${mode}.png`, {
          fullPage: false,
          animations: 'disabled',
        });
      });
    }
  }
}

test('reduced motion renders a static shader frame (no animation drift)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Ambient motion stays ON — it is the OS preference that must park it.
  await page.addInitScript(() => {
    localStorage.setItem(
      'noting-theme',
      JSON.stringify({ mode: 'dark', accent: 'ember', density: 'comfortable' }),
    );
    localStorage.setItem('ambient-motion', '1');
  });
  await gotoReady(page, '/welcome', 'h1');
  const frameA = await page.screenshot();
  await page.waitForTimeout(900);
  const frameB = await page.screenshot();
  // With reduced motion the canvas must be parked: byte-identical frames.
  expect(frameB.equals(frameA)).toBe(true);
});

test('ambient motion ON animates the shader (frames differ)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'noting-theme',
      JSON.stringify({ mode: 'dark', accent: 'ember', density: 'comfortable' }),
    );
    localStorage.setItem('ambient-motion', '1');
  });
  await gotoReady(page, '/welcome', 'h1');
  // Park CSS animations so only the canvas can change between frames.
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; }' });
  await page.waitForTimeout(300);
  const frameA = await page.screenshot();
  await page.waitForTimeout(1200);
  const frameB = await page.screenshot();
  expect(frameB.equals(frameA)).toBe(false);
});

test('ember assistant FAB never appears on public screens', async ({ page }) => {
  await gotoReady(page, '/welcome', 'h1');
  await expect(page.getByRole('button', { name: /Open assistant/ })).toHaveCount(0);
  await gotoReady(page, '/invite', 'text=Redeem an invite');
  await expect(page.getByRole('button', { name: /Open assistant/ })).toHaveCount(0);
  // The unlock gate is not the workspace either — FAB stays absent.
  await gotoReady(page, '/', 'text=Choose your security question');
  await expect(page.getByRole('button', { name: /Open assistant/ })).toHaveCount(0);
});
