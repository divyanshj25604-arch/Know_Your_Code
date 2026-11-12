import { expect, type Page } from '@playwright/test';

export async function importRepo(page: Page, url: string) {
  await page.goto('/start');
  await page.getByLabel('Public GitHub repository URL').fill(url);
  await page.getByRole('button', { name: 'Analyse repository' }).click();
}

export async function openWorkspace(page: Page, repo = 'acme/notes-api') {
  await importRepo(page, `https://github.com/${repo}`);
  await expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible({ timeout: 30_000 });
}

/** Go to Explore through the mode navigation (imports land on the Project page). */
export async function goExplore(page: Page) {
  await page.getByRole('navigation', { name: 'Modes' }).getByRole('link', { name: 'Explore' }).click();
  await expect(page).toHaveURL(/\/explore/);
  await expect(page.getByRole('navigation', { name: 'Your trail' })).toBeVisible();
}

export async function openFile(page: Page, path: string) {
  const filter = page.getByLabel('Filter files by name');
  const files = page.getByRole('button', { name: 'Files', exact: true });
  // The file tree lives in Learn and Explore. On the Project page, go to Explore first. Where the tree is a drawer
  // (Learn's guide column, narrower screens), open it with Files.
  if (!(await page.getByRole('navigation', { name: 'Your trail' }).isVisible())) await goExplore(page);
  if (!(await filter.isVisible())) await files.click();
  // Filter by the full path and pick the row by its title: basenames like index.ts are not unique.
  await filter.fill(path);
  await page.locator(`[role="treeitem"][title="${path}"]`).click();
  await expect(page.locator('.viewer-head .mono')).toHaveText(path);
}

/** Double-click a token inside the code viewer (selects the word). */
export async function dblclickToken(page: Page, lineText: string, token: string) {
  const line = page.locator('.cm-line', { hasText: lineText }).first();
  await line.getByText(token, { exact: true }).first().dblclick();
}
