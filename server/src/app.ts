import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ERROR_CODES, ERROR_MESSAGES, type HealthView } from '@kyc/contracts';
import { describeDbError, isDbConnectionError } from './ops/database';
import type { Config } from './config/env';
import type { Db } from './db/pool';
import { KycError } from '@kyc/core';
import { errorBody, httpStatusOf } from './http/errors';
import { createServices, type Services } from './services';
import { registerApiRoutes } from './http/routes';
import { registerAiRoutes } from './http/aiRoutes';
import { registerAuthRoutes } from './http/authRoutes';
import { registerLearningRoutes } from './http/learningRoutes';
import { registerSecurity } from './http/security';

/** Display names of the AI providers, for the privacy notice. */
const PROVIDER_NAMES = { anthropic: 'Anthropic', groq: 'Groq' } as const;

export interface AppDeps {
  config: Config;
  db: Db;
  overrides?: {
    github?: import('./ingestion/github').GitHubClient;
    llm?: import('./ai/llm').LlmClient | null;
    /** Evaluation harness only (server/eval): observe every AI evidence envelope. */
    aiObserver?: import('./ai/executor').RunObserver;
    /** Where logs go (tests capture them to prove secrets are never logged). Default: stdout. */
    logStream?: NodeJS.WritableStream;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    services: Services;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(deps.overrides?.logStream ? { stream: deps.overrides.logStream } : {}),
      // Never log request bodies/headers: they can carry repository URLs, questions, or cookies.
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      serializers: {
        req: (req) => ({ method: req.method, url: req.url?.split('?')[0], id: req.id }),
      },
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
  });
  app.decorate('deps', deps);
  const services = createServices(config, deps.db, app.log, deps.overrides);
  app.decorate('services', services);
  app.decorateRequest('kycCrossOrigin', false);
  app.addHook('onClose', async () => {
    await services.runner.stop();
  });

  registerSecurity(app, config);
  // 5xx visibility and alerting (P4.2).
  app.addHook('onResponse', async (_req, reply) => {
    services.monitor.recordResponse(reply.statusCode);
  });
  await app.register(cookie, { secret: config.cookieSecret });
  if (!config.RATE_LIMIT_DISABLED) {
    await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof KycError) {
      return reply.status(httpStatusOf(err)).send(errorBody(err));
    }
    const e = err as { statusCode?: number; validation?: unknown; code?: string };
    if (e.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: "You're going fast! Try again in a minute.",
          retryable: ERROR_CODES.RATE_LIMITED.retryable,
        },
      });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({
        error: { code: 'INVALID_REQUEST', message: 'That request was not valid.', retryable: false },
      });
    }
    if (isDbConnectionError(err)) {
      req.log.error({ event: 'database_unavailable', reason: describeDbError(err) }, 'database unavailable');
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: ERROR_MESSAGES.SERVICE_UNAVAILABLE.message,
          retryable: true,
        },
      });
    }
    // Record the real cause server-side (scrubbed, fingerprinted); show users a generic message with no internals.
    services.monitor.reportServerError(err, {
      method: req.method,
      route: req.routeOptions?.url ?? 'unknown',
      requestId: String(req.id),
    });
    return reply.status(500).send({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Something went wrong on our side.', retryable: true },
    });
  });

  // Liveness + readiness in one: 503 when the database is unreachable (the app cannot serve), 200 "degraded" when
  // only the AI provider is missing (browsing and verified relations still work). No secrets or hostnames are exposed.
  app.get('/api/v1/health', async (_req, reply): Promise<HealthView> => {
    let db: HealthView['db'] = 'ok';
    try {
      await deps.db.query('SELECT 1');
    } catch {
      db = 'down';
    }
    const ai: HealthView['ai'] =
      config.LLM_PROVIDER === 'fake'
        ? 'test_provider'
        : services.ai.configured
          ? 'configured'
          : 'not_configured';
    if (db === 'down') reply.status(503);
    return {
      status: db === 'ok' && ai !== 'not_configured' ? 'ok' : 'degraded',
      db,
      ai,
      github: config.GITHUB_TOKEN ? 'token' : 'anonymous',
      queueDepth: services.runner.depth,
      jobs: services.runner.paused ? 'standby' : 'active',
      version: config.APP_VERSION,
      privacy: {
        aiProvider:
          services.ai.configured && config.LLM_PROVIDER !== 'fake'
            ? PROVIDER_NAMES[config.LLM_PROVIDER]
            : null,
        retentionDays: config.RETENTION_DAYS,
      },
    };
  });

  registerAuthRoutes(app, services);
  registerApiRoutes(app, services);
  registerLearningRoutes(app, services);
  registerAiRoutes(app, services);

  const staticDir = path.resolve(config.STATIC_DIR ?? path.resolve(process.cwd(), 'client/dist'));
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: "We couldn't find that.", retryable: false } });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: "We couldn't find that.", retryable: false } }),
    );
  }
  return app;
}
