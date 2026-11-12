import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { buildApp } from '../src/app';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { hashToken, isWellFormedToken, newSessionToken } from '../src/auth/tokens';
import { runRetention } from '../src/jobs/retention';
import { Device } from './device';
import { Harness } from './harness';
import { testConfig } from './helpers';

const h = new Harness();
const app = () => h.app;
const SHA = 'abc123'.padEnd(40, '0');
const REPOS = {
  'acme/notes-api': { fixture: 'express-cjs' },
  'acme/shop': { fixture: 'react-ts' },
};
const LOGIN_SEL = {
  path: 'src/controllers/authController.js',
  startLine: 4,
  startCol: 15,
  endLine: 4,
  endCol: 52,
};

beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: REPOS }));
afterEach(() => h.close());

const count = async (sql: string, params: unknown[] = []) =>
  (await h.db.query<{ n: number }>(sql, params)).rows[0]!.n;

describe('password hashing (unit)', () => {
  it('verifies the right password, rejects others, and salts every hash', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterY', a)).toBe(false);
    expect(await verifyPassword('', a)).toBe(false);
  });

  it('treats Unicode-equivalent passwords as equal (NFKC) and malformed hashes as a non-match', async () => {
    const hash = await hashPassword('ﬁle-cabinet-42'); // ligature "ﬁ"
    expect(await verifyPassword('file-cabinet-42', hash)).toBe(true);
    for (const bad of [
      '',
      'plain',
      'scrypt$x$8$1$a$b',
      'scrypt$15$8$1$$',
      'bcrypt$15$8$1$a$b',
      'scrypt$99$8$1$a$b',
    ])
      expect(await verifyPassword('x', bad)).toBe(false);
  });
});

describe('session tokens (unit)', () => {
  it('are 256-bit, prefixed, well-formed and stored only as a SHA-256 hash', () => {
    const t = newSessionToken();
    expect(isWellFormedToken(t)).toBe(true);
    expect(t).toMatch(/^kyc_st_/);
    expect(hashToken(t)).toHaveLength(32);
    expect(newSessionToken()).not.toBe(t);
    for (const bad of ['', 'kyc_st_short', `x${t}`, `${t} `, t.replace('kyc_st_', 'kyc_xx_')])
      expect(isWellFormedToken(bad)).toBe(false);
  });
});

describe('registration upgrades the anonymous user in place', () => {
  it('keeps the same user id, so everything imported anonymously stays with the account', async () => {
    const laptop = new Device(app);
    const { snapshotId } = await laptop.importRepo('acme/notes-api');
    const anonId = (await h.db.query<{ owner_id: string }>('SELECT owner_id FROM repositories')).rows[0]!
      .owner_id;

    const res = await laptop.register('Ada@Example.com');
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toEqual({ id: anonId, kind: 'registered', email: 'ada@example.com' });
    expect(body.token).toBeUndefined(); // web sessions never expose the token to page scripts
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/kyc_session=kyc_st_[^;]+;.*HttpOnly/i);
    expect(setCookie).toMatch(/kyc_session=[^;]+;.*SameSite=Lax/i);
    expect(laptop.jar.has('kyc_owner')).toBe(false); // the anonymous cookie is retired

    expect((await laptop.get('/api/v1/auth/me')).json().user).toMatchObject({
      id: anonId,
      kind: 'registered',
    });
    expect((await laptop.mySnapshots()).map((s) => s.snapshotId)).toEqual([snapshotId]);
    expect(await count('SELECT count(*)::int AS n FROM users')).toBe(1);
  });

  it('creates a fresh account when there is no anonymous work', async () => {
    const d = new Device(app);
    const res = await d.register('new@example.com');
    expect(res.statusCode).toBe(201);
    expect(res.json().user.kind).toBe('registered');
  });
});

describe('two devices, one learner (acceptance: P1.2)', () => {
  it('sees the same authorised repositories from a second browser and from a bearer-token client', async () => {
    const laptop = new Device(app);
    const notes = await laptop.importRepo('acme/notes-api');
    await laptop.register('ada@example.com');
    const shop = await laptop.importRepo('acme/shop'); // imported while signed in

    const desktopBrowser = new Device(app);
    expect((await desktopBrowser.login('ADA@example.com')).statusCode).toBe(200);
    const ids = (await desktopBrowser.mySnapshots()).map((s) => s.snapshotId).sort();
    expect(ids).toEqual([notes.snapshotId, shop.snapshotId].sort());

    const tablet = Device.bearer(app);
    const login = await tablet.login('ada@example.com', undefined, 'bearer');
    expect(login.statusCode).toBe(200);
    expect(login.json().token).toMatch(/^kyc_st_/);
    expect(login.headers['set-cookie']).toBeUndefined(); // bearer clients get no cookie
    expect((await tablet.mySnapshots()).map((s) => s.snapshotId).sort()).toEqual(ids);

    // The second device can act on the shared repository, not just list it.
    const ex = await tablet.post('/api/v1/explanations', {
      snapshotId: notes.snapshotId,
      selection: LOGIN_SEL,
    });
    expect(ex.statusCode).toBe(200);
    expect(ex.body).toContain('event: done');
  });

  it('keeps another learner out', async () => {
    const ada = new Device(app);
    await ada.importRepo('acme/notes-api');
    await ada.register('ada@example.com');
    const bob = new Device(app);
    await bob.register('bob@example.com');
    expect(await bob.mySnapshots()).toEqual([]);
  });
});

describe('claiming anonymous work into an existing account', () => {
  async function account() {
    const first = new Device(app);
    await first.register('ada@example.com');
    return first;
  }

  it('signs in, reports what can be claimed, and claims it atomically', async () => {
    const ada = await account();
    const owned = await ada.importRepo('acme/shop');

    const libraryPc = new Device(app);
    const anon = await libraryPc.importRepo('acme/notes-api');
    const login = await libraryPc.login('ada@example.com');
    expect(login.json().claimable).toEqual({ repositories: 1 });
    // Signed in, the account's view does not silently include the anonymous work yet.
    expect((await libraryPc.mySnapshots()).map((s) => s.snapshotId)).toEqual([owned.snapshotId]);

    const claim = await libraryPc.post('/api/v1/auth/claim');
    expect(claim.statusCode).toBe(200);
    expect(claim.json().claimed).toMatchObject({ repositories: 1, snapshots: 1 });
    expect(libraryPc.jar.has('kyc_owner')).toBe(false);
    const ids = (await ada.mySnapshots()).map((s) => s.snapshotId).sort();
    expect(ids).toEqual([anon.snapshotId, owned.snapshotId].sort());
    expect(await count(`SELECT count(*)::int AS n FROM users WHERE kind='anonymous'`)).toBe(0);

    // Claiming again is a clean no-op error, not a crash or a double move.
    expect((await libraryPc.post('/api/v1/auth/claim')).statusCode).toBe(404);
  });

  it('merges a repository both imported at the same commit, keeping the explanations', async () => {
    const ada = await account();
    const mine = await ada.importRepo('acme/notes-api', SHA);

    const libraryPc = new Device(app);
    const theirs = await libraryPc.importRepo('acme/notes-api', SHA);
    expect(theirs.snapshotId).not.toBe(mine.snapshotId);
    const ex = await libraryPc.post('/api/v1/explanations', {
      snapshotId: theirs.snapshotId,
      selection: LOGIN_SEL,
    });
    const explanationId = /"explanationId":"([0-9a-f-]+)"/.exec(ex.body)![1]!;

    await libraryPc.login('ada@example.com');
    const claim = await libraryPc.post('/api/v1/auth/claim');
    expect(claim.json().claimed).toMatchObject({ repositories: 1, snapshots: 0, explanations: 1 });

    // One repository row, one snapshot of that commit; the explanation now lives on the account's snapshot.
    expect(await count(`SELECT count(*)::int AS n FROM repositories WHERE gh_name='notes-api'`)).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM snapshots')).toBe(1);
    const restored = await ada.get(`/api/v1/explanations/${explanationId}`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json().snapshotId).toBe(mine.snapshotId);
  });

  it('requires the account session: no session, a bearer token, or a forged anonymous cookie claim nothing', async () => {
    const victim = new Device(app);
    await victim.importRepo('acme/notes-api');
    const victimAnon = (await h.db.query<{ owner_id: string }>('SELECT owner_id FROM repositories')).rows[0]!
      .owner_id;

    // Not signed in.
    expect((await victim.post('/api/v1/auth/claim')).statusCode).toBe(401);

    // An attacker with their own account and a forged (unsigned) copy of the victim's anonymous id.
    const attacker = new Device(app);
    await attacker.register('mallory@example.com');
    attacker.jar.set('kyc_owner', victimAnon);
    expect((await attacker.post('/api/v1/auth/claim')).statusCode).toBe(404);

    // Bearer sessions cannot claim browser work.
    const tool = Device.bearer(app);
    await tool.login('mallory@example.com', undefined, 'bearer');
    expect((await tool.post('/api/v1/auth/claim')).statusCode).toBe(400);

    expect(await count('SELECT count(*)::int AS n FROM repositories WHERE owner_id=$1', [victimAnon])).toBe(
      1,
    );
  });

  it('an old anonymous cookie never authenticates the account it was upgraded into', async () => {
    const laptop = new Device(app);
    await laptop.importRepo('acme/notes-api');
    const oldAnonCookie = laptop.jar.get('kyc_owner')!;
    await laptop.register('ada@example.com');

    // Someone replays the retired (validly signed) anonymous cookie.
    const replay = new Device(app);
    replay.jar.set('kyc_owner', oldAnonCookie);
    expect((await replay.get('/api/v1/auth/me')).json().user).toBeNull();
    expect(await replay.mySnapshots()).toEqual([]); // a brand-new anonymous user, not the account
  });
});

describe('credentials and tokens (negative cases)', () => {
  beforeEach(async () => {
    await new Device(app).register('ada@example.com');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await new Device(app).login('ada@example.com', 'not the password');
    const unknown = await new Device(app).login('nobody@example.com', 'not the password');
    for (const r of [wrong, unknown]) {
      expect(r.statusCode).toBe(401);
      expect(r.json().error).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: "That email and password don't match an account.",
        retryable: false,
      });
      expect(r.headers['set-cookie'] ?? '').not.toMatch(/kyc_session=kyc_st_/);
    }
  });

  it('rejects duplicate emails (case-insensitively), weak passwords and malformed input', async () => {
    expect((await new Device(app).register('ADA@example.com')).json().error.code).toBe('EMAIL_TAKEN');
    expect((await new Device(app).register('x@example.com', 'short')).statusCode).toBe(400);
    expect(
      (
        await new Device(app).post('/api/v1/auth/register', {
          email: 'not-an-email',
          password: 'x'.repeat(12),
        })
      ).statusCode,
    ).toBe(400);
    expect((await new Device(app).post('/api/v1/auth/login', { email: 'ada@example.com' })).statusCode).toBe(
      400,
    );
    expect((await new Device(app).register('y@example.com', 'p'.repeat(129))).statusCode).toBe(400);
  });

  it('refuses to register a second account from a signed-in session', async () => {
    const d = new Device(app);
    await d.login('ada@example.com');
    expect((await d.register('second@example.com')).statusCode).toBe(400);
  });

  it.each([
    ['a malformed header', 'Basic abc'],
    ['a malformed token', 'Bearer not-a-token'],
    ['an unknown token', `Bearer ${newSessionToken()}`],
  ])('answers 401 for %s, never falling back to anonymous', async (_l, header) => {
    const res = await new Device(app).get('/api/v1/my/snapshots', { authorization: header });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_REQUIRED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('expires bearer and cookie sessions', async () => {
    const tool = Device.bearer(app);
    await tool.login('ada@example.com', undefined, 'bearer');
    const browser = new Device(app);
    await browser.login('ada@example.com');
    await h.db.query(
      `UPDATE user_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second'`,
    );

    expect((await tool.get('/api/v1/my/snapshots')).statusCode).toBe(401);
    const stale = await browser.get('/api/v1/auth/me');
    expect(stale.json().user).toBeNull();
    expect(browser.jar.has('kyc_session')).toBe(false); // the stale cookie is cleared
  });

  it('revokes on sign-out: this session only, or every session with { all: true }', async () => {
    const a = Device.bearer(app);
    const b = Device.bearer(app);
    const c = new Device(app);
    await a.login('ada@example.com', undefined, 'bearer');
    await b.login('ada@example.com', undefined, 'bearer');
    await c.login('ada@example.com');

    expect((await a.post('/api/v1/auth/logout')).statusCode).toBe(204);
    expect((await a.get('/api/v1/my/snapshots')).statusCode).toBe(401);
    expect((await b.get('/api/v1/my/snapshots')).statusCode).toBe(200);

    expect((await c.post('/api/v1/auth/logout', { all: true })).statusCode).toBe(204);
    expect(c.jar.has('kyc_session')).toBe(false);
    expect((await b.get('/api/v1/my/snapshots')).statusCode).toBe(401);
    expect(await count('SELECT count(*)::int AS n FROM user_sessions WHERE revoked_at IS NULL')).toBe(0);
  });

  it('binds each token to its transport: a cookie token is useless as a bearer token and vice versa', async () => {
    const browser = new Device(app);
    await browser.login('ada@example.com');
    const cookieToken = browser.jar.get('kyc_session')!;
    expect(
      (await new Device(app).get('/api/v1/my/snapshots', { authorization: `Bearer ${cookieToken}` }))
        .statusCode,
    ).toBe(401);

    const tool = Device.bearer(app);
    await tool.login('ada@example.com', undefined, 'bearer');
    const asCookie = new Device(app);
    asCookie.jar.set('kyc_session', tool.token!);
    expect((await asCookie.get('/api/v1/auth/me')).json().user).toBeNull();
  });

  it('rate-limits sign-in attempts', async () => {
    await h.close();
    await h.reset({ llm: new FakeLlm(), env: { RATE_LIMIT_DISABLED: 'false', RATE_AUTH_PER_HOUR: '3' } });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++)
      codes.push((await new Device(app).login('ada@example.com', 'wrong password')).statusCode);
    expect(codes).toEqual([401, 401, 401, 429]);
  });
});

describe('secrets stay secret', () => {
  it('never logs or stores passwords and tokens, and returns a bearer token only once', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _e, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    await h.close();
    const logged = await buildApp({
      config: testConfig({ LOG_LEVEL: 'trace' }),
      db: h.db,
      overrides: { llm: new FakeLlm(), logStream: sink },
    });
    try {
      const d = new Device(() => logged);
      const password = 'a very secret passphrase';
      await d.register('ada@example.com', password);
      const tool = Device.bearer(() => logged);
      const res = await tool.login('ada@example.com', password, 'bearer');
      const token = res.json().token as string;
      await tool.get('/api/v1/my/snapshots');
      await new Device(() => logged).login('ada@example.com', 'wrong password!');

      const log = lines.join('');
      expect(log.length).toBeGreaterThan(0);
      expect(log).not.toContain(password);
      expect(log).not.toContain(token);
      expect(log).not.toContain('kyc_st_');

      const stored = await h.db.query(`SELECT * FROM user_sessions`);
      expect(JSON.stringify(stored.rows)).not.toContain(token);
      const users = await h.db.query(`SELECT password_hash FROM users WHERE email='ada@example.com'`);
      expect(users.rows[0].password_hash).not.toContain(password);
      expect((await tool.get('/api/v1/auth/me')).body).not.toContain('kyc_st_');
    } finally {
      await logged.close();
      await h.reset({ llm: new FakeLlm(), repos: REPOS }); // afterEach closes h.app
    }
  });
});

describe('retention and accounts', () => {
  it('removes idle anonymous users but never registered accounts', async () => {
    await new Device(app).register('ada@example.com');
    await new Device(app).get('/api/v1/my/snapshots'); // mints an anonymous user
    await h.db.query(`UPDATE users SET last_seen_at = now() - interval '60 days'`);
    await runRetention(h.db, h.app.log);
    expect((await h.db.query('SELECT kind FROM users')).rows).toEqual([{ kind: 'registered' }]);
  });
});
