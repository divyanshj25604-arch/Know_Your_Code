import { expect, test, type Page } from '@playwright/test';
import { goExplore, openFile, openWorkspace } from './helpers';
import { makeZip } from './fixtures/make-zip';

const viewerPath = (page: Page) => page.locator('.viewer-head .mono');
const graphRegion = (page: Page) => page.getByRole('region', { name: 'Graph' });
const node = (page: Page, name: RegExp) => graphRegion(page).getByRole('button', { name });

test.describe('Explore: code, graph and explanation as one workspace', () => {
  test('architecture drills from modules to files to functions, and each node opens its code', async ({
    page,
  }) => {
    await openWorkspace(page);
    // Orientation: the map is interactive on the project page, and the database client is labelled Likely.
    const map = page.getByRole('region', { name: 'Architecture map' });
    await expect(map.getByRole('button', { name: /^controllers,/ })).toBeVisible();
    await expect(
      map.getByRole('button', { name: /^mongoose, database client · package, Likely/ }),
    ).toBeVisible();
    await map.getByRole('button', { name: /^controllers,/ }).click();
    await expect(map.getByText(/Folder .* with 1 file/)).toBeVisible();
    await map.getByRole('button', { name: 'Explore this module' }).click();

    // Explore opens one level down: the module's files.
    await expect(page).toHaveURL(/\/explore/);
    const level = graphRegion(page).getByRole('navigation', { name: 'Graph level' });
    await expect(level).toContainText('Application › controllers');
    await node(page, /^authController\.js,/).click();
    await expect(viewerPath(page)).toHaveText('src/controllers/authController.js');
    await expect(page.getByRole('region', { name: 'What this file does' })).toContainText('defines');
    // Its relationship to the other module is drawn and labelled.
    await expect(node(page, /^services, other module/)).toBeVisible();

    // Select again to go a level deeper: the file's functions.
    await node(page, /^authController\.js,/).click();
    await expect(level).toContainText('authController.js');
    await node(page, /^login\(\),/).click();
    await expect(page.locator('.cm-kyc-target')).toContainText('async function login');
    // The explanation panel gets the selected function as its context, with verified connections.
    const panel = page.locator('.ws-panel');
    await expect(panel.getByRole('heading', { name: 'login', level: 2 })).toBeVisible();
    await expect(panel.getByRole('button', { name: /findUserByEmail/ }).first()).toBeVisible();
    // A call the analysis could not follow is a Not sure node, not a guess.
    await expect(node(page, /^Not followed \(\d+\).*Not sure/)).toBeVisible();

    // Up a level returns to the module.
    await graphRegion(page).getByRole('button', { name: '↑ Up a level' }).click();
    await expect(level).toContainText('Application › controllers');
    await graphRegion(page).getByRole('button', { name: 'Application' }).click();
    await expect(node(page, /^services,/)).toBeVisible();
  });

  test('code → graph: the open file and the function at the cursor are selected in the graph', async ({
    page,
  }) => {
    await openWorkspace(page);
    await openFile(page, 'src/services/userService.js');
    await graphRegion(page).getByRole('tab', { name: 'Dependencies' }).click();
    await expect(node(page, /^userService\.js,/)).toHaveAttribute('aria-pressed', 'true');
    await expect(node(page, /^authController\.js,/)).toBeVisible(); // it calls into this file
    await expect(node(page, /^user\.js,/)).toBeVisible(); // this file imports the model

    // Put the cursor inside findUserByEmail: the Functions view centres on it.
    await page.locator('.cm-line', { hasText: 'return User.findOne' }).click();
    await graphRegion(page).getByRole('tab', { name: 'Functions' }).click();
    await expect(graphRegion(page).getByText('Centred on findUserByEmail()')).toBeVisible();
    await expect(node(page, /^login,/)).toBeVisible(); // its caller

    // Selecting a relationship shows its evidence and can be explained.
    await graphRegion(page).getByRole('tab', { name: 'Dependencies' }).click();
    await node(page, /^userService\.js,/).click();
    const details = graphRegion(page).locator('.details');
    await details
      .getByRole('button', { name: /^← (imports|calls)/ })
      .first()
      .click();
    await expect(details).toContainText('Evidence:');
    await details.getByRole('button', { name: 'Explain this connection' }).click();
    await expect(page.locator('.ws-panel').getByRole('heading', { name: /What it does/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('a request flow is drawn step by step; a step opens its code and the walkthrough follows', async ({
    page,
  }) => {
    await openWorkspace(page);
    await goExplore(page);
    await graphRegion(page).getByRole('tab', { name: 'Request flows' }).click();
    const picker = graphRegion(page).getByLabel('Request flow');
    await expect(
      picker.getByRole('option', { name: /^POST \/auth\/login \(\d+ not followed\)$/ }),
    ).toHaveCount(1);
    await picker.selectOption({ index: 1 });
    await expect(node(page, /^1\. POST \/auth\/login/)).toBeVisible();
    await expect(node(page, /^6\. .*Not sure/)).toBeVisible();
    await node(page, /^3\. login/).click();
    const walk = page.getByRole('region', { name: 'Flow walkthrough' });
    await expect(walk.getByText(/Step 3 of 8: Handler — login/)).toBeVisible();
    await expect(viewerPath(page)).toHaveText('src/controllers/authController.js');
    await walk.getByRole('button', { name: 'Next step' }).click();
    await expect(node(page, /^4\. findUserByEmail/)).toHaveAttribute('aria-pressed', 'true');
  });

  test('a note on a graph node is saved, shown on the node after a reload, edited and deleted', async ({
    page,
  }) => {
    await openWorkspace(page);
    await openFile(page, 'src/controllers/authController.js');
    await graphRegion(page).getByRole('tab', { name: 'Dependencies' }).click();
    await node(page, /^authController\.js,/).click();
    await graphRegion(page)
      .getByRole('tab', { name: /^Notes/ })
      .click();
    await graphRegion(page)
      .getByLabel(/Add a note about src\/controllers\/authController\.js/)
      .fill('Entry for login');
    await graphRegion(page).getByRole('button', { name: 'Add note' }).click();
    await expect(graphRegion(page).getByText('Entry for login')).toBeVisible();

    await page.reload();
    await graphRegion(page).getByRole('tab', { name: 'Dependencies' }).click();
    await expect(node(page, /^authController\.js,.*✎ 1/)).toBeVisible({ timeout: 15_000 });
    await node(page, /^authController\.js,/).click();
    await graphRegion(page)
      .getByRole('tab', { name: /^Notes/ })
      .click();
    const note = graphRegion(page)
      .getByRole('list', { name: 'Notes on the selection' })
      .getByRole('listitem');
    await note.getByRole('button', { name: 'Edit' }).click();
    await note.getByLabel('Edit note').fill('Handles POST /auth/login');
    await note.getByRole('button', { name: 'Save' }).click();
    await expect(note).toContainText('Handles POST /auth/login');
    await note.getByRole('button', { name: 'Delete' }).click();
    await expect(graphRegion(page).getByText('Handles POST /auth/login')).toHaveCount(0);
  });
});

test.describe('import onboarding: GitHub and ZIP side by side', () => {
  test('a ZIP of a project is imported and analysed like a GitHub repository', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Try with your own repo' }).click();
    await expect(page.getByRole('heading', { name: 'From GitHub' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'From a ZIP file' })).toBeVisible();

    // A file that isn't a ZIP is refused before anything is sent.
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByText("That isn't a .zip file.")).toBeVisible();

    // A corrupt archive is rejected by the server with a clear message.
    await input.setInputFiles({
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('not a zip'),
    });
    await page.getByRole('button', { name: 'Analyse ZIP' }).click();
    await expect(page.getByText("We couldn't read this ZIP file.")).toBeVisible();

    const zip = makeZip({
      'tiny-api/package.json': '{"name":"tiny-api","dependencies":{"express":"^4.18.0"}}',
      'tiny-api/src/app.js':
        "const express = require('express');\nconst { hello } = require('./hello');\nconst app = express();\napp.get('/hello', hello);\nmodule.exports = app;\n",
      'tiny-api/src/hello.js':
        "function hello(req, res) {\n  res.send('hi');\n}\nmodule.exports = { hello };\n",
    });
    await input.setInputFiles({ name: 'tiny-api.zip', mimeType: 'application/zip', buffer: zip });
    await expect(page.getByText('tiny-api.zip')).toBeVisible();
    await page.getByRole('button', { name: 'Analyse ZIP' }).click();
    await expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Project:.*tiny-api/ })).toBeVisible();
    await openFile(page, 'src/hello.js');
    await expect(page.locator('.cm-content')).toContainText('function hello');
  });
});
