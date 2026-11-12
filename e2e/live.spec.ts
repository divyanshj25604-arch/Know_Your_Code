import { expect, test } from '@playwright/test';
import { dblclickToken, importRepo, openFile } from './helpers';

/**
 * LIVE integration tests (project "live"). They are external-integration tests, deliberately separate from the
 * deterministic suite:
 *  - GitHub: real downloads from codeload.github.com (needs network). Always run in this project.
 *  - Claude: real API calls, ONLY when ANTHROPIC_API_KEY is set. Otherwise the AI test below is skipped and the
 *    server runs with the deterministic test provider, so nothing here proves the live AI integration.
 * Run with: npm run test:live
 */
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

const SAMPLES = [
  { repo: 'expressjs/express', file: 'lib/application.js', minFiles: 100 },
  { repo: 'tj/commander.js', file: 'lib/command.js', minFiles: 100 },
  { repo: 'sindresorhus/ky', file: 'source/index.ts', minFiles: 50 },
];

for (const s of SAMPLES) {
  test(`LIVE GitHub: import ${s.repo} through the real pipeline and read its code`, async ({ page }) => {
    const t0 = Date.now();
    await importRepo(page, `https://github.com/${s.repo}`);
    await expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible({ timeout: 120_000 });
    const seconds = (Date.now() - t0) / 1000;
    console.log(`[live] ${s.repo}: workspace ready in ${seconds.toFixed(1)}s`);

    const facts = await page.locator('.facts').innerText();
    const files = Number(/Files\s+(\d+)/.exec(facts)?.[1] ?? 0);
    expect(files).toBeGreaterThanOrEqual(s.minFiles);
    expect(facts).toMatch(/Analysis\s+[\d,]+ symbols/);
    await expect(page.getByRole('heading', { name: /Where to start/ })).toBeVisible();

    await openFile(page, s.file);
    await expect(page.locator('.cm-content')).not.toBeEmpty();
    expect(seconds).toBeLessThan(90); // NFR-PERF-01 ceiling at the limit
  });
}

test('LIVE GitHub: a repository over the limits is rejected with the limit named (react)', async ({
  page,
}) => {
  await importRepo(page, 'https://github.com/facebook/react');
  await expect(page.getByRole('alert')).toContainText(
    /more than 1,500 analysable files|too many files|size limit/i,
    { timeout: 120_000 },
  );
  await expect(page.getByRole('button', { name: 'Try another repository' })).toBeVisible();
});

test('LIVE GitHub: a nonexistent repository gives the public-only message', async ({ page }) => {
  await importRepo(page, 'https://github.com/this-owner-does-not-exist-kyc/nope-nope-nope');
  await expect(page.getByRole('alert')).toContainText('We can only open public repositories right now.');
});

test.describe('LIVE Claude', () => {
  test.skip(!HAS_KEY, 'ANTHROPIC_API_KEY is not set: the real AI integration is NOT verified by this run.');

  test('LIVE Claude: a real explanation arrives, is structurally valid, and every link points at a real line', async ({
    page,
  }) => {
    await importRepo(page, 'https://github.com/tj/commander.js');
    await expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/Test mode/)).toHaveCount(0); // the real provider is active
    await openFile(page, 'lib/command.js');
    await dblclickToken(page, 'class Command', 'Command');
    await page.getByRole('button', { name: /^Explain/ }).click();
    const panel = page.locator('.ws-panel');
    await expect(panel.getByRole('heading', { name: /What it does/ })).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByRole('heading', { name: /Connections/ })).toBeVisible();

    // Every line link the model produced resolves to a line that exists in the viewed file.
    const lineCount = await page.locator('.cm-line').count();
    const chips = await panel.locator('.chip-ref').all();
    for (const c of chips.slice(0, 10)) {
      await c.click();
      await expect(page.locator('.cm-kyc-target')).toHaveCount(1);
      await page.keyboard.press('Alt+ArrowLeft');
    }
    expect(lineCount).toBeGreaterThan(0);

    // A follow-up works against the real provider too.
    await panel.getByLabel('Ask a follow-up').fill('What is this class used for in the rest of the library?');
    await panel.getByRole('button', { name: 'Ask' }).click();
    await expect(panel.getByRole('log').locator('.msg-ai')).toBeVisible({ timeout: 60_000 });
  });
});
