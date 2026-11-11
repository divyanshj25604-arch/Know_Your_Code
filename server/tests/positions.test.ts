import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { Device } from './device';
import { Harness } from './harness';

const h = new Harness();
const app = () => h.app;
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

const STATE = { v: 1, nodes: [{ id: 'n1', parentId: null, path: 'src/app.js', line: 3 }], current: 'n1' };
const position = (over: object = {}) => ({
  path: 'src/app.js',
  symbolKey: null,
  startLine: 3,
  endLine: 3,
  state: STATE,
  ...over,
});

describe('learner positions (P2.1)', () => {
  it('saves and restores each track independently, and across devices', async () => {
    const laptop = new Device(app);
    const { repositoryId } = await laptop.importRepo('acme/notes-api');
    await laptop.register('ada@example.com');
    const url = `/api/v1/repositories/${repositoryId}/positions`;
    expect((await laptop.get(url)).json()).toEqual({ learning: null, exploration: null });

    expect((await laptop.request('PUT', `${url}/learning`, position())).statusCode).toBe(200);
    expect(
      (await laptop.request('PUT', `${url}/exploration`, position({ path: 'src/routes/auth.js' })))
        .statusCode,
    ).toBe(200);
    // Exploring again must never move the learning position.
    await laptop.request(
      'PUT',
      `${url}/exploration`,
      position({ path: 'src/models/user.js', startLine: 1, endLine: 1 }),
    );

    const phone = Device.bearer(app);
    await phone.login('ada@example.com', undefined, 'bearer');
    const both = (await phone.get(url)).json();
    expect(both.learning).toMatchObject({ path: 'src/app.js', startLine: 3, state: STATE });
    expect(both.exploration).toMatchObject({ path: 'src/models/user.js' });
  });

  it('is personal: another user gets 404 for reads and writes', async () => {
    const owner = new Device(app);
    const { repositoryId } = await owner.importRepo('acme/notes-api');
    const url = `/api/v1/repositories/${repositoryId}/positions`;
    await owner.request('PUT', `${url}/learning`, position());
    const stranger = new Device(app);
    expect((await stranger.get(url)).statusCode).toBe(404);
    expect((await stranger.request('PUT', `${url}/learning`, position())).statusCode).toBe(404);
    expect((await owner.get(url)).json().learning.path).toBe('src/app.js');
  });

  it('validates the track and the position', async () => {
    const d = new Device(app);
    const { repositoryId } = await d.importRepo('acme/notes-api');
    const url = `/api/v1/repositories/${repositoryId}/positions`;
    for (const [track, body] of [
      ['elsewhere', position()],
      ['learning', position({ startLine: 5, endLine: 2 })],
      ['learning', position({ startLine: 5, endLine: null })],
      ['learning', position({ commitSha: 'main' })],
      ['learning', position({ state: { blob: 'x'.repeat(50_000) } })],
    ] as const)
      expect(
        (await d.request('PUT', `${url}/${track}`, body)).statusCode,
        JSON.stringify(body).slice(0, 60),
      ).toBe(400);
  });
});
