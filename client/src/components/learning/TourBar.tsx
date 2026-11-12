import { useTour } from '../../hooks/useLearning';
import { ProgressMeter, Skeleton } from '../ui';

/**
 * Guided tour (P3.4) in the Learn guide column: a fixed sequence of stops computed from the code graph. Each step is
 * added to the learning trail, so the learner's place in the tour is saved with it and restored after a reload.
 */
export function TourBar({
  snapshotId,
  currentPath,
  currentLine,
  onGo,
  onClose,
}: {
  snapshotId: string;
  currentPath: string | null;
  currentLine: number | null;
  onGo: (path: string, line: number, label: string) => void;
  onClose: () => void;
}) {
  const tour = useTour(snapshotId);
  if (!tour)
    return (
      <div className="guide">
        <Skeleton lines={5} />
      </div>
    );
  const at = tour.stops.findIndex((s) => s.path === currentPath && s.line === currentLine);
  const go = (i: number) => {
    const s = tour.stops[i];
    if (s) onGo(s.path, s.line, s.title);
  };
  const stop = at >= 0 ? tour.stops[at]! : null;
  return (
    <section className="guide" aria-label="Guided tour">
      <div className="guide-head">
        <div>
          <span className="eyebrow">Guided tour</span>
          <h2>The most important code, in order</h2>
        </div>
        <button type="button" className="btn btn-small btn-quiet" onClick={onClose}>
          End tour
        </button>
      </div>
      {tour.stops.length === 0 ? (
        <p className="note">No tour stops were found in this code.</p>
      ) : (
        <>
          <ProgressMeter label="Stops visited" value={at + 1} total={tour.stops.length} />
          <div className="guide-block" aria-live="polite">
            {stop ? (
              <>
                <p>
                  <strong>
                    Tour stop {at + 1} of {tour.stops.length}: {stop.title}
                  </strong>
                </p>
                <p className="muted">{stop.why}</p>
                <p className="path">
                  {stop.path}:{stop.line}
                </p>
                <p className="small muted">
                  Select any code beside this to explain it. The tour keeps your place.
                </p>
              </>
            ) : (
              <p>
                <strong>{tour.stops.length} stops through this repository.</strong> Each one opens the code
                beside this panel and says why it matters.
              </p>
            )}
          </div>
          <ol className="path-items" aria-label="Tour stops">
            {tour.stops.map((s, i) => (
              <li key={`${s.path}:${s.line}`} aria-current={i === at ? 'step' : undefined}>
                <button type="button" onClick={() => go(i)}>
                  <span className="glyph" aria-hidden="true">
                    {i < at ? '✓' : i === at ? '◐' : '○'}
                  </span>
                  <span>{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="guide-nav">
            <button type="button" className="btn btn-small" disabled={at <= 0} onClick={() => go(at - 1)}>
              ← Previous stop
            </button>
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={at >= tour.stops.length - 1}
              onClick={() => go(at + 1)}
            >
              {at < 0 ? 'Start the tour' : 'Next stop →'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
