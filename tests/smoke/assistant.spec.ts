import { expect, test } from '@playwright/test';
import { SMOKE_ANSWER, SMOKE_TOKEN } from './env';

/**
 * Ember assistant UI contract (Phase 8): FAB placement, panel dialog
 * semantics, keyboard toggling, mode switch, SSE streaming render, and
 * citation chips. `/api/assistant` is fully intercepted with a canned SSE
 * stream — zero OpenRouter spend, deterministic assertions.
 */

/** Canned SSE frames matching the route's event contract. */
const SSE_BODY = [
  'data: {"type":"delta","text":"Help"}',
  'data: {"type":"delta","text":" mode reply."}',
  'data: {"type":"done","answer":"Help mode reply.","sources":[]}',
  'data: [DONE]',
  '',
].join('\n\n');

const SSE_BODY_NOTES = [
  'data: {"type":"delta","text":"Found your notes about sourdough."}',
  'data: {"type":"done","answer":"Found your notes about sourdough.","sources":[{"kind":"note","note_id":7,"title":"Baking"}]}',
  'data: [DONE]',
  '',
].join('\n\n');

test.describe('ember assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('onboarded', '1'));
    await page.goto('/');

    // ---- Unlock (same flow as the main smoke spec) ----
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByLabel('Access token').fill(SMOKE_TOKEN);
    await page.getByRole('button', { name: 'Fetch my question' }).click();
    await page.getByLabel('Security answer').waitFor({ state: 'visible' });
    await page.getByLabel('Security answer').fill(SMOKE_ANSWER);
    await page.getByRole('button', { name: 'Unlock workspace' }).click();
    await page.getByLabel('Note editor').waitFor({ state: 'visible', timeout: 30_000 });
  });

  test('FAB opens the panel, streams a reply, and switches modes', async ({ page }) => {
    const sse = async (body: string) => ({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body,
    });
    await page.route('**/api/assistant', async (route) => {
      const payload = JSON.parse(route.request().postData() ?? '{}') as { mode?: string };
      await route.fulfill(await sse(payload.mode === 'notes' ? SSE_BODY_NOTES : SSE_BODY));
    });

    // ---- FAB → dialog with both modes ----
    const fab = page.getByRole('button', { name: /Open assistant/ });
    await expect(fab).toBeVisible();
    await fab.click();
    const dialog = page.getByRole('dialog', { name: 'Ember assistant' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Help' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Suggested prompts render on the empty state.
    await expect(dialog.getByText('How do I make a note recur every week?')).toBeVisible();

    // ---- Streaming reply in help mode ----
    await dialog.getByLabel('Message the assistant').fill('What does Ctrl+K do?');
    await dialog.getByRole('button', { name: 'Send message' }).click();
    await expect(dialog.getByText('Help mode reply.')).toBeVisible({ timeout: 15_000 });

    // ---- Mode switch clears the thread and relabels the composer ----
    await dialog.getByRole('tab', { name: 'My notes' }).click();
    await expect(dialog.getByText('Help mode reply.')).toHaveCount(0);
    await expect(dialog.getByText('Ask your notes')).toBeVisible();

    // ---- Notes mode streams with a citation chip ----
    await dialog.getByLabel('Message the assistant').fill('sourdough?');
    await dialog.getByRole('button', { name: 'Send message' }).click();
    await expect(dialog.getByText('Found your notes about sourdough.')).toBeVisible({
      timeout: 15_000,
    });
    const chip = dialog.getByRole('button', { name: /Baking/ });
    await expect(chip).toBeVisible();
    // Chip opens the note (id 7 may not exist in this workspace — the handler
    // still routes, which we observe as the panel staying open on desktop).
    await chip.click();
    await expect(dialog).toBeVisible();

    // ---- Escape closes; Ctrl+/ toggles ----
    await dialog.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(fab).toBeVisible();
    await page.keyboard.press('Control+/');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Control+/');
    await expect(dialog).toHaveCount(0);
  });

  test('quota errors surface as the assistant reply, not a crash', async ({ page }) => {
    await page.route('**/api/assistant', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Daily AI limit reached' }),
      });
    });

    await page.getByRole('button', { name: /Open assistant/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Ember assistant' });
    await dialog.getByLabel('Message the assistant').fill('hello');
    await dialog.getByRole('button', { name: 'Send message' }).click();
    await expect(dialog.getByText('Daily AI limit reached')).toBeVisible({ timeout: 15_000 });
    // Composer stays usable for a retry after the error.
    await expect(dialog.getByLabel('Message the assistant')).toBeEnabled();
  });
});
