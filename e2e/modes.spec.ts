import { expect, test, type Page } from '@playwright/test';
import { dblclickToken, openFile, openWorkspace } from './helpers';

const viewerPath = (page: Page) => page.locator('.viewer-head .mono');
const modes = (page: Page) => page.getByRole('navigation', { name: 'Modes' });

/** Switch to Learn and wait until its own view is on screen (its tree replaces Explore's). */
async function goLearn(page: Page) {
  await modes(page).getByRole('link', { name: 'Learn' }).click();
  await expect(page.getByRole('button', { name: 'Explore freely' })).toBeVisible();
}

async function explainLogin(page: Page) {
  await openFile(page, 'src/controllers/authController.js');
  await dblclickToken(page, 'async function login', 'login');
  await page.getByRole('button', { name: /^Explain/ }).click();
  await expect(page.locator('.ws-panel').getByRole('heading', { name: /What it does/ })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('application shell and persistent workspace (P2.1, P2.2)', () => {
  test('all four modes are reachable from one shell', async ({ page }) => {
    await openWorkspace(page);
    await expect(page).toHaveURL(/\/r\/[0-9a-f-]+\/explore/);
    for (const [mode, check] of [
      ['Project', () => expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible()],
      ['Learn', () => expect(page.getByRole('navigation', { name: 'Your trail' })).toBeVisible()],
      ['Explore', () => expect(page.getByRole('navigation', { name: 'Your trail' })).toBeVisible()],
      [
        'Validate',
        () => expect(page.getByRole('heading', { name: 'Check your understanding' })).toBeVisible(),
      ],
    ] as const) {
      await modes(page).getByRole('link', { name: mode }).click();
      await expect(page).toHaveURL(new RegExp(`/${mode.toLowerCase()}`));
      await check();
    }
  });

  test('explore, reload, then "Return to learning" restores the exact learning step and its explanation', async ({
    page,
  }) => {
    await openWorkspace(page);
    await goLearn(page);
    await explainLogin(page);
    await expect(page.getByText('Place saved')).toBeVisible();

    // Explore somewhere else: the learning position must not move.
    await page.getByRole('button', { name: 'Explore freely' }).click();
    await expect(page.getByRole('button', { name: 'Return to learning' })).toBeVisible();
    await openFile(page, 'src/routes/auth.js');
    await expect(page.getByText('Place saved')).toBeVisible();

    await page.reload();
    await expect(viewerPath(page)).toHaveText('src/routes/auth.js', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Return to learning' }).click();
    await expect(page).toHaveURL(/\/learn/);
    await expect(viewerPath(page)).toHaveText('src/controllers/authController.js');
    const panel = page.locator('.ws-panel');
    await expect(panel.getByRole('heading', { name: 'login', level: 2 })).toBeVisible();
    await expect(panel.getByRole('heading', { name: /What it does/ })).toBeVisible();

    // And again after a reload while learning.
    await page.reload();
    await expect(viewerPath(page)).toHaveText('src/controllers/authController.js', { timeout: 15_000 });
    await expect(panel.getByRole('heading', { name: /What it does/ })).toBeVisible();
  });

  test('going back and somewhere new keeps the forward trail, also after a reload', async ({ page }) => {
    await openWorkspace(page);
    await openFile(page, 'src/app.js');
    await openFile(page, 'src/routes/auth.js');
    await page.getByRole('button', { name: 'Back (Alt+Left)' }).click();
    await expect(viewerPath(page)).toHaveText('src/app.js');
    await openFile(page, 'src/models/user.js'); // a new branch from src/app.js
    await page.getByRole('button', { name: 'Back (Alt+Left)' }).click();
    await page.getByRole('button', { name: 'Forward (Alt+Right)' }).click();
    await expect(viewerPath(page)).toHaveText('src/models/user.js');
    await expect(page.getByText('Place saved')).toBeVisible();

    await page.goto(page.url().replace(/\?.*$/, '')); // reload without the deep link
    await expect(viewerPath(page)).toHaveText('src/models/user.js', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Back (Alt+Left)' }).click();
    await expect(viewerPath(page)).toHaveText('src/app.js');
  });

  test('Validate checks understanding of what was explained, reusing the panel parts', async ({ page }) => {
    await openWorkspace(page);
    await goLearn(page);
    await explainLogin(page);
    await expect(page.getByText('Place saved')).toBeVisible();
    await modes(page).getByRole('link', { name: 'Validate' }).click();
    const item = page.locator('.validate-item').filter({ hasText: 'login' });
    await item.getByText('login', { exact: true }).click(); // expand: the explanation sections
    await expect(item.getByRole('heading', { name: /What it does/ })).toBeVisible();
    await item.getByRole('button', { name: /Check yourself/ }).click();
    await item.getByRole('radio').first().check();
    await item.getByRole('button', { name: 'Submit' }).click();
    await expect(item.getByText(/That matches the code|Not quite/)).toBeVisible();
  });
});
