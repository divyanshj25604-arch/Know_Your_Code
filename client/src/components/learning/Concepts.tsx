import { useEffect, useRef, useState } from 'react';
import type { ConceptBody, ConceptIndex } from '@kyc/contracts';
import { api } from '../../api/client';
import { EmptyState, ProvenanceTag, Skeleton } from '../ui';
import { queries } from '../../state/queryCache';

type Lesson = { loading: boolean; error: string | null; body: ConceptBody | null };

/**
 * Concepts in this codebase (P3.3): every programming concept the analyser found, with real examples from different
 * files (each opens in the code viewer), and an optional lesson that teaches the concept from those examples.
 */
export function Concepts({
  snapshotId,
  onOpen,
}: {
  snapshotId: string;
  onOpen: (path: string, line: number, label: string) => void;
}) {
  const [index, setIndex] = useState<ConceptIndex | null>(null);
  const [error, setError] = useState(false);
  const [lessons, setLessons] = useState<Record<string, Lesson>>({});
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    queries
      .get(`concepts:${snapshotId}`, () => api.concepts(snapshotId))
      .then(setIndex)
      .catch(() => setError(true));
    return () => abort.current?.abort();
  }, [snapshotId]);

  const teach = (id: string) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setLessons((l) => ({ ...l, [id]: { loading: true, error: null, body: null } }));
    api
      .teachConcept(
        snapshotId,
        id,
        (m) => {
          if (m.event === 'message')
            setLessons((l) => ({
              ...l,
              [id]: { loading: false, error: null, body: m.data as unknown as ConceptBody },
            }));
          if (m.event === 'error')
            setLessons((l) => ({
              ...l,
              [id]: {
                loading: false,
                error: String(m.data.message ?? 'This lesson could not be written.'),
                body: null,
              },
            }));
        },
        ctl.signal,
      )
      .catch(() => {
        if (!ctl.signal.aborted)
          setLessons((l) => ({
            ...l,
            [id]: { loading: false, error: 'This lesson could not be written.', body: null },
          }));
      });
  };

  return (
    <section className="section" id="concepts" aria-labelledby="concepts-h">
      <h2 id="concepts-h" className="section-h">
        Concepts in this code <ProvenanceTag kind="pattern" />
      </h2>
      <p className="section-lede">
        Programming ideas this code relies on, each with real examples from different files. Ask for a lesson
        that teaches the idea from those examples.
      </p>
      {error ? (
        <p className="muted">Concepts couldn't be loaded.</p>
      ) : !index ? (
        <Skeleton lines={3} />
      ) : index.concepts.length === 0 ? (
        <EmptyState title="No concepts recognised">
          None were found in this snapshot. If it was analysed before concept detection, import it again.
        </EmptyState>
      ) : (
        <ul className="arch-map">
          {index.concepts.map((c) => {
            const lesson = lessons[c.id];
            return (
              <li key={c.id} className="arch-node" aria-label={`Concept ${c.label}`}>
                <h3 className="node-title">{c.label}</h3>
                <span className="muted small">
                  {c.count} place{c.count === 1 ? '' : 's'} in {c.files} file{c.files === 1 ? '' : 's'}
                </span>
                <ul className="bare-list stack" aria-label={`Examples of ${c.label}`}>
                  {c.examples.map((e) => (
                    <li key={e.symbolId}>
                      <button
                        type="button"
                        className="code-cite"
                        onClick={() => onOpen(e.path, e.line, e.name)}
                      >
                        <span className="mono">{e.name}</span>
                        <span className="path">
                          {e.path}:{e.line}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {!lesson && (
                  <div className="node-actions">
                    <button type="button" className="btn btn-small" onClick={() => teach(c.id)}>
                      Teach me {c.label}
                    </button>
                  </div>
                )}
                {lesson?.loading && (
                  <p className="muted small" role="status">
                    Writing a lesson from these examples…
                  </p>
                )}
                {lesson?.error && (
                  <p className="muted small" role="status">
                    {lesson.error}
                  </p>
                )}
                {lesson?.body && (
                  <div className="concept-lesson" aria-label={`Lesson: ${c.label}`}>
                    <p>{lesson.body.plain}</p>
                    {lesson.body.inYourCode.length > 0 && (
                      <ul className="plain-list small">
                        {lesson.body.inYourCode.map((r) => (
                          <li key={`${r.path}:${r.line}`}>
                            <button
                              type="button"
                              className="chip chip-ref"
                              onClick={() => onOpen(r.path, r.line, c.label)}
                            >
                              {r.path}:{r.line}
                            </button>{' '}
                            {r.note}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="small muted">{lesson.body.backToCode}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
