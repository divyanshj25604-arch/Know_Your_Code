import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Depth, FileView, LearnerTrack, Overview, Relations, Selection, TreeNode } from '@kyc/contracts';
import { api, ApiError, type SseMessage } from '../api/client';
import {
  newExpl,
  selectionLabel,
  type DoneInfo,
  type ExplState,
  type HistoryEntry,
  type Meta,
  type Ref,
  type Section,
  type StreamError,
  type ThreadItem,
} from '../lib/expl';
import { explStateOf, loadExplanation } from '../state/explanations';
import { queries } from '../state/queryCache';
import {
  canForward,
  emptyTrail,
  restoreTrail,
  serialiseTrail,
  trailPath,
  trailReducer,
  type Trail,
} from '../state/trail';

let counter = 0;
const uid = (p: string) => `${p}-${++counter}-${Math.random().toString(36).slice(2, 7)}`;

const asStreamError = (e: unknown): StreamError =>
  e instanceof ApiError
    ? { code: e.code, message: e.message, retryable: e.retryable }
    : { code: 'SERVICE_UNAVAILABLE', message: 'Something went wrong.', retryable: true };

/** Where this workspace's trail is saved: on the server, or nowhere (e.g. someone else's shared snapshot). */
export type Persistence = 'loading' | 'saved' | 'saving' | 'unavailable' | 'error';

export interface Workspace {
  track: LearnerTrack;
  /** True once the saved position has been restored (or there was none). */
  restored: boolean;
  persistence: Persistence;
  canForward: boolean;
  /** Every stop in this track that has a saved explanation, most recent first (for Validate mode). */
  explanations: { nodeId: string; explanationId: string; label: string; path: string; line: number }[];
  loading: boolean;
  loadError: ApiError | null;
  tree: TreeNode | null;
  overview: Overview | null;
  entry: HistoryEntry | null;
  entries: HistoryEntry[];
  index: number;
  file: { status: 'idle' | 'loading' | 'ready' | 'error'; data: FileView | null; error: ApiError | null };
  selectionError: string | null;
  openFile: (path: string, line?: number) => void;
  navigate: (path: string, line: number, label: string, symbolId?: string) => void;
  explain: (sel: Selection, text: string, depth: Depth) => Promise<void>;
  explainSymbol: (relations: Relations, depth: Depth) => Promise<void>;
  regenerate: (depth: Depth) => Promise<void>;
  retryExplain: (depth: Depth) => Promise<void>;
  ask: (text: string) => Promise<void>;
  openConcept: (id: string, label: string) => Promise<void>;
  startCheck: (format?: 'choice' | 'open') => Promise<void>;
  answerCheck: (i: number) => Promise<void>;
  answerCheckText: (text: string) => Promise<void>;
  closeCheck: () => void;
  goTo: (i: number) => void;
  back: () => void;
  forward: () => void;
  clearSelectionError: () => void;
}

/**
 * One workspace track (P2.1): a branching trail of stops (file positions, each optionally with an explanation),
 * persisted to the server per repository and track so a reload, or another device, resumes at the exact same stop.
 * Snapshot data comes from the shared query cache; explanations are restored from the server by id.
 */
export function useWorkspace(
  snap: { id: string; repositoryId: string; commitSha: string | null },
  track: LearnerTrack,
  initial: { path: string | null; line: number | null } = { path: null, line: null },
): Workspace {
  const snapshotId = snap.id;
  const [trail, dispatch] = useReducer(trailReducer, undefined, emptyTrail);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [file, setFile] = useState<Workspace['file']>({ status: 'idle', data: null, error: null });
  const [restored, setRestored] = useState(false);
  const [persistence, setPersistence] = useState<Persistence>('loading');
  const stream = useRef<AbortController | null>(null);
  const activeEntry = useRef<string | null>(null);
  const trailRef = useRef(trail);
  trailRef.current = trail;
  /** The serialised trail the server holds (null until known). */
  const lastPersisted = useRef<string | null>(null);

  const path = useMemo(() => trailPath(trail), [trail]);
  const entries = useMemo(() => path.map((n) => n.entry), [path]);
  const entry = trail.currentId ? (trail.nodes[trail.currentId]?.entry ?? null) : null;
  const current = () => {
    const t = trailRef.current;
    return t.currentId ? (t.nodes[t.currentId]?.entry ?? null) : null;
  };
  const push = (e: HistoryEntry) => dispatch({ type: 'push', entry: e });

  const patchExpl = useCallback((id: string, fn: (e: ExplState) => ExplState) => {
    dispatch({ type: 'patch', id, fn: (en) => (en.expl ? { ...en, expl: fn(en.expl) } : en) });
  }, []);

  // Snapshot data, shared through the query cache by every mode and track.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      queries.get(`tree:${snapshotId}`, () => api.tree(snapshotId)),
      queries.get(`overview:${snapshotId}`, () => api.overview(snapshotId)),
    ])
      .then(([t, o]) => {
        if (cancelled) return;
        setTree(t.root);
        setOverview(o);
        setLoadError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(
          e instanceof ApiError ? e : new ApiError('SERVICE_UNAVAILABLE', 'Something went wrong.', true, 0),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
      stream.current?.abort();
    };
  }, [snapshotId]);

  // Restore the saved trail for this repository and track, then apply a deep link (?path=) on top of it. The
  // decision uses the restored value itself: the trail ref only updates on the next render.
  useEffect(() => {
    let cancelled = false;
    const applyDeepLink = (t: Trail | null) => {
      if (!initial.path) return;
      const here = t?.currentId ? t.nodes[t.currentId] : undefined;
      if (here && here.entry.path === initial.path && here.entry.line === (initial.line ?? 1)) return;
      push({
        id: uid('h'),
        path: initial.path,
        line: initial.line ?? 1,
        label: initial.path.split('/').pop() ?? initial.path,
        expl: null,
      });
    };
    queries
      .get(`positions:${snap.repositoryId}`, () => api.positions(snap.repositoryId))
      .then((saved) => {
        if (cancelled) return;
        const t = restoreTrail(saved[track]?.state ?? null);
        if (t) dispatch({ type: 'replace', trail: t });
        // The baseline is what the server returned, so a deep-link stop added below is saved.
        lastPersisted.current = JSON.stringify(serialiseTrail(t ?? emptyTrail()));
        setPersistence('saved');
        applyDeepLink(t);
        setRestored(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // 404: not this user's repository (a shared snapshot): nothing to restore or save.
        setPersistence(e instanceof ApiError && e.status === 404 ? 'unavailable' : 'error');
        applyDeepLink(null);
        setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [snap.repositoryId, track]);

  // Save the trail whenever its structure changes: debounced, flushed with keepalive if the page is hidden or
  // reloaded first, and reported honestly ("saving" until the server has it). Explanation text is not saved: it is
  // restored by id.
  const saved = useMemo(() => JSON.stringify(serialiseTrail(trail)), [trail]);
  const savable = restored && persistence !== 'unavailable' && persistence !== 'loading';
  const save = useCallback(
    (json: string, keepalive: boolean) => {
      const t = trailRef.current;
      const here = t.currentId ? t.nodes[t.currentId] : undefined;
      return api
        .savePosition(
          snap.repositoryId,
          track,
          {
            path: here?.entry.path ?? null,
            symbolKey: null,
            startLine: here?.entry.line ?? null,
            endLine: here?.entry.line ?? null,
            commitSha: snap.commitSha && /^[0-9a-f]{40}$/.test(snap.commitSha) ? snap.commitSha : null,
            state: JSON.parse(json) as Record<string, unknown>,
          },
          keepalive,
        )
        .then((v) => {
          lastPersisted.current = json;
          const all = queries.peek<Awaited<ReturnType<typeof api.positions>>>(
            `positions:${snap.repositoryId}`,
          );
          if (all) queries.set(`positions:${snap.repositoryId}`, { ...all, [track]: v });
          if (json === JSON.stringify(serialiseTrail(trailRef.current))) setPersistence('saved');
        })
        .catch((e: unknown) =>
          setPersistence(e instanceof ApiError && e.status === 404 ? 'unavailable' : 'error'),
        );
    },
    [snap.repositoryId, snap.commitSha, track],
  );
  useEffect(() => {
    if (!savable) return;
    if (lastPersisted.current === null) lastPersisted.current = saved; // the server state was unreadable
    if (saved === lastPersisted.current) return;
    setPersistence('saving');
    const timer = setTimeout(() => void save(saved, false), 400);
    const flush = () => {
      if (saved !== lastPersisted.current) void save(saved, true);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
    };
  }, [saved, savable]);

  // A restored stop shows its explanation again: fetch it by id.
  const currentNode = trail.currentId ? trail.nodes[trail.currentId] : undefined;
  useEffect(() => {
    const n = currentNode;
    if (!n || !n.explanationId || n.entry.expl) return;
    const id = n.id;
    const label = n.entry.label;
    loadExplanation(n.explanationId)
      .then((stored) =>
        dispatch({ type: 'patch', id, fn: (e) => ({ ...e, expl: explStateOf(stored, label) }) }),
      )
      .catch((e: unknown) =>
        dispatch({
          type: 'patch',
          id,
          fn: (en) => ({
            ...en,
            expl: {
              ...newExpl(
                { path: en.path, startLine: en.line, startCol: 0, endLine: en.line, endCol: 0 },
                label,
              ),
              status: 'error',
              error: asStreamError(e),
            },
          }),
        }),
      );
  }, [currentNode?.id, currentNode?.explanationId]);

  // A relation stop shows the callee's relations (also after a restore).
  useEffect(() => {
    const n = currentNode;
    const sid = n?.entry.relationSymbolId;
    if (!n || !sid || n.entry.relations) return;
    queries
      .get(`relations:${sid}`, () => api.relations(sid))
      .then((r) => dispatch({ type: 'patch', id: n.id, fn: (e) => ({ ...e, relations: r }) }))
      .catch(() =>
        // The symbol is from an earlier analysis run (or gone): keep the stop, without the relations panel.
        dispatch({
          type: 'patch',
          id: n.id,
          fn: (e) => ({ ...e, relationSymbolId: undefined, relations: null }),
        }),
      );
  }, [currentNode?.id]);

  // Load the file for the current entry.
  const filePath = entry?.path ?? null;
  useEffect(() => {
    if (!filePath) {
      setFile({ status: 'idle', data: null, error: null });
      return;
    }
    let cancelled = false;
    const key = `file:${snapshotId}:${filePath}`;
    const hit = queries.peek<FileView>(key);
    setFile(
      hit ? { status: 'ready', data: hit, error: null } : { status: 'loading', data: null, error: null },
    );
    if (hit) return;
    queries
      .get(key, () => api.file(snapshotId, filePath))
      .then((f) => {
        if (!cancelled) setFile({ status: 'ready', data: f, error: null });
      })
      .catch((e) => {
        if (!cancelled)
          setFile({
            status: 'error',
            data: null,
            error:
              e instanceof ApiError
                ? e
                : new ApiError('SERVICE_UNAVAILABLE', 'Something went wrong.', true, 0),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [snapshotId, filePath]);

  const openFile = useCallback((p: string, line = 1) => {
    push({ id: uid('h'), path: p, line, label: p.split('/').pop() ?? p, expl: null });
  }, []);

  const navigate = useCallback((p: string, line: number, label: string, symbolId?: string) => {
    const id = uid('h');
    push({
      id,
      path: p,
      line,
      label,
      ...(symbolId ? { relationSymbolId: symbolId } : {}),
      relations: null,
      expl: null,
    });
    void api.event('relation_clicked'); // relations load in the current-stop effect above
  }, []);

  const handleEvent = useCallback(
    (id: string, m: SseMessage) => {
      const d = m.data;
      if (m.event === 'relations') patchExpl(id, (e) => ({ ...e, relations: d as unknown as Relations }));
      else if (m.event === 'meta') {
        patchExpl(id, (e) => ({ ...e, meta: d as unknown as Meta }));
        dispatch({ type: 'link', id, explanationId: String(d.explanationId) });
      } else if (m.event === 'section')
        patchExpl(id, (e) => ({ ...e, sections: [...e.sections, d as unknown as Section] }));
      else if (m.event === 'done') {
        patchExpl(id, (e) => ({ ...e, status: 'done', done: d as unknown as DoneInfo }));
        void api.event('explanation_complete');
      } else if (m.event === 'error')
        patchExpl(id, (e) => ({ ...e, status: 'error', error: d as unknown as StreamError }));
    },
    [patchExpl],
  );

  const runStream = useCallback(
    async (id: string, start: (signal: AbortSignal) => Promise<void>) => {
      // One explanation stream at a time (DP3). The superseded one is marked stopped, not left "writing" forever.
      if (stream.current && activeEntry.current && activeEntry.current !== id) {
        stream.current.abort();
        patchExpl(activeEntry.current, (e) =>
          e.status === 'streaming'
            ? {
                ...e,
                status: 'error',
                error: {
                  code: 'AI_ERROR',
                  message: 'Stopped because you started another request.',
                  retryable: true,
                },
              }
            : e,
        );
      }
      const ctl = new AbortController();
      stream.current = ctl;
      activeEntry.current = id;
      try {
        await start(ctl.signal);
        // A stream that ended without `done` or `error` was cut off.
        patchExpl(id, (e) =>
          e.status === 'streaming'
            ? {
                ...e,
                status: 'error',
                error: {
                  code: 'SERVICE_UNAVAILABLE',
                  message: 'The connection was interrupted.',
                  retryable: true,
                },
              }
            : e,
        );
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        patchExpl(id, (x) => ({ ...x, status: 'error', error: asStreamError(e) }));
      }
    },
    [patchExpl],
  );

  const startExplain = useCallback(
    async (sel: Selection, label: string, depth: Depth) => {
      const cur = current();
      // Reuse the current stop when it has no explanation yet; otherwise add a new stop to the trail.
      const reuse = cur && !cur.expl && !cur.relationSymbolId && cur.path === sel.path;
      const id = reuse ? cur.id : uid('h');
      const expl = newExpl(sel, label);
      if (reuse) dispatch({ type: 'patch', id, fn: (e) => ({ ...e, label, line: sel.startLine, expl }) });
      else push({ id, path: sel.path, line: sel.startLine, label, expl });
      void api.event('explanation_requested', { depth });
      await runStream(id, (signal) =>
        api.explain({ snapshotId, selection: sel, depth }, (m) => handleEvent(id, m), signal),
      );
    },
    [snapshotId, runStream, handleEvent],
  );

  const explain = useCallback(
    async (sel: Selection, text: string, depth: Depth) => {
      setSelectionError(null);
      try {
        const r = await api.resolve(snapshotId, sel);
        await startExplain(sel, selectionLabel(sel, r.symbol?.name, text.replace(/\s+/g, ' ').trim()), depth);
      } catch (e) {
        if (e instanceof ApiError)
          setSelectionError(e.code === 'INVALID_SELECTION' ? 'Select some code to explain.' : e.message);
        else setSelectionError('Something went wrong.');
      }
    },
    [snapshotId, startExplain],
  );

  const explainSymbol = useCallback(
    async (rel: Relations, depth: Depth) => {
      const s = rel.symbol;
      if (!s) return;
      const sel: Selection = {
        path: s.path,
        startLine: s.startLine,
        startCol: s.startCol,
        endLine: s.endLine,
        endCol: s.endCol,
      };
      const cur = current();
      // Explain *this* stop: attach the explanation to the relation entry instead of adding another one.
      if (cur && cur.relationSymbolId === s.id && !cur.expl) {
        const expl = newExpl(sel, s.name);
        dispatch({ type: 'patch', id: cur.id, fn: (e) => ({ ...e, expl }) });
        void api.event('explanation_requested', { depth });
        await runStream(cur.id, (signal) =>
          api.explain({ snapshotId, selection: sel, depth }, (m) => handleEvent(cur.id, m), signal),
        );
      } else await startExplain(sel, s.name, depth);
    },
    [snapshotId, runStream, handleEvent, startExplain],
  );

  const regenerate = useCallback(
    async (depth: Depth) => {
      const cur = current();
      const ex = cur?.expl;
      if (!cur || !ex?.meta) return;
      const fresh = newExpl(ex.selection, ex.label);
      dispatch({ type: 'patch', id: cur.id, fn: (e) => ({ ...e, expl: fresh }) });
      await runStream(cur.id, (signal) =>
        api.message(
          ex.meta!.explanationId,
          { intent: depth === 'deeper' ? 'deeper' : 'simpler' },
          (m) => handleEvent(cur.id, m),
          signal,
        ),
      );
    },
    [runStream, handleEvent],
  );

  const retryExplain = useCallback(
    async (depth: Depth) => {
      const cur = current();
      const ex = cur?.expl;
      if (!cur || !ex) return;
      const fresh = newExpl(ex.selection, ex.label);
      dispatch({ type: 'patch', id: cur.id, fn: (e) => ({ ...e, expl: fresh }) });
      await runStream(cur.id, (signal) =>
        api.explain({ snapshotId, selection: ex.selection, depth }, (m) => handleEvent(cur.id, m), signal),
      );
    },
    [snapshotId, runStream, handleEvent],
  );

  const addThread = useCallback(
    (id: string, fn: (t: ThreadItem[]) => ThreadItem[]) =>
      patchExpl(id, (e) => ({ ...e, thread: fn(e.thread) })),
    [patchExpl],
  );

  const sendMessage = useCallback(
    async (req: { intent: 'followup' | 'concept'; text?: string; conceptId?: string }, label: string) => {
      const cur = current();
      const ex = cur?.expl;
      if (!cur || !ex?.meta) return;
      const pendingId = uid('p');
      const questionId = uid('q');
      addThread(cur.id, (t) => [
        ...t,
        ...(req.intent === 'followup'
          ? [{ id: questionId, kind: 'question' as const, text: req.text ?? '' }]
          : []),
        { id: pendingId, kind: 'pending', label },
      ]);
      const ctl = new AbortController();
      const replacePending = (item: ThreadItem) =>
        addThread(cur.id, (t) => t.map((x) => (x.id === pendingId ? item : x)));
      try {
        await api.message(
          ex.meta.explanationId,
          req,
          (m) => {
            const d = m.data;
            if (m.event === 'message') {
              if (req.intent === 'followup') {
                replacePending({
                  id: pendingId,
                  kind: 'answer',
                  messageId: String(d.messageId),
                  text: String(d.text ?? ''),
                  refs: (d.refs as Ref[]) ?? [],
                  uncertainty: (d.uncertainty as { text: string }[]) ?? [],
                });
              } else {
                replacePending({
                  id: pendingId,
                  kind: 'concept',
                  messageId: String(d.messageId),
                  concept: String(d.concept),
                  plain: String(d.plain ?? ''),
                  term: String(d.term ?? ''),
                  inYourCode: (d.inYourCode as { path: string; line: number; note: string }[]) ?? [],
                  spotIt: d.spotIt as { question: string } | undefined,
                  backToCode: String(d.backToCode ?? ''),
                });
              }
            } else if (m.event === 'error') {
              replacePending({
                id: pendingId,
                kind: 'error',
                error: d as unknown as StreamError,
                retry: req,
              });
            }
          },
          ctl.signal,
        );
        // A stream that ended while the placeholder was still pending was cut off. (Replaced items share the id,
        // so check the kind: a delivered answer must never be overwritten.)
        addThread(cur.id, (t) =>
          t.map((x) =>
            x.id === pendingId && x.kind === 'pending'
              ? {
                  id: pendingId,
                  kind: 'error',
                  error: {
                    code: 'SERVICE_UNAVAILABLE',
                    message: 'The connection was interrupted.',
                    retryable: true,
                  },
                  retry: req,
                }
              : x,
          ),
        );
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        replacePending({ id: pendingId, kind: 'error', error: asStreamError(e), retry: req });
      }
    },
    [addThread],
  );

  const ask = useCallback(
    async (text: string) => {
      void api.event('followup_asked');
      await sendMessage({ intent: 'followup', text }, 'Thinking…');
    },
    [sendMessage],
  );

  const openConcept = useCallback(
    async (id: string, label: string) => {
      const cur = current();
      if (cur?.expl)
        patchExpl(cur.id, (e) => ({ ...e, visitedConcepts: [...new Set([...e.visitedConcepts, id])] }));
      void api.event('concept_opened');
      await sendMessage({ intent: 'concept', conceptId: id }, `Teaching ${label}…`);
    },
    [sendMessage, patchExpl],
  );

  const startCheck = useCallback(
    async (format: 'choice' | 'open' = 'choice') => {
      const cur = current();
      const ex = cur?.expl;
      if (!cur || !ex?.meta) return;
      patchExpl(cur.id, (e) => ({
        ...e,
        check: { question: null, result: null, loading: true, error: null },
      }));
      void api.event('check_started');
      try {
        const q = await api.createCheck(ex.meta.explanationId, format);
        patchExpl(cur.id, (e) => ({
          ...e,
          check: { question: q, result: null, loading: false, error: null },
        }));
      } catch (e) {
        // Generation failed: hide the feature for this explanation rather than show a broken card (docs/05 §14).
        patchExpl(cur.id, (x) => ({
          ...x,
          check: {
            question: null,
            result: null,
            loading: false,
            error: e instanceof ApiError ? e.message : 'Could not create a question.',
          },
        }));
      }
    },
    [patchExpl],
  );

  const answerCheck = useCallback(
    async (i: number) => {
      const cur = current();
      const q = cur?.expl?.check?.question;
      if (!cur || !q) return;
      try {
        const result = await api.answerCheck(q.checkId, i);
        patchExpl(cur.id, (e) => ({ ...e, check: e.check ? { ...e.check, result } : e.check }));
      } catch (e) {
        patchExpl(cur.id, (x) => ({
          ...x,
          check: x.check
            ? { ...x.check, error: e instanceof ApiError ? e.message : 'Could not grade that.' }
            : x.check,
        }));
      }
    },
    [patchExpl],
  );

  const answerCheckText = useCallback(
    async (text: string) => {
      const cur = current();
      const q = cur?.expl?.check?.question;
      if (!cur || !q) return;
      try {
        const result = await api.answerCheckText(q.checkId, text);
        patchExpl(cur.id, (e) => ({ ...e, check: e.check ? { ...e.check, result } : e.check }));
      } catch (e) {
        patchExpl(cur.id, (x) => ({
          ...x,
          check: x.check
            ? { ...x.check, error: e instanceof ApiError ? e.message : 'Could not grade that.' }
            : x.check,
        }));
      }
    },
    [patchExpl],
  );

  const closeCheck = useCallback(() => {
    const cur = current();
    if (cur?.expl) patchExpl(cur.id, (e) => ({ ...e, check: null }));
  }, [patchExpl]);

  // Navigating away does not cancel a running stream: it keeps filling its own stop, which Back restores.
  // `i` indexes the breadcrumb (root .. current); -1 is the project overview.
  const goTo = useCallback(
    (i: number) => dispatch({ type: 'go', id: i < 0 ? null : (trailPath(trailRef.current)[i]?.id ?? null) }),
    [],
  );

  return {
    track,
    restored,
    persistence,
    canForward: canForward(trail),
    explanations: Object.values(trail.nodes)
      .filter((n) => n.explanationId)
      .reverse()
      .map((n) => ({
        nodeId: n.id,
        explanationId: n.explanationId!,
        label: n.entry.label,
        path: n.entry.path,
        line: n.entry.line,
      })),
    loading,
    loadError,
    tree,
    overview,
    entry,
    entries,
    index: entries.length - 1,
    file,
    selectionError,
    openFile,
    navigate,
    explain,
    explainSymbol,
    regenerate,
    retryExplain,
    ask,
    openConcept,
    startCheck,
    answerCheck,
    answerCheckText,
    closeCheck,
    goTo,
    back: () => dispatch({ type: 'back' }),
    forward: () => dispatch({ type: 'forward' }),
    clearSelectionError: () => setSelectionError(null),
  };
}
