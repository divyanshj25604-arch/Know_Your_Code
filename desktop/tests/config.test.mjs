import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DesktopConfigError, desktopBuildConfig, parseOrigins } from '../scripts/desktop-config.mjs';

const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const caps = JSON.parse(
  readFileSync(new URL('../src-tauri/capabilities/main.json', import.meta.url), 'utf8'),
);

test('a release build requires https cloud origins and never falls back to localhost', () => {
  assert.throws(() => desktopBuildConfig({}, { release: true }), /KYC_DESKTOP_API_ORIGINS is required/);
  assert.throws(
    () => desktopBuildConfig({ KYC_DESKTOP_API_ORIGINS: 'http://api.example.com' }, { release: true }),
    /must use https/,
  );
  assert.throws(
    () => desktopBuildConfig({ KYC_DESKTOP_API_ORIGINS: 'https://localhost:8443' }, { release: true }),
    /local address/,
  );
  const c = desktopBuildConfig({ KYC_DESKTOP_API_ORIGINS: 'https://api.example.com' }, { release: true });
  assert.deepEqual(c.origins, ['https://api.example.com']);
  assert.equal(c.defaultUrl, 'https://api.example.com');
  assert.equal(c.tauriConfig.app.security.devCsp, undefined);
});

test('the CSP allows only IPC and the configured API origins to be contacted', () => {
  const c = desktopBuildConfig(
    { KYC_DESKTOP_API_ORIGINS: 'https://api.example.com,https://staging.example.com' },
    { release: true },
  );
  const csp = c.tauriConfig.app.security.csp;
  const connect = csp.split('; ').find((d) => d.startsWith('connect-src'));
  assert.equal(
    connect,
    'connect-src ipc: http://ipc.localhost https://api.example.com https://staging.example.com',
  );
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /\*|unsafe-eval/);
  // Two origins and no explicit default: the user chooses on first launch.
  assert.equal(c.defaultUrl, '');
});

test('the default server must be one of the allowed origins', () => {
  assert.throws(
    () =>
      desktopBuildConfig(
        {
          KYC_DESKTOP_API_ORIGINS: 'https://api.example.com',
          KYC_DESKTOP_DEFAULT_API_URL: 'https://evil.test',
        },
        { release: true },
      ),
    DesktopConfigError,
  );
});

test('origins are origins: no paths, credentials or wildcards', () => {
  for (const bad of ['https://api.example.com/v1', 'https://u:p@api.example.com', '*', 'https://a.com?x=1'])
    assert.throws(() => parseOrigins(bad, { release: true }), DesktopConfigError, bad);
});

test('development defaults to the local API and allows Vite HMR only in devCsp', () => {
  const c = desktopBuildConfig({}, { release: false });
  assert.deepEqual(c.origins, ['http://localhost:8080', 'http://localhost:5173']);
  assert.match(c.tauriConfig.app.security.devCsp, /ws:\/\/localhost:5173/);
  assert.doesNotMatch(c.tauriConfig.app.security.csp, /ws:/);
});

test('the base tauri.conf.json fails closed and grants only the shell commands', () => {
  // Without the generated config, the web view may contact nothing but IPC.
  assert.match(conf.app.security.csp, /connect-src ipc: http:\/\/ipc\.localhost;/);
  assert.equal(conf.app.withGlobalTauri, false);
  assert.equal(conf.app.security.freezePrototype, true);
  assert.deepEqual(caps.windows, ['main']);
  assert.ok(
    caps.permissions.every((p) =>
      /^allow-(desktop-info|get-settings|set-api-url|token-(get|set|clear))$/.test(p),
    ),
  );
  assert.equal(caps.permissions.length, 6);
  // No signing secrets in the repository.
  assert.equal(conf.bundle.macOS.signingIdentity, undefined);
  assert.equal(conf.bundle.windows.certificateThumbprint, undefined);
});
