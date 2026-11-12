/**
 * Where the API lives and how requests authenticate (P1.6).
 *
 * - Web (default): the API is on the same origin as the page (`baseUrl: ''`) and the server's httpOnly cookies
 *   identify the user. Nothing secret is ever visible to scripts.
 * - Desktop and other non-web shells (later): an absolute `baseUrl` for the cloud API and `bearer` auth, with the
 *   token held by the shell's secure storage and supplied through `getToken`. The server must list the shell's
 *   origin in CORS_ALLOWED_ORIGINS.
 *
 * Only the base URL comes from the build (`VITE_API_BASE_URL`). Secrets never do: every `VITE_*` value is public,
 * compiled into the bundle.
 */
export type AuthStrategy =
  | { kind: 'cookie' }
  | {
      kind: 'bearer';
      /** Current session token, or null when signed out. Read on every request. */
      getToken: () => string | null;
      /** Called when the server rejects the token (expired, revoked): the shell should ask the user to sign in. */
      onUnauthorized?: () => void;
    };

export interface ApiConfig {
  /** '' for same origin, or an absolute http(s) URL with no query or fragment, e.g. https://api.example.com */
  baseUrl: string;
  auth: AuthStrategy;
}

export class ApiConfigError extends Error {
  constructor(message: string) {
    super(`Invalid API configuration: ${message}`);
    this.name = 'ApiConfigError';
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalise and check a base URL. `production` requires https for anything but a local address, so a build can
 * never send credentials in clear text over the network.
 */
export function resolveBaseUrl(raw: string | undefined, opts: { production: boolean }): string {
  const value = (raw ?? '').trim();
  if (value === '' || value === '/') return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiConfigError(`"${value}" is not an absolute URL (expected e.g. https://api.example.com)`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new ApiConfigError(`"${value}" must use https (or http for local development)`);
  if (url.username || url.password) throw new ApiConfigError('the base URL must not contain credentials');
  if (url.search || url.hash)
    throw new ApiConfigError('the base URL must not contain a query string or fragment');
  if (opts.production && url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname))
    throw new ApiConfigError(`"${value}" must use https in a production build`);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Validate a complete configuration. Cookie authentication only works when the API shares the page's origin (the
 * server never enables credentialed CORS), so a cross-origin base URL requires bearer authentication.
 */
export function validateApiConfig(
  config: ApiConfig,
  pageOrigin: string | null,
  production: boolean,
): ApiConfig {
  const baseUrl = resolveBaseUrl(config.baseUrl, { production });
  if (config.auth.kind === 'cookie' && baseUrl !== '' && pageOrigin !== null) {
    if (new URL(baseUrl).origin !== pageOrigin)
      throw new ApiConfigError(
        `cookie authentication needs the API on this page's origin (${pageOrigin}); use bearer authentication for ${new URL(baseUrl).origin}`,
      );
  }
  if (config.auth.kind === 'bearer' && typeof config.auth.getToken !== 'function')
    throw new ApiConfigError('bearer authentication needs a getToken function');
  return { ...config, baseUrl };
}
