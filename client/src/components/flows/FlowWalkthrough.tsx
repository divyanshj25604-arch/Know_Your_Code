import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowDetail, FlowExplanationBody, FlowStepView } from '@kyc/contracts';
import { api } from '../../api/client';
import { ProvenanceTag } from '../ui';

const KIND: Record<FlowStepView['kind'], string> = {
  client: 'Client call',
  route: 'Route',
  middleware: 'Middleware',
  handler: 'Handler',
  call: 'Calls',
  response: 'Response',
  unknown: 'Not followed',
};
const PLAY_MS = 2500;

type Narration = { loading: boolean; error: string | null; body: FlowExplanationBody | null };

/**
 * Flow explorer and walkthrough (P3.2, P3.6): the steps of one request flow in order, with Previous, Next and Play.
 * The current step's code is opened and highlighted in the viewer. This is a static walkthrough of the analysed
 * code: nothing is executed. Narration is optional (one AI call) and attaches to a step only through the call edge
 * that step stands for; unknown steps keep their reason and are never narrated as facts.
 */
export function FlowWalkthrough({
  flowId,
  canNarrate,
  onGo,
  onClose,
}: {
  flowId: string;
  /** Narration is an AI explanation, available to the owner only. */
  canNarrate: boolean;
  onGo: (path: string, line: number, label: string) => void;
  onClose: () => void;
}) {
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [error, setError] = useState(false);
  const [at, setAt] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [narration, setNarration] = useState<Narration | null>(null);
  const abort = useRef<AbortController | null>(null);
  const onGoRef = useRef(onGo);
  onGoRef.current = onGo;

  useEffect(() => {
    setFlow(null);
    setAt(-1);
    setPlaying(false);
    setNarration(null);
    api
      .flow(flowId)
      .then(setFlow)
      .catch(() => setError(true));
    return () => abort.current?.abort();
  }, [flowId]);

  const go = useCallback(
    (i: number) => {
      const s = flow?.steps[i];
      if (!s) return;
      setAt(i);
      if (s.path && s.line) onGoRef.current(s.path, s.line, `${KIND[s.kind]}: ${s.label}`);
    },
    [flow],
  );

  useEffect(() => {
    if (!playing || !flow) return;
    if (at >= flow.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => go(at + 1), at < 0 ? 0 : PLAY_MS);
    return () => clearTimeout(t);
  }, [playing, at, flow, go]);

  const narrate = () => {
    const h = flow?.steps.find((s) => s.kind === 'handler' && s.symbolId);
    if (!flow || !h?.symbolId) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setNarration({ loading: true, error: null, body: null });
    const body: FlowExplanationBody = { summary: { text: '', refs: [] }, steps: [], uncertainty: [] };
    api
      .explainFlow(
        { snapshotId: flow.snapshotId, symbolId: h.symbolId, hops: 3 },
        (m) => {
          if (m.event === 'section' && m.data.name === 'summary')
            body.summary = { text: String(m.data.text ?? ''), refs: [] };
          if (m.event === 'section' && m.data.name === 'flowSteps')
            body.steps = (m.data.steps as FlowExplanationBody['steps']) ?? [];
          if (m.event === 'done') setNarration({ loading: false, error: null, body: { ...body } });
          if (m.event === 'error')
            setNarration({
              loading: false,
              error: String(m.data.message ?? 'The narration could not be written.'),
              body: null,
            });
        },
        ctl.signal,
      )
      .catch(() => {
        if (!ctl.signal.aborted)
          setNarration({ loading: false, error: 'The narration could not be written.', body: null });
      });
  };

  if (error) return <p className="note">This flow couldn't be loaded.</p>;
  if (!flow) return null;
  const step = at >= 0 ? flow.steps[at] : null;
  // Narration attaches to a step only by the verified call edge it stands for; the handler gets the summary.
  const said = (s: FlowStepView): string | null => {
    const b = narration?.body;
    if (!b) return null;
    if (s.kind === 'handler') return b.summary.text || null;
    if (s.provenance !== 'verified' || !s.edgeId) return null;
    return b.steps.find((n) => n.edgeId === s.edgeId && n.provenance === 'verified')?.text ?? null;
  };

  return (
    <section className="note tour-bar flow-walk" aria-label="Flow walkthrough">
      <p>
        <strong>{flow.name}</strong>{' '}
        <span className="muted small">
          A static walkthrough of the analysed code: nothing is run.{' '}
          {flow.unknownCount > 0 &&
            `${flow.unknownCount} step${flow.unknownCount === 1 ? ' is' : 's are'} not followed and say why.`}
        </span>
      </p>
      <p role="status" aria-live="polite">
        {step ? (
          <>
            <strong>
              Step {at + 1} of {flow.steps.length}: {KIND[step.kind]} — {step.label}
            </strong>
            {step.reason && <span className="muted"> ({step.reason})</span>}
          </>
        ) : (
          <>{flow.steps.length} steps.</>
        )}
      </p>
      {step && said(step) && (
        <p className="small" aria-label="Narration">
          {said(step)}
        </p>
      )}
      <p className="row">
        <button type="button" className="btn btn-small" disabled={at <= 0} onClick={() => go(at - 1)}>
          Previous step
        </button>
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={at >= flow.steps.length - 1}
          onClick={() => go(at + 1)}
        >
          {at < 0 ? 'Start' : 'Next step'}
        </button>
        <button
          type="button"
          className="btn btn-small"
          aria-pressed={playing}
          disabled={!playing && at >= flow.steps.length - 1}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        {canNarrate && !narration && (
          <button type="button" className="btn btn-small btn-quiet" onClick={narrate}>
            Narrate this flow
          </button>
        )}
        {narration?.loading && (
          <span className="muted small" role="status">
            Writing the narration…
          </span>
        )}
        {narration?.error && <span className="muted small">{narration.error}</span>}
        <button type="button" className="link" onClick={onClose}>
          Close flow
        </button>
      </p>
      <ol className="flow-steps" aria-label="Flow steps">
        {flow.steps.map((s, i) => (
          <li
            key={s.index}
            className={`flow-step flow-${s.kind}${i === at ? ' current' : ''}`}
            aria-current={i === at ? 'step' : undefined}
            style={{ paddingLeft: `${s.depth * 1}rem` }}
          >
            <button type="button" className="link small" onClick={() => go(i)}>
              <span className="tag">{KIND[s.kind]}</span> <span className="mono">{s.label}</span>
            </button>{' '}
            {s.provenance === 'verified' ? (
              <ProvenanceTag kind="verified" />
            ) : s.provenance === 'pattern' ? (
              <ProvenanceTag kind="pattern" />
            ) : (
              <span className="tag tag-warn">Unknown</span>
            )}
            {s.path && (
              <span className="muted small mono">
                {' '}
                {s.path}
                {s.line ? `:${s.line}` : ''}
              </span>
            )}
            {s.kind === 'unknown' && s.reason && <span className="muted small"> — {s.reason}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
