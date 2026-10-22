import { expect, test } from '@playwright/test';
import { dblclickToken, importRepo, openFile, openWorkspace } from './helpers';

test.describe('failure states are specific and recoverable', () => {
  test('malformed and non-GitHub URLs show inline hints before any request', async ({ page }) => {
    await page.goto('/start');
    const input = page.getByLabel('Public GitHub repository URL');
    await input.fill('not a url');
    await input.blur();
    await expect(page.getByText('Paste a link like https://github.com/user/project')).toBeVisible();
    await input.fill('https://gitlab.com/acme/app');
    await expect(page.getByText(/isn't a GitHub repository link/)).toBeVisible();
    await page.getByRole('button', { name: 'Analyse repository' }).click();
    await expect(page).toHaveURL(/\/start/); // did not navigate
  });

  test('missing/private repository → public-only explanation', async ({ page }) => {
    await importRepo(page, 'https://github.com/acme/ghost');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('We can only open public repositories right now.');
    await expect(alert).toContainText('Try a sample repository');
  });

  test('GitHub rate limit → retryable message', async ({ page }) => {
    await importRepo(page, 'https://github.com/acme/limited');
    await expect(page.getByRole('alert')).toContainText('GitHub is limiting requests');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('GitHub outage → temporary-unavailable message without internals', async ({ page }) => {
    await importRepo(page, 'https://github.com/acme/down');
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/ECONN|127\.0\.0\.1|stack/i);
  });

  test('repository with no JS/TS → UNSUPPORTED_LANGUAGE on the processing page, with a way out', async ({
    page,
  }) => {
    await importRepo(page, 'https://github.com/acme/python-only');
    await expect(page.getByRole('alert')).toContainText('No JavaScript/TypeScript files found.', {
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Try another repository' }).click();
    await expect(page).toHaveURL(/\/start/);
  });

  test('partially parseable repository opens, flags itself, and lists the skipped file', async ({ page }) => {
    await openWorkspace(page, 'acme/partial');
    await expect(page.getByText('partial', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Skipped files/ }).click();
    await expect(page.locator('.overview').getByText('bad.js')).toBeVisible();
    await openFile(page, 'bad.js'); // still viewable
    await expect(page.locator('.cm-content')).toContainText('function broken');
  });

  test('AI failure keeps verified connections visible and offers retry', async ({ page }) => {
    await openWorkspace(page);
    await openFile(page, 'src/timeout.js');
    await dblclickToken(page, 'function t', 't');
    await page.getByRole('button', { name: /^Explain/ }).click();
    const panel = page.getByRole('complementary', { name: 'Explanation' });
    await expect(panel.getByRole('alert')).toContainText("The explanation didn't finish.", {
      timeout: 15_000,
    });
    await expect(panel.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: /Connections/ })).toBeVisible();
    await expect(panel).toContainText('The connections above are still verified and clickable.');
  });

  test('unknown workspace id shows a not-found error with a way out', async ({ page }) => {
    await page.goto('/r/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Open another repository' }).click();
    await expect(page).toHaveURL(/\/start/);
  });
});
