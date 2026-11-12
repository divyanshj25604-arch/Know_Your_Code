import { expect, test, type Page } from '@playwright/test';
import { dblclickToken, openFile, openWorkspace } from './helpers';

const modes = (page: Page) => page.getByRole('navigation', { name: 'Modes' });
const panel = (page: Page) => page.locator('.ws-panel');

async function goMode(page: Page, name: 'Project' | 'Learn' | 'Explore' | 'Validate') {
  await modes(page).getByRole('link', { name }).click();
  await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}`));
}

async function explainLogin(page: Page) {
  await openFile(page, 'src/controllers/authController.js');
  await dblclickToken(page, 'async function login', 'login');
  await page.getByRole('button', { name: /^Explain/ }).click();
  await expect(panel(page).getByRole('heading', { name: /What it does/ })).toBeVisible({ timeout: 15_000 });
}

test.describe('P3.4 bookmarks, thread restore and guided tours', () => {
  test('a follow-up thread is restored after reload', async ({ page }) => {
    await openWorkspace(page);
    await explainLogin(page);
    await panel(page)
      .getByLabel(/Ask a follow-up/i)
      .fill('Why is it async?');
    await panel(page).getByRole('button', { name: /^Ask/ }).click();
    await expect(panel(page).getByText(/About "Why is it async\?"/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Place saved')).toBeVisible();
    await page.reload();
    await expect(panel(page).getByRole('heading', { name: /What it does/ })).toBeVisible({ timeout: 15_000 });
    await expect(panel(page).getByText('You asked: Why is it async?')).toBeVisible();
    await expect(panel(page).getByText(/About "Why is it async\?"/)).toBeVisible();
  });

  test('a bookmark is saved from the code and opened again from the project page', async ({ page }) => {
    await openWorkspace(page);
    await explainLogin(page);
    await page.locator('.viewer-head').getByRole('button', { name: 'Bookmark' }).click();
    await expect(page.locator('.viewer-head').getByRole('button', { name: 'Bookmarked' })).toBeVisible();
    await goMode(page, 'Project');
    const list = page.getByRole('region', { name: 'Your bookmarks' });
    await list.getByRole('button', { name: 'login', exact: true }).click();
    await expect(page).toHaveURL(/\/explore/);
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/controllers/authController.js');
  });

  test('the guided tour walks stops in order through the learning trail', async ({ page }) => {
    await openWorkspace(page);
    await goMode(page, 'Learn');
    await page.getByRole('button', { name: 'Guided tour' }).click();
    const tour = page.getByRole('region', { name: 'Guided tour' });
    await tour.getByRole('button', { name: 'Start the tour' }).click();
    await expect(tour.getByText(/Tour stop 1 of \d+: Start here: src\/app\.js/)).toBeVisible();
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/app.js');
    await tour.getByRole('button', { name: 'Next stop' }).click();
    await expect(tour.getByText(/Tour stop 2 of/)).toBeVisible();
    await tour.getByRole('button', { name: 'Previous stop' }).click();
    await expect(tour.getByText(/Tour stop 1 of/)).toBeVisible();
  });
});

test.describe('P3.1 architecture map', () => {
  test('modules are shown on the project page and each node links to its files', async ({ page }) => {
    await openWorkspace(page);
    await goMode(page, 'Project');
    const node = page.getByRole('listitem', { name: 'Module controllers' });
    await expect(node).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Module services' })).toBeVisible();
    await node.getByText('Files').click();
    await node.getByRole('button', { name: 'src/controllers/authController.js' }).click();
    await expect(page).toHaveURL(/\/explore/);
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/controllers/authController.js');
  });
});

test.describe('P3.5 assessment', () => {
  test('an open question is graded against its rubric and every attempt appears in the results', async ({
    page,
  }) => {
    await openWorkspace(page);
    await goMode(page, 'Learn');
    await expect(page.getByRole('button', { name: 'Explore freely' })).toBeVisible();
    await explainLogin(page);
    await expect(page.getByText('Place saved')).toBeVisible();
    await goMode(page, 'Validate');
    const item = page.locator('.validate-item').filter({ hasText: 'login' }).last();
    await item.getByRole('button', { name: 'Explain it in your own words' }).click();
    await item.getByLabel('Or answer in your own words').fill('It is about line 3.');
    await item.getByRole('button', { name: 'Check my answer' }).click();
    await expect(item.getByText('Partly right.')).toBeVisible();
    await expect(item.getByRole('list', { name: 'Rubric' })).toContainText('○ starts');
    const results = page.getByRole('region', { name: 'Your results' });
    await expect(results).toContainText('1 of 1 checks answered');
    await expect(results.getByRole('list', { name: 'Attempts, newest first' })).toContainText('Partly (50%)');
  });
});

test.describe('P3.3 concepts', () => {
  test('a concept shows real examples from two files and teaches from them', async ({ page }) => {
    await openWorkspace(page);
    await goMode(page, 'Project');
    const concept = page.getByRole('listitem', { name: 'Concept async await' });
    const examples = concept.getByRole('list', { name: 'Examples of async await' });
    await expect(examples).toContainText('src/controllers/authController.js');
    await expect(examples).toContainText('src/services/userService.js');
    await concept.getByRole('button', { name: 'Teach me async await' }).click();
    const lesson = concept.getByLabel('Lesson: async await');
    await expect(lesson).toBeVisible({ timeout: 15_000 });
    await examples.getByRole('button', { name: /findUserByEmail/ }).click();
    await expect(page).toHaveURL(/\/explore/);
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/services/userService.js');
  });
});
