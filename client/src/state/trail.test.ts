import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../lib/expl';
import {
  canForward,
  emptyTrail,
  restoreTrail,
  serialiseTrail,
  trailPath,
  trailReducer,
  type Trail,
  type TrailAction,
} from './trail';

const e = (id: string, path = `src/${id}.js`): HistoryEntry => ({ id, path, line: 1, label: id, expl: null });
const run = (...actions: TrailAction[]): Trail => actions.reduce(trailReducer, emptyTrail());
const labels = (t: Trail) => trailPath(t).map((n) => n.id);

describe('branching trail (P2.1)', () => {
  it('goes back and forward along one path', () => {
    let t = run(
      { type: 'push', entry: e('a') },
      { type: 'push', entry: e('b') },
      { type: 'push', entry: e('c') },
    );
    expect(labels(t)).toEqual(['a', 'b', 'c']);
    t = trailReducer(trailReducer(t, { type: 'back' }), { type: 'back' });
    expect(labels(t)).toEqual(['a']);
    t = trailReducer(t, { type: 'forward' });
    expect(labels(t)).toEqual(['a', 'b']);
  });

  it('never loses the forward trail: a new stop after Back becomes a sibling branch', () => {
    let t = run(
      { type: 'push', entry: e('a') },
      { type: 'push', entry: e('b') },
      { type: 'push', entry: e('c') },
    );
    t = trailReducer(trailReducer(t, { type: 'back' }), { type: 'back' }); // at a
    t = trailReducer(t, { type: 'push', entry: e('x') }); // branch a -> x
    expect(labels(t)).toEqual(['a', 'x']);
    expect(Object.keys(t.nodes).sort()).toEqual(['a', 'b', 'c', 'x']); // b and c are still there
    expect(t.nodes.a!.children).toEqual(['b', 'x']);
    // Back to a, then Forward follows the most recent branch; the old branch is still reachable.
    t = trailReducer(t, { type: 'back' });
    expect(labels(trailReducer(t, { type: 'forward' }))).toEqual(['a', 'x']);
    expect(labels(trailReducer(t, { type: 'go', id: 'c' }))).toEqual(['a', 'b', 'c']);
  });

  it('treats the overview as the place before the first stop', () => {
    let t = run({ type: 'push', entry: e('a') }, { type: 'back' });
    expect(t.currentId).toBeNull();
    expect(canForward(t)).toBe(true);
    t = trailReducer(t, { type: 'forward' });
    expect(t.currentId).toBe('a');
    expect(canForward(t)).toBe(false);
  });

  it('round-trips through the saved form exactly, including branches and the current stop', () => {
    let t = run(
      { type: 'push', entry: e('a') },
      { type: 'push', entry: e('b') },
      { type: 'back' },
      { type: 'push', entry: e('x') },
      { type: 'link', id: 'x', explanationId: '11111111-1111-1111-1111-111111111111' },
      { type: 'back' },
    );
    const back = restoreTrail(JSON.parse(JSON.stringify(serialiseTrail(t))));
    expect(back).not.toBeNull();
    expect(back!.currentId).toBe('a');
    expect(back!.nodes.a!.children.sort()).toEqual(['b', 'x']);
    expect(back!.nodes.x!.explanationId).toBe('11111111-1111-1111-1111-111111111111');
    expect(labels(trailReducer(back!, { type: 'forward' }))).toEqual(['a', 'x']);
    t = back!;
    expect(serialiseTrail(t)).toEqual(serialiseTrail(back!));
  });

  it('rejects saved state it cannot trust instead of half-restoring it', () => {
    for (const bad of [null, {}, { v: 2, nodes: [] }, { v: 1, nodes: [{ id: 1 }] }, 'x'])
      expect(restoreTrail(bad)).toBeNull();
    const dangling = restoreTrail({
      v: 1,
      nodes: [
        {
          id: 'a',
          parentId: 'gone',
          lastChildId: 'nope',
          path: 'p',
          line: 1,
          label: 'a',
          explanationId: null,
        },
      ],
      roots: [],
      lastRootId: 'zz',
      currentId: 'zz',
    });
    expect(dangling).toMatchObject({ currentId: null, lastRootId: null });
    expect(dangling!.nodes.a).toMatchObject({ parentId: null, lastChildId: null });
  });
});
