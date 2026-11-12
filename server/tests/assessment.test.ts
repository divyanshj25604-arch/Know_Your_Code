import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/ai/fake';
import { Device } from './device';
import { Harness, parseSse } from './harness';

const h = new Harness();
const app = () => h.app;
const SEL = { path: 'src/controllers/authController.js', startLine: 3, startCol: 15, endLine: 3, endCol: 20 };
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset({ llm: new FakeLlm(), repos: { 'acme/notes-api': { fixture: 'express-cjs' } } }));
afterEach(() => h.close());

async function explained() {
  const d = new Device(app);
  const { snapshotId, repositoryId } = await d.importRepo('acme/notes-api');
  const ev = parseSse((await d.post('/api/v1/explanations', { snapshotId, selection: SEL })).body);
  return { d, repositoryId, explanationId: String(ev.find((e) => e.event === 'done')!.data.explanationId) };
}

describe('assessment (P3.5)', () => {
  it('keeps every attempt; the latest one counts in the results', async () => {
    const { d, repositoryId, explanationId } = await explained();
    const q = (await d.post(`/api/v1/explanations/${explanationId}/checks`, {})).json();
    expect(q).toMatchObject({ format: 'choice', options: expect.any(Array) });
    expect((await d.post(`/api/v1/checks/${q.checkId}/answer`, { answerIndex: 2 })).json().correct).toBe(
      false,
    );
    expect((await d.post(`/api/v1/checks/${q.checkId}/answer`, { answerIndex: 0 })).json().correct).toBe(
      true,
    );
    const r = (await d.get(`/api/v1/repositories/${repositoryId}/assessment`)).json();
    expect(r.summary).toEqual({ checks: 1, attempted: 1, correct: 1, averageScore: 1 });
    expect(r.checks[0].attempts.map((a: { verdict: string }) => a.verdict)).toEqual(['correct', 'incorrect']);
    expect((await h.db.query('SELECT count(*)::int AS n FROM assessment_attempts')).rows[0].n).toBe(2);
  });

  it('grades open questions against a rubric, point by point, with evidence', async () => {
    const { d, repositoryId, explanationId } = await explained();
    const q = (await d.post(`/api/v1/explanations/${explanationId}/checks`, { format: 'open' })).json();
    expect(q).toMatchObject({ format: 'open', options: [] });
    const partly = (
      await d.post(`/api/v1/checks/${q.checkId}/answer`, { text: 'It is about line 3.' })
    ).json();
    expect(partly).toMatchObject({
      verdict: 'partly',
      score: 0.5,
      points: [
        { point: 'line 3', met: true },
        { point: 'starts', met: false },
      ],
      refs: [{ path: SEL.path, line: 3 }],
      evidence: { capability: 'grade' },
    });
    const full = (
      await d.post(`/api/v1/checks/${q.checkId}/answer`, { text: 'It starts at line 3.' })
    ).json();
    expect(full).toMatchObject({ verdict: 'correct', score: 1, correct: true });
    // An option index makes no sense for an open question.
    expect((await d.post(`/api/v1/checks/${q.checkId}/answer`, { answerIndex: 0 })).statusCode).toBe(400);
    const r = (await d.get(`/api/v1/repositories/${repositoryId}/assessment`)).json();
    expect(r.checks[0]).toMatchObject({
      format: 'open',
      attempts: [{ verdict: 'correct' }, { verdict: 'partly' }],
    });
  });

  it('results are personal', async () => {
    const { repositoryId } = await explained();
    expect((await new Device(app).get(`/api/v1/repositories/${repositoryId}/assessment`)).statusCode).toBe(
      404,
    );
  });
});
