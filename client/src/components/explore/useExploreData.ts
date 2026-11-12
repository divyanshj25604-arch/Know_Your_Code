import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnnotationCreate, AnnotationView } from '@kyc/contracts';
import { api, ApiError } from '../../api/client';
import { queries } from '../../state/queryCache';

/** Load one cached query; `key` null means "nothing to load". Errors are kept (not cached), so a retry refetches. */
export function useQuery<T>(key: string | null, fetch: () => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: ApiError | null }>(() => ({
    key,
    data: key ? (queries.peek<T>(key) ?? null) : null,
    error: null,
  }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) {
      setState({ key, data: null, error: null });
      return;
    }
    let live = true;
    const cached = queries.peek<T>(key);
    setState({ key, data: cached ?? null, error: null });
    if (cached !== undefined) return;
    queries
      .get(key, fetch)
      .then((data) => live && setState({ key, data, error: null }))
      .catch(
        (e: unknown) =>
          live &&
          setState({
            key,
            data: null,
            error:
              e instanceof ApiError
                ? e
                : new ApiError('SERVICE_UNAVAILABLE', 'Something went wrong.', true, 0),
          }),
      );
    return () => {
      live = false;
    };
  }, [key, attempt]);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !!key && current && !state.data && !state.error,
    retry: () => setAttempt((a) => a + 1),
  };
}

export const useArchitecture = (snapshotId: string) =>
  useQuery(`architecture:${snapshotId}`, () => api.architecture(snapshotId));
export const useFileGraph = (snapshotId: string) =>
  useQuery(`file-graph:${snapshotId}`, () => api.fileGraph(snapshotId));
export const useFlows = (snapshotId: string) => useQuery(`flows:${snapshotId}`, () => api.flows(snapshotId));
export const useOutline = (snapshotId: string, path: string | null) =>
  useQuery(path ? `outline:${snapshotId}:${path}` : null, () => api.fileOutline(snapshotId, path!));
export const useRelations = (symbolId: string | null) =>
  useQuery(symbolId ? `relations:${symbolId}` : null, () => api.relations(symbolId!));
export const useFlow = (flowId: string | null) =>
  useQuery(flowId ? `flow:${flowId}` : null, () => api.flow(flowId!));

/**
 * The learner's notes on graph entities in one repository (persisted on the server, owner only). `readOnly` when the
 * workspace is opened through a share link: notes are private to the owner.
 */
export function useAnnotations(repositoryId: string, readOnly: boolean) {
  const [list, setList] = useState<AnnotationView[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unavailable'>(
    readOnly ? 'unavailable' : 'loading',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (readOnly) return;
    let live = true;
    api
      .annotations(repositoryId)
      .then((r) => {
        if (!live) return;
        setList(r.annotations);
        setStatus('ready');
      })
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
  }, [repositoryId, readOnly]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The note couldn't be saved. Try again.");
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    (a: AnnotationCreate) =>
      run(async () => {
        const saved = await api.createAnnotation(repositoryId, a);
        setList((l) => [saved, ...l]);
      }),
    [repositoryId, run],
  );
  const update = useCallback(
    (id: string, body: string) =>
      run(async () => {
        const saved = await api.updateAnnotation(id, body);
        setList((l) => [saved, ...l.filter((x) => x.id !== id)]);
      }),
    [run],
  );
  const remove = useCallback(
    (id: string) =>
      run(async () => {
        await api.deleteAnnotation(id);
        setList((l) => l.filter((x) => x.id !== id));
      }),
    [run],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of list) m.set(a.targetKey, (m.get(a.targetKey) ?? 0) + 1);
    return m;
  }, [list]);
  const count = useCallback((key: string) => counts.get(key) ?? 0, [counts]);
  return { list, status, busy, error, create, update, remove, count };
}
export type Annotations = ReturnType<typeof useAnnotations>;
