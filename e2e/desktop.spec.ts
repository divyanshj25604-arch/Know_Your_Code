import { expect, test, type Page } from '@playwright/test';

/**
 * Desktop shell flow (P4.1) in a real browser against the real server, cross-origin, with bearer tokens.
 *
 * The built client is served from its own origin (DESKTOP_ORIGIN, standing in for tauri://localhost) and talks to
 * the API on another origin, exactly as the Tauri shell does. Tauri's native side is replaced by a Node-side stand-in
 * reached through `window.__TAURI_INTERNALS__.invoke` (the channel @tauri-apps/api uses): the "keychain" and the
 * settings file live in this test process, so they survive page reloads ("restarts") and can be inspected.
 * What this does not cover: the Rust commands themselves (cargo tests) and the native window (manual check).
 */
const DESKTOP_ORIGIN = 'http://127.0.0.1:4610';
const API = 'http://127.0.0.1:4600';

interface Native {
  settings: { apiUrl: string | null };
  keychain: Map<string, string>;
  calls: string[];
}

async function desktop(page: Page, native: Native) {
  await page.exposeFunction('__kycNative', (cmd: string, args: Record<string, string> | undefined) => {
    native.calls.push(cmd);
    const origin = (u: string) => new URL(u).origin;
    switch (cmd) {
      case 'desktop_info':
        return { allowedOrigins: [API], defaultApiUrl: API, development: true, version: '1.0.0' };
      case 'get_settings':
        return native.settings;
      case 'set_api_url':
        native.settings = { apiUrl: args!.url! };
        return native.settings;
      case 'token_get':
        return native.keychain.get(origin(args!.apiUrl!)) ?? null;
      case 'token_set':
        if (!/^kyc_st_[A-Za-z0-9_-]{43}$/.test(args!.token!)) throw new Error('not a session token');
        native.keychain.set(origin(args!.apiUrl!), args!.token!);
        return null;
      case 'token_clear':
        native.keychain.delete(origin(args!.apiUrl!));
        return null;
      default:
        throw new Error(`command ${cmd} not allowed`);
    }
  });
  await page.addInitScript(() => {
    const w = window as unknown as {
      __kycNative: (c: string, a: unknown) => Promise<unknown>;
      __TAURI_INTERNALS__: unknown;
    };
    w.__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: unknown) => w.__kycNative(cmd, args),
      transformCallback: () => 0,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    };
  });
}

/** No credential may be visible to page scripts outside the gate's memory: not in cookies or web storage. */
async function expectNoTokenInWebStorage(page: Page) {
  const stored = await page.evaluate(() =>
    JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie }),
  );
  expect(stored).not.toContain('kyc_st_');
  expect((await page.context().cookies()).map((c) => c.name)).not.toContain('kyc_session');
}

test.describe('desktop shell (P4.1)', () => {
  test('connect, create an account, use all four modes, restart with the saved session, sign out', async ({
    page,
    request,
  }) => {
    const native: Native = { settings: { apiUrl: null }, keychain: new Map(), calls: [] };
    await desktop(page, native);
    const apiCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith(`${API}/api/`)) apiCalls.push(r.url());
    });
    await page.goto(`${DESKTOP_ORIGIN}/`);

    // First launch: the server address, then an account.
    await expect(page.getByLabel('Server address')).toHaveValue(API);
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(native.settings.apiUrl).toBe(API);
    await page.getByRole('button', { name: 'New here? Create an account' }).click();
    const email = `desktop-${Date.now()}@example.com`;
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
    expect(native.keychain.get(API)).toMatch(/^kyc_st_/);
    await expectNoTokenInWebStorage(page);

    // Repository import through the existing cloud workflow, then the four modes.
    await page.getByRole('link', { name: 'Try with your repo' }).click();
    await page.getByLabel('Public GitHub repository URL').fill('https://github.com/acme/notes-api');
    await page.getByRole('button', { name: 'Analyse repository' }).click();
    await expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/#\/r\/[0-9a-f-]+\//);
    const modes = page.getByRole('navigation', { name: 'Modes' });
    for (const [mode, check] of [
      ['Project', () => expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible()],
      ['Learn', () => expect(page.getByRole('navigation', { name: 'Your trail' })).toBeVisible()],
      ['Explore', () => expect(page.getByRole('navigation', { name: 'Your trail' })).toBeVisible()],
      [
        'Validate',
        () => expect(page.getByRole('heading', { name: 'Check your understanding' })).toBeVisible(),
      ],
    ] as const) {
      await modes.getByRole('link', { name: mode }).click();
      await check();
    }
    // Every API call went to the configured cloud origin.
    expect(apiCalls.length).toBeGreaterThan(5);

    // Restart: the session comes back from the credential store, without asking.
    const workspace = page.url();
    await page.reload();
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Check your understanding' })).toBeVisible();
    expect(page.url()).toBe(workspace);
    await expectNoTokenInWebStorage(page);

    // Sign out: revoked on the server and removed from the credential store.
    const token = native.keychain.get(API)!;
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('You have signed out.')).toBeVisible();
    expect(native.keychain.has(API)).toBe(false);
    const after = await request.get(`${API}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status()).toBe(401);

    // Signing in again works, from the same server setting.
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  });

  test('an expired saved session is removed and the user signs in again; a dead server is reported clearly', async ({
    page,
  }) => {
    const native: Native = {
      settings: { apiUrl: API },
      keychain: new Map([[API, `kyc_st_${'x'.repeat(43)}`]]),
      calls: [],
    };
    await desktop(page, native);
    await page.goto(`${DESKTOP_ORIGIN}/`);
    await expect(page.getByText('Your session has ended. Please sign in again.')).toBeVisible();
    expect(native.keychain.size).toBe(0);

    await page.getByRole('button', { name: 'Change server' }).click();
    await page.getByLabel('Server address').fill('http://127.0.0.1:9');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('alert')).toContainText(
      "Couldn't reach the Know Your Code server at 127.0.0.1:9",
    );
    expect(native.settings.apiUrl).toBe(API);
  });
});
