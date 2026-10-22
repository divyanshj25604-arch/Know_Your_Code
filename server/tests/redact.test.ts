import { describe, expect, it } from 'vitest';
import { isSecretFile, redact, REDACTED } from '../src/privacy/redact';

describe('redact', () => {
  it('redacts well-known token formats', () => {
    const src = [
      "const aws = 'AKIAIOSFODNN7EXAMPLE';",
      "const gh = 'ghp_" + 'a'.repeat(36) + "';",
      "const ant = 'sk-ant-" + 'b'.repeat(30) + "';",
    ].join('\n');
    const r = redact(src);
    expect(r.text).not.toMatch(/AKIA|ghp_|sk-ant/);
    expect(r.count).toBe(3);
  });

  it('redacts only the secret value in assignments, keeping code shape', () => {
    const r = redact(`const config = { password: "hunter2-hunter2-hunter2", user: "bob" };`);
    expect(r.text).toBe(`const config = { password: "${REDACTED}", user: "bob" };`);
  });

  it('redacts the password in connection strings but keeps host', () => {
    const r = redact("const url = 'postgres://app:s3cretPass@db.internal:5432/app';");
    expect(r.text).toContain('postgres://app:[REDACTED]@db.internal');
  });

  it('preserves line count when redacting a private key block', () => {
    const key = ['-----BEGIN RSA PRIVATE KEY-----', 'AAAA', 'BBBB', '-----END RSA PRIVATE KEY-----'].join(
      '\n',
    );
    const src = `a\n${key}\nb`;
    const r = redact(src);
    expect(r.text.split('\n')).toHaveLength(src.split('\n').length);
    expect(r.text).not.toContain('AAAA');
  });

  it('leaves placeholders and env lookups alone', () => {
    const src = `const a = process.env.API_KEY;\nconst password = "<your-password-here>";\nconst secret = "xxxxxxxxxxxxxxxx";`;
    expect(redact(src)).toEqual({ text: src, count: 0 });
  });

  it('does not redact ordinary code', () => {
    const src = `function hashPassword(password) { return bcrypt.hash(password, 10); }`;
    expect(redact(src).count).toBe(0);
  });
});

describe('isSecretFile', () => {
  it.each([
    '.env',
    'server/.env.local',
    '.env.production',
    'keys/server.pem',
    'id_rsa',
    'a/b/.npmrc',
    'service-account-prod.json',
  ])('flags %s', (p) => expect(isSecretFile(p)).toBe(true));
  it.each(['.env.example', '.env.sample', 'src/environment.ts', 'README.md', 'src/keyboard.js'])(
    'allows %s',
    (p) => expect(isSecretFile(p)).toBe(false),
  );
});
