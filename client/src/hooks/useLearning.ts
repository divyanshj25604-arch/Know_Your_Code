import { useCallback, useEffect, useState } from 'react';
import type { PathsView, TourView } from '@kyc/contracts';
import { api } from '../api/client';
import { readPref, writePref } from '../lib/storage';
import { queries } from '../state/queryCache';

/** Learning paths with the learner's progress. Not cached: progress changes as items are completed. */
export function usePaths(snapshotId: string): {
  view: PathsView | null;
  error: boolean;
  reload: () => void;
} {
  const [view, setView] = useState<PathsView | null>(null);
  const [error, setError] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api
      .paths(snapshotId)
      .then((v) => !cancelled && setView(v))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [snapshotId, n]);
  return { view, error, reload: useCallback(() => setN((x) => x + 1), []) };
}

/** The guided tour (computed from the code graph; fixed per snapshot, so cached). */
export function useTour(snapshotId: string): TourView | null {
  const [tour, setTour] = useState<TourView | null>(null);
  useEffect(() => {
    queries
      .get(`tour:${snapshotId}`, () => api.tour(snapshotId))
      .then(setTour)
      .catch(() => setTour({ stops: [] }));
  }, [snapshotId]);
  return tour;
}

/** What the Learn guide column shows: the Learn home, a learning path, or the guided tour. */
export type LearnGuide = { kind: 'home' } | { kind: 'path'; id: string } | { kind: 'tour' };

/**
 * The open learning guide, remembered per repository in this browser so a reload resumes the same lesson. (The
 * learner's progress and code position are saved on the server; this only remembers which guide was open.)
 */
export function useLearnGuide(repositoryId: string): [LearnGuide, (g: LearnGuide) => void] {
  const key = `kyc.guide.${repositoryId}`;
  const [guide, setGuide] = useState<LearnGuide>(() => {
    try {
      const v = JSON.parse(readPref(key) ?? 'null') as LearnGuide | null;
      if (v && (v.kind === 'tour' || (v.kind === 'path' && typeof v.id === 'string'))) return v;
    } catch {
      /* ignore a malformed value */
    }
    return { kind: 'home' };
  });
  const set = useCallback(
    (g: LearnGuide) => {
      setGuide(g);
      writePref(key, JSON.stringify(g));
    },
    [key],
  );
  return [guide, set];
}
