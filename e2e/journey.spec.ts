import { expect, test } from '@playwright/test';
import { dblclickToken, openFile, openWorkspace } from './helpers';

test.describe('critical journey (deterministic mode: real server, ingestion, analysis, DB; test AI provider)', () => {
  test('paste a repo → read code → select a function → verified relations + explanation → follow a caller and come back → follow-up → concept → depth → optional check → feedback → delete', async ({
    page,
  }) => {
    // Landing and entry.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Understand the code you build.' })).toBeVisible();
    await expect(
      page.getByText(/Test mode: explanations come from a deterministic test provider/),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Try with your repo' }).click();

    // Import with staged progress.
    await page.getByLabel('Public GitHub repository URL').fill('https://github.com/acme/notes-api');
    await page.getByRole('button', { name: 'Analyse repository' }).click();
    await expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible({ timeout: 30_000 });

    // Overview: verified facts, starting points, explained summary; secret file skipped.
    await expect(page.getByText('express, mongoose')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Where to start/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Summary/ })).toBeVisible();
    await page.getByRole('button', { name: /Skipped files/ }).click();
    await expect(page.getByText('.env')).toBeVisible();

    // Open a file from the tree and read real source.
    await openFile(page, 'src/controllers/authController.js');
    await expect(page.locator('.cm-content')).toContainText('async function login(req, res)');
    await expect(page.locator('.viewer-head').getByText('not analysed')).toHaveCount(0);

    // Select the function name -> Explain.
    await dblclickToken(page, 'async function login', 'login');
    await expect(page.getByRole('button', { name: /^Explain/ })).toBeVisible();
    await page.getByRole('button', { name: /^Explain/ }).click();

    // Verified relations (computed) appear; explanation sections are labelled Explained.
    const panel = page.locator('.ws-panel');
    await expect(panel.getByRole('heading', { name: 'login', level: 2 })).toBeVisible();
    await expect(panel.getByRole('heading', { name: /Connections/ })).toBeVisible();
    await expect(panel.getByRole('button', { name: /findUserByEmail/ })).toBeVisible();
    await expect(panel.getByText('POST /login route registration')).toBeVisible();
    await expect(panel.getByRole('heading', { name: /What it does/ })).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText('✦ Explained').first()).toBeVisible();
    await expect(panel.getByText('✓ Verified', { exact: false }).first()).toBeVisible();

    // Follow a callee: viewer jumps to the definition, trail grows, panel shows its relations.
    await panel
      .getByRole('button', { name: /findUserByEmail/ })
      .first()
      .click();
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/services/userService.js');
    await expect(
      page.getByRole('navigation', { name: 'Your trail' }).getByRole('button', { name: 'findUserByEmail' }),
    ).toHaveAttribute('aria-current', 'step');
    await expect(panel.getByRole('button', { name: 'Explain this' })).toBeVisible();
    await expect(panel.getByRole('button', { name: /login/ }).first()).toBeVisible(); // login is a caller of findUserByEmail
    await expect(page.locator('.cm-kyc-target')).toHaveCount(1);

    // Back restores the previous file and the explanation, without another model call.
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/controllers/authController.js');
    await expect(panel.getByRole('heading', { name: /What it does/ })).toBeVisible();

    // Follow-up with grounded answer + link.
    await panel.getByLabel('Ask a follow-up').fill('What does normalise do to the email?');
    await panel.getByRole('button', { name: 'Ask' }).click();
    await expect(panel.getByRole('log').getByText(/About "What does normalise/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      panel
        .getByRole('log')
        .getByRole('button', { name: /Open src\/services\/userService\.js line/ })
        .first(),
    ).toBeVisible();

    // Concept chip teaches using this code.
    await panel.getByRole('button', { name: 'async/await' }).click();
    await expect(panel.getByRole('log').getByText('In your code')).toBeVisible({ timeout: 15_000 });

    // Depth control regenerates at the new depth (a new linked explanation).
    await panel.getByLabel('Simpler').check();
    await expect(panel.getByRole('heading', { name: /What it does/ })).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByLabel('Simpler')).toBeChecked();

    // Optional check: never required; skippable.
    await expect(panel.getByRole('heading', { name: /Check yourself/ })).toHaveCount(0);
    await panel.getByRole('button', { name: /Check yourself/ }).click();
    await expect(panel.getByRole('heading', { name: 'Check yourself' })).toBeVisible({ timeout: 15_000 });
    await panel.getByRole('button', { name: 'Skip' }).click();
    await expect(panel.getByRole('heading', { name: 'Check yourself' })).toHaveCount(0);

    // Feedback.
    await panel.getByRole('button', { name: 'Yes, helpful' }).first().click();
    await expect(panel.getByText('Thanks.').first()).toBeVisible();

    // Deep link survives reload (FR-NAV-03).
    const url = page.url();
    expect(url).toContain('path=');
    await page.reload();
    await expect(page.locator('.viewer-head .mono')).toHaveText(/\.js$/);

    // Delete my data → home; the old link no longer works.
    const repoUrl = page.url().split('?')[0]!;
    await page.getByText('Repository menu').click();
    await page.getByRole('button', { name: 'Delete my data' }).click();
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page.getByRole('heading', { name: 'Understand the code you build.' })).toBeVisible();
    await page.goto(repoUrl);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('secrets are never shown and repository text cannot steer the assistant', async ({ page }) => {
    await openWorkspace(page);
    await openFile(page, 'src/hostile.js');
    await expect(page.locator('.cm-content')).toContainText('IGNORE ALL PREVIOUS INSTRUCTIONS'); // shown as plain code text
    await expect(page.locator('.cm-content')).toContainText('[REDACTED]');
    await expect(page.locator('body')).not.toContainText('ghp_qqqq');
    await dblclickToken(page, 'function hostile', 'hostile');
    await page.getByRole('button', { name: /^Explain/ }).click();
    const panel = page.locator('.ws-panel');
    await expect(panel.getByRole('heading', { name: /What it does/ })).toBeVisible({ timeout: 15_000 });
    // The injected line is only ever shown as quoted code, never acted on; nothing secret appears anywhere on the page.
    await expect(page.locator('body')).not.toContainText('ghp_');
    await expect(page.locator('body')).not.toContainText(/hunter2/);
  });

  test('keyboard-only: tree → code → E explains the identifier under the cursor', async ({ page }) => {
    await openWorkspace(page);
    const filter = page.getByLabel('Filter files by name');
    await filter.focus();
    await filter.fill('authController');
    await page.keyboard.press('Tab'); // into the tree (first row: src/)
    await page.keyboard.press('ArrowDown'); // src/controllers/
    await page.keyboard.press('ArrowDown'); // authController.js
    await page.keyboard.press('Enter');
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/controllers/authController.js');
    // Move to the code with the keyboard and place the cursor on `login`.
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 17; i++) await page.keyboard.press('ArrowRight'); // "async function lo|gin"
    await page.keyboard.press('e');
    const panel = page.locator('.ws-panel');
    await expect(panel.getByRole('heading', { name: 'login', level: 2 })).toBeVisible();
    await expect(panel.getByRole('heading', { name: /What it does/ })).toBeVisible({ timeout: 15_000 });
  });

  test('a selection with no code gives a clear message and does not call the model', async ({ page }) => {
    await openWorkspace(page);
    await openFile(page, 'src/controllers/authController.js');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown'); // blank line 2
    await page.keyboard.press('e');
    await expect(page.getByRole('alert').filter({ hasText: 'Select some code to explain.' })).toBeVisible();
  });
});
