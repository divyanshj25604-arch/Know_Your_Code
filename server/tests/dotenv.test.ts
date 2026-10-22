import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from '../src/config/dotenv';

const KEYS = ['KYC_TEST_A', 'KYC_TEST_B'];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe('loadDotEnv', () => {
  it('loads a .env from the working directory without overriding real environment variables', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kyc-env-'));
    writeFileSync(path.join(dir, '.env'), 'KYC_TEST_A=from-file\nKYC_TEST_B=from-file\n');
    process.env.KYC_TEST_B = 'from-env';
    expect(loadDotEnv(dir)).toBe(path.join(dir, '.env'));
    expect(process.env.KYC_TEST_A).toBe('from-file');
    expect(process.env.KYC_TEST_B).toBe('from-env');
  });

  it('finds the repo-root .env when started from a workspace directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kyc-env-'));
    writeFileSync(path.join(root, '.env'), 'KYC_TEST_A=root\n');
    const sub = path.join(root, 'server');
    mkdirSync(sub);
    expect(loadDotEnv(sub)).toBe(path.join(root, '.env'));
    expect(process.env.KYC_TEST_A).toBe('root');
  });

  it('does nothing when there is no .env', () => {
    expect(loadDotEnv(mkdtempSync(path.join(tmpdir(), 'kyc-none-')))).toBeNull();
  });
});
