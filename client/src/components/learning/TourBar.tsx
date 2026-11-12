import { useEffect, useState } from 'react';
import type { TourView } from '@kyc/contracts';
import { api } from '../../api/client';

/**
 * Guided tour (P3.4): a fixed sequence of stops computed from the code graph. Each step is added to the learning
 * trail, so the learner's place in the tour is saved with it and restored after a reload.
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
  const [tour, setTour] = useState<TourView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api
      .tour(snapshotId)
      .then(setTour)
      .catch(() => setError(true));
  }, [snapshotId]);
  if (error) return <p className="note">The tour couldn't be loaded.</p>;
  if (!tour) return null;
  if (tour.stops.length === 0) return <p className="note">No tour stops were found in this code.</p>;
  const at = tour.stops.findIndex((s) => s.path === currentPath && s.line === currentLine);
  const go = (i: number) => {
    const s = tour.stops[i];
    if (s) onGo(s.path, s.line, s.title);
  };
  const stop = at >= 0 ? tour.stops[at]! : null;
  return (
    <section className="note tour-bar" aria-label="Guided tour">
      {stop ? (
        <>
          <strong>
            Tour stop {at + 1} of {tour.stops.length}: {stop.title}
          </strong>{' '}
          <span className="muted">{stop.why}</span>{' '}
        </>
      ) : (
        <strong>Guided tour: {tour.stops.length} stops through this repository. </strong>
      )}
      <button type="button" className="btn btn-small" disabled={at <= 0} onClick={() => go(at - 1)}>
        Previous stop
      </button>{' '}
      <button
        type="button"
        className="btn btn-small btn-primary"
        disabled={at >= tour.stops.length - 1}
        onClick={() => go(at + 1)}
      >
        {at < 0 ? 'Start the tour' : 'Next stop'}
      </button>{' '}
      <button type="button" className="link" onClick={onClose}>
        End tour
      </button>
    </section>
  );
}
