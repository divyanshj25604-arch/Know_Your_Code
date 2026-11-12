import type { ExplState } from '../../lib/expl';
import { Inline } from '../../lib/inline';
import { LineRefChip, ProvenanceTag, TextWithRefs } from '../ui';

/**
 * The body of an explanation: its sections, what the code cannot show, and removed links. Presentational, so it is
 * used in the workspace panel and in Validate mode (P2.2).
 */
export function ExplanationSections({
  ex,
  onOpenRef,
}: {
  ex: Pick<ExplState, 'sections' | 'done' | 'selection'>;
  onOpenRef: (path: string, line: number) => void;
}) {
  const sec = (n: string) => ex.sections.find((s) => s.name === n);
  const what = sec('what'),
    why = sec('why'),
    steps = sec('steps'),
    inputs = sec('inputs'),
    depends = sec('dependsOn'),
    effects = sec('effects'),
    edge = sec('edgeCases');
  return (
    <>
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
    </>
  );
}
