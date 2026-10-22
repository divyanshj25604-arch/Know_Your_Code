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

export async function openFile(page: Page, path: string) {
  const parts = path.split('/');
  const filter = page.getByLabel('Filter files by name');
  await filter.fill(parts[parts.length - 1]!);
  await page.getByRole('treeitem', { name: parts[parts.length - 1]!, exact: true }).click();
  await expect(page.locator('.viewer-head .mono')).toHaveText(path);
}

/** Double-click a token inside the code viewer (selects the word). */
export async function dblclickToken(page: Page, lineText: string, token: string) {
  const line = page.locator('.cm-line', { hasText: lineText }).first();
  await line.getByText(token, { exact: true }).first().dblclick();
}
