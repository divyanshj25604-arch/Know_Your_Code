/**
 * Build-time configuration of the desktop shell (P4.1). Pure functions, tested by desktop/tests/config.test.mjs.
 *
 * The shell may only talk to the cloud API origins fixed at build time. They go into two places that must agree:
 * the Content-Security-Policy's connect-src (the web view cannot reach anything else) and the Rust binary
 * (`KYC_DESKTOP_API_ORIGINS`, which refuses to save any other server address). None of these values are secrets.
 */

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

export class DesktopConfigError extends Error {}

/** Parse and check a comma-separated origin list. Release builds need https and refuse local addresses. */
export function parseOrigins(raw, { release }) {
  const out = [];
  for (const part of (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    let u;
    try {
      u = new URL(part);
    } catch {
      throw new DesktopConfigError(`"${part}" is not a URL (expected https://api.example.com)`);
    }
    if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== ''))
      throw new DesktopConfigError(`"${part}" must be an origin only: scheme://host[:port], no path`);
    if (release && u.protocol !== 'https:')
      throw new DesktopConfigError(`"${part}" must use https in a release build`);
    if (release && LOCAL.has(u.hostname))
      throw new DesktopConfigError(
        `"${part}" is a local address; a release build must point at the cloud API`,
      );
    if (u.protocol !== 'https:' && u.protocol !== 'http:')
      throw new DesktopConfigError(`"${part}" must use https (or http for local development)`);
    if (!out.includes(u.origin)) out.push(u.origin);
  }
  return out;
}

export const BASE_CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  // CodeMirror injects <style> elements, as on the web (server/src/http/security.ts).
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  // Tauri's IPC channel (macOS/Linux use ipc:, Windows http://ipc.localhost), then the API origins.
  'connect-src': ['ipc:', 'http://ipc.localhost'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
};

export function cspFor(origins, extraConnect = []) {
  const d = structuredClone(BASE_CSP);
  d['connect-src'].push(...origins, ...extraConnect);
  return Object.entries(d)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/**
 * The configuration for one run of the Tauri CLI.
 *  - release (`build`): KYC_DESKTOP_API_ORIGINS is required (https, not local). A release build never falls back to
 *    localhost. KYC_DESKTOP_DEFAULT_API_URL, if set, must be on that list.
 *  - development (`dev`, `build --debug`): the API defaults to the local dev server; Vite's HMR socket is allowed.
 */
export function desktopBuildConfig(env, { release }) {
  const origins = release
    ? parseOrigins(env.KYC_DESKTOP_API_ORIGINS, { release: true })
    : parseOrigins(env.KYC_DESKTOP_API_ORIGINS || 'http://localhost:8080,http://localhost:5173', {
        release: false,
      });
  if (release && origins.length === 0)
    throw new DesktopConfigError(
      'KYC_DESKTOP_API_ORIGINS is required for a release build: the https origin(s) of the cloud API, e.g. https://api.example.com',
    );
  let defaultUrl = (env.KYC_DESKTOP_DEFAULT_API_URL ?? '').trim();
  if (!defaultUrl) defaultUrl = release ? (origins.length === 1 ? origins[0] : '') : origins[0];
  if (defaultUrl) {
    let o;
    try {
      o = new URL(defaultUrl).origin;
    } catch {
      throw new DesktopConfigError(`KYC_DESKTOP_DEFAULT_API_URL "${defaultUrl}" is not a URL`);
    }
    if (!origins.includes(o))
      throw new DesktopConfigError(
        `KYC_DESKTOP_DEFAULT_API_URL (${o}) must be one of KYC_DESKTOP_API_ORIGINS (${origins.join(', ')})`,
      );
  }
  const csp = cspFor(origins);
  const devCsp = cspFor(origins, ['ws://localhost:5173']);
  return {
    origins,
    defaultUrl,
    env: { KYC_DESKTOP_API_ORIGINS: origins.join(','), KYC_DESKTOP_DEFAULT_API_URL: defaultUrl },
    tauriConfig: { app: { security: release ? { csp } : { csp, devCsp } } },
  };
}
