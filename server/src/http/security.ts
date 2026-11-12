import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config/env';
import { SHARE_HEADER } from './snapshotAccess';

/** Content-Security-Policy for the SPA. Styles need 'unsafe-inline' because CodeMirror injects <style> elements. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE';
const CORS_HEADERS = ['authorization', 'content-type', 'accept', SHARE_HEADER];
const CORS_MAX_AGE_S = 600;

function forbidden(reply: FastifyReply, message: string) {
  return reply.status(403).send({ error: { code: 'INVALID_REQUEST', message, retryable: false } });
}

/**
 * Defence in depth on top of SameSite=Lax cookies and JSON-only bodies, plus a CORS allowlist for non-web clients:
 *  - Same-origin requests (and requests without an Origin, such as curl) behave as before.
 *  - Origins listed in CORS_ALLOWED_ORIGINS (a desktop shell) may call the API cross-origin. They get CORS headers
 *    for their exact origin, never `*` and never credentials; cookies are ignored for them and they must use bearer
 *    tokens (req.kycCrossOrigin, see auth/identity.ts).
 *  - Any other foreign Origin is refused (403), as are state-changing requests the browser marks cross-site.
 *  - Restrictive security headers on every response.
 */
export function registerSecurity(app: FastifyInstance, config: Config) {
  // The public URL is always an acceptable origin, so a reverse proxy that rewrites Host cannot lock users out.
  const publicHost = new URL(config.APP_BASE_URL).host;
  const allowed = new Set(config.CORS_ALLOWED_ORIGINS);

  /** 'same' (or no Origin), 'allowed' (allow-listed foreign origin) or 'foreign' (anything else). */
  const classify = (req: FastifyRequest): 'same' | 'allowed' | 'foreign' => {
    const origin = req.headers.origin;
    if (origin === undefined) return 'same';
    if (allowed.has(origin.toLowerCase())) return 'allowed';
    if (origin === 'null') return 'foreign';
    try {
      const url = new URL(origin);
      // Only a web page can be same-origin. Without this, `tauri://localhost` would match a server on localhost.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'foreign';
      // Compare normalised hosts (the URL parser drops default ports on both sides). The scheme is not compared,
      // so a TLS-terminating proxy (https outside, http inside) keeps working without TRUST_PROXY.
      const originHost = url.host;
      const sameHost =
        originHost === new URL(`${req.protocol}://${req.host}`).host || originHost === publicHost;
      return sameHost ? 'same' : 'foreign';
    } catch {
      return 'foreign';
    }
  };

  app.addHook('onRequest', async (req, reply) => {
    const kind = classify(req);
    req.kycCrossOrigin = kind === 'allowed';

    if (kind === 'allowed') {
      const origin = req.headers.origin!;
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
      // CORS preflight: answer it here (no route needs to exist for OPTIONS).
      if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
        return reply
          .status(204)
          .header('access-control-allow-methods', CORS_METHODS)
          .header('access-control-allow-headers', CORS_HEADERS.join(', '))
          .header('access-control-max-age', String(CORS_MAX_AGE_S))
          .send();
      }
      return undefined;
    }
    if (kind === 'foreign') return forbidden(reply, 'Requests from this origin are not allowed.');
    // As before P1.6: refuse state-changing requests the browser marks cross-site, whatever Origin says (a
    // cross-site redirect can present a misleading one).
    if (!SAFE_METHODS.has(req.method) && req.headers['sec-fetch-site'] === 'cross-site')
      return forbidden(reply, 'Cross-site requests are not allowed.');
    return undefined;
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('content-security-policy', CSP);
    if (config.NODE_ENV === 'production')
      reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
    if ((reply.getHeader('content-type') ?? '').toString().includes('json'))
      reply.header('cache-control', 'no-store');
    return payload;
  });
}
