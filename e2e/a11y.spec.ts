import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { dblclickToken, openFile, openWorkspace } from './helpers';

async function check(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    label,
  ).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe (${scheme} theme)`, () => {
    test.use({ colorScheme: scheme });

    test('landing and start', async ({ page }) => {
      await page.goto('/');
      await check(page, 'landing');
      await page.goto('/start');
      await check(page, 'start');
    });

    test('overview, viewer and explanation panel', async ({ page }) => {
      await openWorkspace(page);
      await check(page, 'overview');
      await openFile(page, 'src/controllers/authController.js');
      await check(page, 'viewer');
      await dblclickToken(page, 'async function login', 'login');
      await page.getByRole('button', { name: /^Explain/ }).click();
      await expect(page.getByRole('heading', { name: /What it does/ })).toBeVisible({ timeout: 15_000 });
      await check(page, 'panel');
    });
  });
}
