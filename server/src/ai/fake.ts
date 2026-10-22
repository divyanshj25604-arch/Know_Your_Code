import { AppError } from '../http/errors';
import type { LlmCall, LlmClient, LlmOutput } from './llm';

/**
 * Deterministic stand-in for the model, selected only by LLM_PROVIDER=fake (tests, CI, offline E2E).
 * It builds its answer from the context pack it is given, so tests exercise the real prompt assembly, schema
 * validation, reference verification and persistence. It is NOT evidence that the live provider works, and the
 * UI shows a banner whenever it is active.
 *
 * Failure injection (for tests): markers in the repository text or question select behaviours.
 */
export class FakeLlm implements LlmClient {
  readonly kind = 'fake' as const;
  readonly calls: LlmCall[] = [];

  async complete(call: LlmCall): Promise<LlmOutput> {
    this.calls.push(call);
    const started = performance.now();
    const u = call.user;
    if (u.includes('FAKE_TIMEOUT')) throw new AppError('AI_TIMEOUT');
    if (u.includes('FAKE_BUSY')) throw new AppError('AI_BUSY');
    if (u.includes('FAKE_ERROR')) throw new AppError('AI_ERROR');
    const refused = u.includes('FAKE_REFUSE');
    let json: unknown;
    if (u.includes('FAKE_MALFORMED')) json = { what: 42 };
    else if (u.includes('FAKE_NOT_JSON')) json = null;
    else if (refused) json = null;
    else json = this.build(call);
    const text = json === null ? (refused ? '' : 'not json') : JSON.stringify(json);
    return {
      json,
      text,
      inputTokens: Math.ceil((call.system.length + call.user.length) / 3.5),
      outputTokens: Math.ceil(text.length / 3.5),
      totalMs: Math.round(performance.now() - started),
      stopReason: refused ? 'refusal' : 'end_turn',
      refused,
    };
  }

  private build(call: LlmCall): unknown {
    const u = call.user;
    const input = /<task_input>\n([\s\S]*?)\n<\/task_input>/.exec(u)?.[1];
    const ti = (input ? JSON.parse(input) : {}) as Record<string, string | undefined>;
    const pack = /<repository_content[^>]*>\n([\s\S]*)\n<\/repository_content>/.exec(u)?.[1] ?? '';
    const sel = /\[SELECTED_CODE\] file: (\S+) lines (\d+)-(\d+)/.exec(pack);
    const path = sel?.[1] ?? 'unknown';
    const first = Number(sel?.[2] ?? 1);
    const codeLines = [...pack.matchAll(/^(\d+)\| (.*)$/gm)]
      .filter((m) => Number(m[1]) >= first)
      .slice(0, 12);
    const firstCode = codeLines.find((m) => m[2]!.trim())?.[2]?.trim() ?? '';
    const calls = [...(/CALLS:\n((?:- .*\n?)+)/.exec(pack)?.[1] ?? '').matchAll(/^- (\S+) at (\S+):(\d+)/gm)];
    const unresolved = [
      ...(/UNRESOLVED[^\n]*\n((?:- .*\n?)+)/.exec(pack)?.[1] ?? '').matchAll(
        /^- (.+?) at \S+ \(reason: ([^)]+)\)/gm,
      ),
    ];
    const callers = [
      ...(/CALLED_BY \/ USED_BY:\n((?:- .*\n?)+)/.exec(pack)?.[1] ?? '').matchAll(
        /^- (.+?) at (\S+):(\d+) \[(\w+)/gm,
      ),
    ];
    const concepts: { id: string; label: string }[] = [];
    const has = (re: RegExp) => re.test(pack);
    if (has(/\basync\b|\bawait\b/)) concepts.push({ id: 'async-await', label: 'async/await' });
    if (has(/\brequire\(/)) concepts.push({ id: 'commonjs-require', label: 'CommonJS require' });
    if (has(/useEffect/)) concepts.push({ id: 'useEffect', label: 'useEffect' });
    if (has(/useState/)) concepts.push({ id: 'react-state', label: 'React state' });
    if (has(/\bres\.(json|status)\b/))
      concepts.push({ id: 'http-request-response', label: 'HTTP request/response' });

    const badRef = pack.includes('KYC_FAKE_BAD_REF');
    const kindWord = /KIND=(\w+)/.exec(call.user)?.[1];
    void kindWord;

    if (call.task === 'explain') {
      return {
        what: {
          text: `This code in ${path} starting at line ${first}: ${firstCode.slice(0, 120)}`,
          refs: [
            { path, line: first },
            ...(badRef
              ? [
                  { path: 'does/not/exist.js', line: 3 },
                  { path, line: 99999 },
                ]
              : []),
          ],
        },
        why: callers[0]
          ? {
              text: `It is used by ${callers[0][1]} (${callers[0][4]}).`,
              refs: [{ path: callers[0][2]!, line: Number(callers[0][3]) }],
            }
          : { text: '', refs: [] },
        steps: codeLines
          .slice(0, 3)
          .map((m) => ({ text: `Line ${m[1]}: ${m[2]!.trim().slice(0, 80)}`, lines: [Number(m[1])] })),
        inputs: { text: '', refs: [] },
        dependsOn: { text: calls.length ? `It calls ${calls.map((c) => c[1]).join(', ')} (verified).` : '' },
        effects: { text: '', refs: [] },
        edgeCases: [],
        concepts,
        exploreNext: [{ text: 'What happens if the input is missing?' }],
        tryIt: { type: 'predict', text: 'Predict what this returns for an empty input.' },
        uncertainty: unresolved.map((m) => ({ text: `${m[1]} cannot be followed statically (${m[2]}).` })),
      };
    }
    if (call.task === 'followup') {
      const q = ti.question ?? '';
      const lex = /\[LEXICAL_HIT\] file: (\S+) lines (\d+)-/.exec(pack);
      return {
        text: `About "${q.slice(0, 80)}": ${firstCode ? `the selected code does ${firstCode.slice(0, 80)}` : 'see the selected code'}.`,
        refs: lex ? [{ path: lex[1]!, line: Number(lex[2]) }] : [{ path, line: first }],
        uncertainty: [],
      };
    }
    if (call.task === 'concept') {
      return {
        concept: ti.conceptId ?? 'concept',
        plain: `${ti.conceptLabel ?? ti.conceptId} lets code wait for or organise work in a readable way.`,
        term: ti.conceptLabel ?? ti.conceptId ?? '',
        inYourCode: codeLines
          .slice(0, 1)
          .map((m) => ({ path, line: Number(m[1]), note: m[2]!.trim().slice(0, 80) })),
        spotIt: { question: 'Which line in the selection shows it?' },
        backToCode: 'Back to your selection.',
      };
    }
    if (call.task === 'check') {
      return {
        type: 'why',
        question: `Which line starts the selected code in ${path}?`,
        options: [`Line ${first}`, `Line ${first + 100}`, `Line ${first + 200}`, `Line ${first + 300}`],
        correctIndex: 0,
        answerRefs: [{ path, line: first }],
        explanation: `The selection begins at line ${first}.`,
      };
    }
    return { summary: 'A small JavaScript project (test provider summary).', modules: [], refs: [] };
  }
}
