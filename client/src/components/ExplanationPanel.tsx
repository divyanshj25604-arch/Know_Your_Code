import { useEffect, useRef, useState } from 'react';
import type { Depth } from '@kyc/contracts';
import type { HistoryEntry, ThreadItem } from '../lib/expl';
import { Inline } from '../lib/inline';
import { CheckCard } from './CheckCard';
import { FeedbackBar } from './FeedbackBar';
import { RelationList } from './RelationList';
import {
  ConceptChip,
  DepthControl,
  ErrorState,
  LineRefChip,
  ProvenanceTag,
  Skeleton,
  TextWithRefs,
} from './ui';
import type { Workspace } from '../hooks/useWorkspace';

interface Props {
  ws: Workspace;
  depth: Depth;
  onDepth: (d: Depth) => void;
  onOpenRef: (path: string, line: number) => void;
}

function Thread({
  items,
  onOpen,
  onRetry,
}: {
  items: ThreadItem[];
  onOpen: (p: string, l: number) => void;
  onRetry: (t: Extract<ThreadItem, { kind: 'error' }>) => void;
}) {
  return (
    <div className="thread" role="log" aria-label="Conversation about this code" aria-live="polite">
      {items.map((it) => {
        if (it.kind === 'question')
          return (
            <p key={it.id} className="msg msg-user">
              <span className="sr-only">You asked: </span>
              {it.text}
            </p>
          );
        if (it.kind === 'pending')
          return (
            <p key={it.id} className="msg muted">
              {it.label}
            </p>
          );
        if (it.kind === 'error') {
          return (
            <div key={it.id} className="msg">
              <ErrorState
                code={it.error.code}
                message={it.error.message}
                {...(it.retry && it.error.retryable ? { onAction: () => onRetry(it) } : {})}
              />
            </div>
          );
        }
        if (it.kind === 'answer') {
          return (
            <div key={it.id} className="msg msg-ai">
              <ProvenanceTag kind="explained" />
              <TextWithRefs text={it.text} refs={it.refs} onOpen={onOpen} />
              {it.uncertainty.length > 0 && (
                <ul className="uncertain">
                  {it.uncertainty.map((u, i) => (
                    <li key={i}>
                      <Inline text={u.text} />
                    </li>
                  ))}
                </ul>
              )}
              <FeedbackBar targetType="message" targetId={it.messageId} />
            </div>
          );
        }
        return (
          <div key={it.id} className="msg msg-ai concept">
            <h4 className="panel-h">
              {it.term || it.concept} <ProvenanceTag kind="explained" />
            </h4>
            <p>
              <Inline text={it.plain} />
            </p>
            {it.inYourCode.length > 0 && (
              <>
                <p className="panel-sub">In your code</p>
                <ul className="plain-list">
                  {it.inYourCode.map((x, i) => (
                    <li key={i}>
                      <LineRefChip path={x.path} line={x.line} onOpen={onOpen} /> <Inline text={x.note} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {it.spotIt && (
              <p className="try">
                <strong>Spot it:</strong> <Inline text={it.spotIt.question} />
              </p>
            )}
            <p className="muted">
              <Inline text={it.backToCode} />
            </p>
            <FeedbackBar targetType="message" targetId={it.messageId} />
          </div>
        );
      })}
    </div>
  );
}

function Ask({ disabled, onAsk }: { disabled: boolean; onAsk: (t: string) => void }) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onAsk(t);
    setText('');
  };
  return (
    <form
      className="ask"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="ask-input" className="panel-sub">
        Ask a follow-up
      </label>
      <textarea
        id="ask-input"
        rows={2}
        value={text}
        maxLength={1000}
        placeholder="e.g. What happens if the user doesn't exist?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="submit" className="btn" disabled={disabled || !text.trim()}>
        Ask
      </button>
    </form>
  );
}

export function ExplanationPanel({ ws, depth, onDepth, onOpenRef }: Props) {
  const entry: HistoryEntry | null = ws.entry;
  const ex = entry?.expl ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the panel heading when a new explanation starts so keyboard users land on it.
  const exKey = ex ? `${entry?.id}:${ex.meta?.explanationId ?? 'pending'}` : null;
  useEffect(() => {
    if (ex?.status === 'done') headingRef.current?.focus({ preventScroll: true });
  }, [exKey, ex?.status]);

  if (!entry || (!ex && !entry.relationSymbolId)) {
    return (
      <aside className="panel" aria-label="Explanation">
        <p className="panel-empty">Select any code to learn what it does.</p>
        <p className="muted">
          Drag over code, double-click a name, or put the cursor on it and press <kbd>E</kbd>.
        </p>
      </aside>
    );
  }

  if (!ex) {
    const rel = entry.relations;
    return (
      <aside className="panel" aria-label="Connections">
        <h2 className="panel-title" tabIndex={-1} ref={headingRef}>
          {entry.label}
        </h2>
        {rel?.symbol?.signature && (
          <p className="sig">
            <code>{rel.symbol.signature}</code>
          </p>
        )}
        {rel ? <RelationList relations={rel} onNavigate={ws.navigate} /> : <Skeleton lines={4} />}
        {rel?.symbol && (
          <button type="button" className="btn btn-primary" onClick={() => void ws.explainSymbol(rel, depth)}>
            Explain this
          </button>
        )}
      </aside>
    );
  }

  const busy = ex.status === 'streaming' || ex.thread.some((t) => t.kind === 'pending');
  const sec = (n: string) => ex.sections.find((s) => s.name === n);
  const what = sec('what'),
    why = sec('why'),
    steps = sec('steps'),
    inputs = sec('inputs'),
    depends = sec('dependsOn'),
    effects = sec('effects'),
    edge = sec('edgeCases');
  const explId = ex.meta?.explanationId;

  const changeDepth = (d: Depth) => {
    onDepth(d);
    if (ex.status === 'done' && d !== 'default') void ws.regenerate(d);
    else if (ex.status === 'done' && d === 'default') void ws.retryExplain('default');
  };

  return (
    <aside className="panel" aria-label="Explanation" aria-busy={ex.status === 'streaming'}>
      <h2 className="panel-title" tabIndex={-1} ref={headingRef}>
        {ex.label}
      </h2>
      <p className="muted panel-kind">
        {ex.meta?.kind ?? 'selection'} ·{' '}
        <span className="mono">
          {ex.selection.path}:{ex.selection.startLine}
        </span>
      </p>
      {ex.meta?.note && (
        <p className="note" role="note">
          {ex.meta.note}
        </p>
      )}

      {ex.relations && <RelationList relations={ex.relations} onNavigate={ws.navigate} />}

      <div className="explain-body">
        <div className="sr-only" role="status" aria-live="polite">
          {ex.status === 'streaming'
            ? 'Writing explanation…'
            : ex.status === 'done'
              ? 'Explanation ready.'
              : ''}
        </div>
        {ex.status === 'streaming' && !what && (
          <div>
            <p className="muted">Writing explanation…</p>
            <Skeleton lines={4} />
          </div>
        )}
        {ex.status === 'error' && ex.error && (
          <ErrorState
            code={ex.error.code}
            message={ex.error.message}
            {...(ex.error.retryable
              ? { onAction: () => void ws.retryExplain(depth), actionLabel: 'Retry' }
              : {})}
            {...(ex.relations ? { action: 'The connections above are still verified and clickable.' } : {})}
          />
        )}
        {what && (
          <section aria-labelledby="s-what" className="sec">
            <h3 id="s-what" className="panel-h">
              What it does <ProvenanceTag kind="explained" />
            </h3>
            <TextWithRefs text={what.text ?? ''} refs={what.refs} onOpen={onOpenRef} />
          </section>
        )}
        {why && (
          <section aria-labelledby="s-why" className="sec">
            <h3 id="s-why" className="panel-h">
              Why it exists
            </h3>
            <TextWithRefs text={why.text ?? ''} refs={why.refs} onOpen={onOpenRef} />
          </section>
        )}
        {steps?.steps && (
          <details className="sec">
            <summary className="panel-h">Step by step</summary>
            <ol className="steps">
              {steps.steps.map((s, i) => (
                <li key={i}>
                  <Inline text={s.text} />{' '}
                  {s.lines.length > 0 && (
                    <LineRefChip path={ex.selection.path} line={s.lines[0]!} onOpen={onOpenRef} />
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}
        {inputs && (
          <section aria-labelledby="s-in" className="sec">
            <h3 id="s-in" className="panel-h">
              Where inputs come from
            </h3>
            <TextWithRefs text={inputs.text ?? ''} refs={inputs.refs} onOpen={onOpenRef} />
          </section>
        )}
        {depends && (
          <section aria-labelledby="s-dep" className="sec">
            <h3 id="s-dep" className="panel-h">
              What it depends on
            </h3>
            <p>
              <Inline text={depends.text ?? ''} />
            </p>
          </section>
        )}
        {effects && (
          <section aria-labelledby="s-eff" className="sec">
            <h3 id="s-eff" className="panel-h">
              Effect on the rest of the app
            </h3>
            <TextWithRefs text={effects.text ?? ''} refs={effects.refs} onOpen={onOpenRef} />
          </section>
        )}
        {edge?.items && (
          <details className="sec">
            <summary className="panel-h">Edge cases to think about</summary>
            <ul className="plain-list">
              {edge.items.map((e, i) => (
                <li key={i}>
                  <TextWithRefs text={e.text} refs={e.refs} onOpen={onOpenRef} />
                </li>
              ))}
            </ul>
          </details>
        )}
        {ex.done && ex.done.uncertainty.length > 0 && (
          <section aria-labelledby="s-unc" className="sec uncertain-box">
            <h3 id="s-unc" className="panel-h">
              What we can't tell from the code
            </h3>
            <ul className="plain-list">
              {ex.done.uncertainty.map((u, i) => (
                <li key={i}>
                  <Inline text={u.text} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {ex.done && ex.done.refsStripped > 0 && (
          <p className="muted small">
            {ex.done.refsStripped} link{ex.done.refsStripped === 1 ? '' : 's'} the AI suggested couldn't be
            matched to your code and {ex.done.refsStripped === 1 ? 'was' : 'were'} removed.
          </p>
        )}
      </div>

      {ex.status === 'done' && ex.done && (
        <>
          {ex.done.concepts.length > 0 && (
            <section aria-labelledby="s-con" className="sec">
              <h3 id="s-con" className="panel-h">
                Concepts in this code
              </h3>
              <div className="chips">
                {ex.done.concepts.map((c) => (
                  <ConceptChip
                    key={c.id}
                    label={c.label}
                    visited={ex.visitedConcepts.includes(c.id)}
                    onOpen={() => void ws.openConcept(c.id, c.label)}
                  />
                ))}
              </div>
            </section>
          )}
          {ex.done.exploreNext.length > 0 && (
            <section aria-labelledby="s-next" className="sec">
              <h3 id="s-next" className="panel-h">
                Explore next
              </h3>
              <div className="chips">
                {ex.done.exploreNext.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    className="chip"
                    disabled={busy}
                    onClick={() => void ws.ask(q.text)}
                  >
                    {q.text}
                  </button>
                ))}
              </div>
            </section>
          )}
          {ex.done.tryIt && (
            <p className="try">
              <strong>{ex.done.tryIt.type === 'predict' ? 'Predict:' : 'Try explaining:'}</strong>{' '}
              <Inline text={ex.done.tryIt.text} /> <span className="muted">(optional)</span>
            </p>
          )}
        </>
      )}

      <div className="panel-tools">
        <DepthControl value={depth} onChange={changeDepth} disabled={ex.status === 'streaming'} />
        {ex.status === 'done' && explId && (
          <FeedbackBar key={explId} targetType="explanation" targetId={explId} />
        )}
      </div>

      {ex.status === 'done' && explId && (
        <>
          {ex.thread.length > 0 && (
            <Thread
              items={ex.thread}
              onOpen={onOpenRef}
              onRetry={(t) =>
                t.retry &&
                (t.retry.intent === 'followup'
                  ? void ws.ask(t.retry.text ?? '')
                  : void ws.openConcept(t.retry.conceptId ?? '', t.retry.conceptId ?? ''))
              }
            />
          )}
          <Ask disabled={busy} onAsk={(t) => void ws.ask(t)} />
          {!ex.check && (
            <button type="button" className="btn btn-quiet" onClick={() => void ws.startCheck()}>
              Check yourself <span className="muted">(optional, 30 s)</span>
            </button>
          )}
          {ex.check?.loading && (
            <p className="muted" role="status">
              Writing a question…
            </p>
          )}
          {ex.check?.error && !ex.check.question && (
            <p className="muted" role="status">
              Couldn't make a good question for this code.{' '}
              <button type="button" className="link" onClick={ws.closeCheck}>
                Dismiss
              </button>
            </p>
          )}
          {ex.check?.question && (
            <CheckCard
              question={ex.check.question}
              result={ex.check.result}
              onAnswer={(i) => void ws.answerCheck(i)}
              onSkip={ws.closeCheck}
              onOpen={onOpenRef}
            />
          )}
        </>
      )}
    </aside>
  );
}
