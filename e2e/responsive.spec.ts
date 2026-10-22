import { expect, test } from '@playwright/test';
import { openFile, openWorkspace } from './helpers';

test.describe('responsive layouts (docs/06 §E)', () => {
  test('tablet: tree is a drawer', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openWorkspace(page);
    await expect(page.getByRole('navigation', { name: 'Files' })).toBeHidden();
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Files' })).toBeVisible();
    await openFile(page, 'src/app.js');
    await expect(page.getByRole('navigation', { name: 'Files' })).toBeHidden(); // closes after choosing a file
  });

  test('mobile: reading works, panel is a bottom sheet, no horizontal page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await openWorkspace(page);
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await openFile(page, 'src/controllers/authController.js');
    await expect(page.locator('.cm-content')).toContainText('async function login');
    await expect(page.getByRole('complementary', { name: 'Explanation' })).toBeHidden();
    await page.getByRole('button', { name: 'Explanation', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Explanation' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
      true,
    );
  });
});
