import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ERROR_CODES, type HealthView } from '@kyc/contracts';
import type { Config } from './config/env';
import type { Db } from './db/pool';
import { AppError } from './http/errors';
import { createServices, type Services } from './services';
import { registerApiRoutes } from './http/routes';
import { registerAiRoutes } from './http/aiRoutes';
import { registerSecurity } from './http/security';

export interface AppDeps {
  config: Config;
  db: Db;
  overrides?: {
    github?: import('./ingestion/github').GitHubClient;
    llm?: import('./ai/llm').LlmClient | null;
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
      // Never log request bodies/headers: they can carry repository URLs, questions, or cookies.
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      serializers: {
        req: (req) => ({ method: req.method, url: req.url?.split('?')[0], id: req.id }),
      },
    },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  app.decorate('deps', deps);
  const services = createServices(config, deps.db, app.log, deps.overrides);
  app.decorate('services', services);
  app.addHook('onClose', async () => {
    await services.runner.stop();
  });

  registerSecurity(app, config);
  await app.register(cookie, { secret: config.cookieSecret });
  if (!config.RATE_LIMIT_DISABLED) {
    await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.httpStatus).send(err.toBody());
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
    // Log the real cause server-side; show users a generic message with no internals.
    req.log.error(
      { err: { message: (err as Error).message, stack: (err as Error).stack } },
      'unhandled error',
    );
    return reply.status(500).send({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Something went wrong on our side.', retryable: true },
    });
  });

  app.get('/api/v1/health', async (): Promise<HealthView> => {
    let db: HealthView['db'] = 'ok';
    try {
      await deps.db.query('SELECT 1');
    } catch {
      db = 'down';
    }
    const ai: HealthView['ai'] =
      config.LLM_PROVIDER === 'fake'
        ? 'test_provider'
        : config.ANTHROPIC_API_KEY
          ? 'configured'
          : 'not_configured';
    return {
      status: db === 'ok' && ai !== 'not_configured' ? 'ok' : 'degraded',
      db,
      ai,
      github: config.GITHUB_TOKEN ? 'token' : 'anonymous',
      queueDepth: services.runner.depth,
      version: config.APP_VERSION,
    };
  });

  registerApiRoutes(app, services);
  registerAiRoutes(app, services);

  const staticDir = config.STATIC_DIR ?? path.resolve(process.cwd(), 'client/dist');
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
