import type { FastifyInstance } from 'fastify';
import type { Config } from '../config/env';

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

/**
 * Defence in depth on top of SameSite=Lax cookies and JSON-only bodies:
 *  - refuse state-changing requests that the browser marks cross-site, or whose Origin is not this host;
 *  - send restrictive security headers on every response.
 */
export function registerSecurity(app: FastifyInstance, config: Config) {
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    let bad = site === 'cross-site';
    if (!bad && typeof origin === 'string' && origin !== 'null') {
      try {
        // Compare normalised hosts (the URL parser drops default ports on both sides).
        bad = new URL(origin).host !== new URL(`${req.protocol}://${req.host}`).host;
      } catch {
        bad = true;
      }
    } else if (!bad && origin === 'null') bad = true;
    if (bad) {
      return reply.status(403).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Cross-site requests are not allowed.',
          retryable: false,
        },
      });
    }
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
