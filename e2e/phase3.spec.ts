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

test.describe('P3.2 request flows and P3.6 walkthrough', () => {
  test('POST /auth/login is walked step by step with the code highlighted, and unknown hops are labelled', async ({
    page,
  }) => {
    await openWorkspace(page);
    await goMode(page, 'Project');
    const item = page.getByRole('listitem', { name: 'Flow POST /auth/login' });
    await expect(item).toContainText('handled by login');
    await item.getByRole('button', { name: 'Walk through POST /auth/login' }).click();
    await expect(page).toHaveURL(/\/explore/);
    const walk = page.getByRole('region', { name: 'Flow walkthrough' });
    const steps = walk.getByRole('list', { name: 'Flow steps' });
    await expect(steps.getByRole('listitem')).toHaveCount(8);
    await expect(steps.getByRole('listitem').nth(5)).toContainText('Not sure');
    await expect(steps.getByRole('listitem').nth(5)).toContainText(/no declaration was found/);
    await walk.getByRole('button', { name: 'Start' }).click();
    await expect(walk.getByText('Step 1 of 8: Route — POST /auth/login')).toBeVisible();
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/routes/auth.js');
    await expect(page.locator('.cm-kyc-target')).toContainText("router.post('/login', login);");
    await walk.getByRole('button', { name: 'Next step' }).click();
    await expect(walk.getByText(/Step 2 of 8: Middleware — express\.json\(\)/)).toBeVisible();
    await expect(page.locator('.cm-kyc-target')).toContainText('app.use(express.json());');
    await walk.getByRole('button', { name: 'Next step' }).click();
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/controllers/authController.js');
    await expect(page.locator('.cm-kyc-target')).toContainText('async function login');
    await walk.getByRole('button', { name: 'Next step' }).click();
    await expect(walk.getByText('Step 4 of 8: Calls — findUserByEmail')).toBeVisible();
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/services/userService.js');
    await expect(steps.locator('[aria-current="step"]')).toContainText('findUserByEmail');
    // Narration attaches to the verified step through its call edge.
    await walk.getByRole('button', { name: 'Narrate this flow' }).click();
    await expect(walk.getByLabel('Narration')).toHaveText('login calls findUserByEmail here.', {
      timeout: 15_000,
    });
    await walk.getByRole('button', { name: 'Previous step' }).click();
    await expect(walk.getByLabel('Narration')).toContainText('verified calls');
    // Play advances on its own, and can be paused.
    await walk.getByRole('button', { name: 'Play' }).click();
    await expect(walk.getByText(/Step 4 of 8/)).toBeVisible({ timeout: 5_000 });
    await walk.getByRole('button', { name: 'Pause' }).click();
    await walk.getByRole('button', { name: 'Close flow' }).click();
    await expect(walk).toHaveCount(0);
  });
});

test.describe('P3.7 learning paths', () => {
  test('a path with a mission, lessons and a knowledge check is completed and recorded', async ({ page }) => {
    await openWorkspace(page);
    await goMode(page, 'Project');
    const card = page.getByRole('listitem', { name: 'Path Follow a request: POST /auth/login' });
    await expect(card).toContainText('Not started');
    await card.getByRole('button', { name: 'Start Follow a request: POST /auth/login' }).click();
    await expect(page).toHaveURL(/\/learn/);
    const player = page.getByRole('region', { name: 'Learning path' });

    // Mission: find the handler in the code, then mark the place.
    const mission = player.getByRole('group', { name: 'Mission: Find the handler of POST /auth/login' });
    await expect(mission).toBeVisible();
    await openFile(page, 'src/app.js');
    await page.locator('.cm-line', { hasText: "app.use('/auth', authRoutes);" }).click();
    await mission.getByRole('button', { name: 'Mark this place' }).click();
    await expect(player.getByRole('status').first()).toContainText('Not this place.');
    await openFile(page, 'src/controllers/authController.js');
    await page.locator('.cm-line', { hasText: 'const user = await findUserByEmail' }).click();
    await mission.getByRole('button', { name: 'Mark this place' }).click();
    await expect(player.getByText('Found it.')).toBeVisible();

    // Lessons: real code opens in the viewer.
    await player.getByRole('button', { name: 'Next item' }).click();
    const reach = player.getByRole('group', { name: 'Lesson: How POST /auth/login reaches its handler' });
    await reach.getByRole('button', { name: /Open express\.json\(\)/ }).click();
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/app.js');
    await reach.getByRole('button', { name: 'Mark lesson complete' }).click();
    await expect(player.getByText('Lesson complete.')).toBeVisible();
    await player.getByRole('button', { name: 'Next item' }).click();
    const lesson = player.getByRole('group', { name: 'Lesson: What login does' });
    await lesson.getByRole('button', { name: /Open findUserByEmail/ }).click();
    await expect(page.locator('.viewer-head .mono')).toHaveText('src/services/userService.js');
    await lesson.getByRole('button', { name: 'Mark lesson complete' }).click();
    await expect(player.getByText('Lesson complete.')).toBeVisible();

    // Knowledge check, graded on the server.
    await player.getByRole('button', { name: 'Next item' }).click();
    const check = player.getByRole('group', { name: 'Knowledge check: What the handler calls' });
    await check.getByRole('button', { name: 'findUserByEmail', exact: true }).click();
    await expect(player.getByText(/Correct\. login calls findUserByEmail/)).toBeVisible();
    await expect(player.getByText('Path complete. Your progress is saved.')).toBeVisible();

    // Recorded on the server: still complete after a reload.
    await page.reload();
    await goMode(page, 'Project');
    await expect(
      page.getByRole('listitem', { name: 'Path Follow a request: POST /auth/login' }),
    ).toContainText('Completed');
  });
});
