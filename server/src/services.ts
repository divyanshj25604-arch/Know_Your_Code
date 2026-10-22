import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config/env';
import type { Db } from './db/pool';
import { GitHubClient } from './ingestion/github';
import { RateLimiter } from './http/limiter';
import { JobRunner } from './jobs/runner';
import { AiService } from './ai/service';
import { createLlm, type LlmClient } from './ai/llm';

export interface Services {
  config: Config;
  db: Db;
  github: GitHubClient;
  limiter: RateLimiter;
  runner: JobRunner;
  ai: AiService;
}

export function createServices(
  config: Config,
  db: Db,
  log: FastifyBaseLogger,
  overrides: { github?: GitHubClient; llm?: LlmClient | null } = {},
): Services {
  const github = overrides.github ?? new GitHubClient(config);
  const limiter = new RateLimiter(!config.RATE_LIMIT_DISABLED);
  const svc = { config, db, github, limiter } as Services;
  const llm = overrides.llm !== undefined ? overrides.llm : createLlm(config, log);
  svc.ai = new AiService(config, db, llm, log);
  svc.runner = new JobRunner(
    () => ({ config, db, github, log, summarise: llm ? (id) => svc.ai.summarise(id) : undefined }),
    db,
    log,
    config.IMPORT_CONCURRENCY,
  );
  return svc;
}
