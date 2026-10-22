import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config/env';
import type { Db } from './db/pool';
import { GitHubClient } from './ingestion/github';
import { RateLimiter } from './http/limiter';
import { JobRunner } from './jobs/runner';

export interface Services {
  config: Config;
  db: Db;
  github: GitHubClient;
  limiter: RateLimiter;
  runner: JobRunner;
}

export function createServices(
  config: Config,
  db: Db,
  log: FastifyBaseLogger,
  overrides: { github?: GitHubClient } = {},
): Services {
  const github = overrides.github ?? new GitHubClient(config);
  const limiter = new RateLimiter(!config.RATE_LIMIT_DISABLED);
  const svc = { config, db, github, limiter } as Services;
  svc.runner = new JobRunner(() => ({ config, db, github, log }), db, log, config.IMPORT_CONCURRENCY);
  return svc;
}
