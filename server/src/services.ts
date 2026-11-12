import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config/env';
import type { Db } from './db/pool';
import { GitHubClient } from './ingestion/github';
import { RateLimiter } from './http/limiter';
import { JobRunner } from './jobs/runner';
import { AiService } from './ai/service';
import { createLlm, type LlmClient } from './ai/llm';
import type { RunObserver } from './ai/executor';
import { IdentityService } from './auth/identity';
import { ShareTokens } from './auth/shareTokens';
import { Monitor } from './ops/monitor';

export interface Services {
  config: Config;
  db: Db;
  github: GitHubClient;
  limiter: RateLimiter;
  runner: JobRunner;
  ai: AiService;
  identity: IdentityService;
  shares: ShareTokens;
  monitor: Monitor;
}

export function createServices(
  config: Config,
  db: Db,
  log: FastifyBaseLogger,
  overrides: { github?: GitHubClient; llm?: LlmClient | null; aiObserver?: RunObserver } = {},
): Services {
  const github = overrides.github ?? new GitHubClient(config);
  const limiter = new RateLimiter(!config.RATE_LIMIT_DISABLED);
  const identity = new IdentityService(db, config, log);
  const shares = new ShareTokens(config.cookieSecret);
  const monitor = new Monitor(
    {
      windowMs: config.ALERT_WINDOW_MINUTES * 60_000,
      serverErrorThreshold: config.ALERT_5XX_THRESHOLD,
      jobFailureThreshold: config.ALERT_JOB_FAILURE_THRESHOLD,
      ...(config.ALERT_WEBHOOK_URL ? { webhookUrl: config.ALERT_WEBHOOK_URL } : {}),
      environment: config.DEPLOY_ENVIRONMENT,
      version: config.APP_VERSION,
    },
    log,
  );
  const svc = { config, db, github, limiter, identity, shares, monitor } as Services;
  const llm = overrides.llm !== undefined ? overrides.llm : createLlm(config, log);
  svc.ai = new AiService(config, db, llm, log, overrides.aiObserver);
  svc.runner = new JobRunner(
    () => ({ config, db, github, log, monitor, summarise: llm ? (id) => svc.ai.summarise(id) : undefined }),
    db,
    log,
    config.IMPORT_CONCURRENCY,
  );
  return svc;
}
