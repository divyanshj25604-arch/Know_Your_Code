import { describe, expect, it } from 'vitest';
import {
  MemoryGraphStore,
  analyse,
  mergeRanges,
  planContext,
  readPathAliases,
  type GraphStore,
  type PlanRequest,
  type RetrievalIntent,
} from '../src';
import { analysable, loadFixture } from './fixture-loader';

async function storeFor(files: { path: string; content: string }[]): Promise<MemoryGraphStore> {
  const code = analysable(files);
  const result = await analyse(code, {
    knownPaths: files.map((f) => f.path),
    aliases: readPathAliases(code, files),
  });
  return new MemoryGraphStore(
    files.map((f) => ({ ...f, analysable: code.includes(f) })),
    result,
  );
}

/** A chain a -> b -> c -> d -> e across five files, for multi-hop plans. */
const CHAIN = ['a', 'b', 'c', 'd', 'e'].map((n, i, all) => {
  const next = all[i + 1];
  const body = next ? `  return ${next}(x) + 1;` : '  return x;';
  return {
    path: `src/${n}.js`,
    content: [
      ...(next ? [`const { ${next} } = require('./${next}');`] : []),
      `function ${n}(x) {`,
      body,
      '}',
      `module.exports = { ${n} };`,
      '',
    ].join('\n'),
  };
});

const LOGIN = 'src/controllers/authController.js#function:login';

async function plan(store: GraphStore, over: Partial<PlanRequest> & { focusKey?: string } = {}) {
  const focus = over.focusKey ? await store.symbol(over.focusKey) : await store.symbol(LOGIN);
  return planContext(store, {
    intent: 'explain',
    selection: { path: focus!.path, startLine: focus!.startLine, endLine: focus!.startLine },
    focus,
    fileAnalysable: true,
    maxTokens: 6000,
    facts: { frameworks: ['express'], languages: { js: 6 } },
    ...over,
  });
}

/** Every (path, line) emitted as a numbered row. */
function emittedLines(text: string): string[] {
  const out: string[] = [];
  let path = '';
  for (const l of text.split('\n')) {
    const h = /^\[[A-Z_0-9]+\] file: (\S+) lines/.exec(l);
    if (h) path = h[1]!;
    else if (/^\d+\| /.test(l) && path) out.push(`${path}:${l.slice(0, l.indexOf('|'))}`);
    else if (/^\[/.test(l)) path = '';
  }
  return out;
}

describe('retrieval planner (P2.4)', () => {
  it('gives the same pack for the same selection and repository state', async () => {
    const files = loadFixture('express-cjs');
    const s1 = await storeFor(files);
    const s2 = await storeFor(files);
    for (const intent of ['explain', 'followup', 'assess', 'flow'] as RetrievalIntent[]) {
      const a = await plan(s1, { intent, question: 'Where is normalise used?' });
      const b = await plan(s1, { intent, question: 'Where is normalise used?' });
      const c = await plan(s2, { intent, question: 'Where is normalise used?' });
      expect(b.text, intent).toBe(a.text);
      expect(c.text, intent).toBe(a.text);
      expect([...b.ranges.entries()]).toEqual([...a.ranges.entries()]);
      expect([...b.edges.keys()]).toEqual([...a.edges.keys()]);
    }
  });

  it('keeps the explain recipe: selection, callee definition in its own file, relations with edge ids', async () => {
    const p = await plan(await storeFor(loadFixture('express-cjs')));
    expect(p.items[0]).toBe('SELECTED_CODE');
    expect(p.items).toEqual(expect.arrayContaining(['VERIFIED_RELATIONS', 'DEFINITION', 'PROJECT_FACTS']));
    expect(p.text).toContain('7| async function findUserByEmail(email) {');
    expect(p.text).toMatch(
      /findUserByEmail at src\/services\/userService\.js:7 \[verified; call; edge e\d+\]/,
    );
    const call = p.relations?.calls.find((c) => c.label === 'findUserByEmail');
    expect(call?.edgeId && p.edges.get(call.edgeId)).toMatchObject({
      type: 'call',
      from: 'login',
      to: 'findUserByEmail',
    });
  });

  it('never sends a line twice and keeps allowed ranges merged', async () => {
    const store = await storeFor(loadFixture('express-cjs'));
    for (const intent of ['explain', 'followup', 'assess', 'flow'] as RetrievalIntent[]) {
      const p = await plan(store, { intent, question: 'what does findUserByEmail and normalise do' });
      const rows = emittedLines(p.text);
      expect(rows.length, intent).toBeGreaterThan(0);
      expect(new Set(rows).size, intent).toBe(rows.length);
      for (const [, rs] of p.ranges) expect(mergeRanges(rs)).toEqual(rs);
    }
  });

  it('stays within every budget, for every intent', async () => {
    const store = await storeFor(loadFixture('express-cjs'));
    for (const maxTokens of [60, 150, 400, 1200, 6000])
      for (const intent of ['explain', 'followup', 'assess', 'flow'] as RetrievalIntent[]) {
        const p = await plan(store, { intent, maxTokens, question: 'normalise email' });
        expect(p.tokens, `${intent}@${maxTokens}`).toBeLessThanOrEqual(maxTokens);
      }
  });

  it('follows a three-hop flow over verified calls only, within budget', async () => {
    const store = await storeFor(CHAIN);
    const p = await plan(store, {
      intent: 'flow',
      focusKey: 'src/a.js#function:a',
      hops: 3,
      maxTokens: 2000,
    });
    expect(p.flow.map((s) => `${s.hop}:${s.from.name}->${s.to.name}`)).toEqual([
      '1:a->b',
      '2:b->c',
      '3:c->d',
    ]);
    expect(p.tokens).toBeLessThanOrEqual(2000);
    expect(p.items).toEqual(expect.arrayContaining(['FLOW_HOP_1', 'FLOW_HOP_2', 'FLOW_HOP_3', 'FLOW']));
    expect(p.text).not.toContain('src/e.js'); // hop 4 is out of the plan
    for (const s of p.flow) expect(p.edges.get(s.edgeId)).toMatchObject({ from: s.from.name, to: s.to.name });

    const tight = await plan(store, {
      intent: 'flow',
      focusKey: 'src/a.js#function:a',
      hops: 3,
      maxTokens: 250,
    });
    expect(tight.tokens).toBeLessThanOrEqual(250);
    expect(tight.truncated).toBe(true);
    expect(tight.flow).toHaveLength(3); // the plan is complete even when its snippets are cut
  });

  it('traces the documented express flow: login -> findUserByEmail -> normalise', async () => {
    const p = await plan(await storeFor(loadFixture('express-cjs')), { intent: 'flow', hops: 3 });
    expect(p.flow.map((s) => s.to.name)).toEqual(['findUserByEmail', 'normalise']);
  });

  it('adds lexical hits only for follow-ups, never for lines already shown', async () => {
    const store = await storeFor(loadFixture('express-cjs'));
    expect(
      (await plan(store, { intent: 'followup', question: 'Where is User model defined?' })).items,
    ).toContain('LEXICAL_HIT');
    expect(
      (await plan(store, { intent: 'explain', question: 'Where is User model defined?' })).items,
    ).not.toContain('LEXICAL_HIT');
  });

  it('explains a selection outside any symbol from file imports alone', async () => {
    const store = await storeFor(loadFixture('express-cjs'));
    const p = await planContext(store, {
      intent: 'explain',
      selection: { path: 'src/app.js', startLine: 1, endLine: 1 },
      focus: null,
      fileAnalysable: true,
      maxTokens: 2000,
    });
    expect(p.relations).toBeNull();
    expect(p.text).toContain('No enclosing function/class symbol was found');
    expect(p.text).toContain('FILE_IMPORTS:');
  });
});
