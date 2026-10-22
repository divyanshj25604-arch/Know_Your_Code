import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Depth, FileView, Overview, Relations, Selection, TreeNode } from '@kyc/contracts';
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

interface HistState {
  entries: HistoryEntry[];
  index: number;
}

type HistAction =
  | { type: 'push'; entry: HistoryEntry }
  | { type: 'go'; index: number }
  | { type: 'patch'; id: string; fn: (e: HistoryEntry) => HistoryEntry };

function reducer(s: HistState, a: HistAction): HistState {
  switch (a.type) {
    case 'push': {
      // Pushing after going back drops the forward trail, like a browser.
      const entries = [...s.entries.slice(0, s.index + 1), a.entry];
      return { entries, index: entries.length - 1 };
    }
    case 'go':
      // -1 means "the project overview" (no file open).
      return { ...s, index: Math.max(-1, Math.min(s.entries.length - 1, a.index)) };
    case 'patch':
      return { ...s, entries: s.entries.map((e) => (e.id === a.id ? a.fn(e) : e)) };
  }
}

let counter = 0;
const uid = (p: string) => `${p}-${++counter}-${Math.random().toString(36).slice(2, 7)}`;

const asStreamError = (e: unknown): StreamError =>
  e instanceof ApiError
    ? { code: e.code, message: e.message, retryable: e.retryable }
    : { code: 'SERVICE_UNAVAILABLE', message: 'Something went wrong.', retryable: true };

export interface Workspace {
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
  startCheck: () => Promise<void>;
  answerCheck: (i: number) => Promise<void>;
  closeCheck: () => void;
  goTo: (i: number) => void;
  back: () => void;
  forward: () => void;
  clearSelectionError: () => void;
}

export function useWorkspace(
  snapshotId: string,
  initial: { path: string | null; line: number | null },
): Workspace {
  const [hist, dispatch] = useReducer(reducer, { entries: [], index: -1 });
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [file, setFile] = useState<Workspace['file']>({ status: 'idle', data: null, error: null });
  const cache = useRef(new Map<string, FileView>());
  const stream = useRef<AbortController | null>(null);
  const activeEntry = useRef<string | null>(null);
  const histRef = useRef(hist);
  histRef.current = hist;

  const entry = hist.index >= 0 ? (hist.entries[hist.index] ?? null) : null;
  const current = () => histRef.current.entries[histRef.current.index] ?? null;

  const patchExpl = useCallback((id: string, fn: (e: ExplState) => ExplState) => {
    dispatch({ type: 'patch', id, fn: (en) => (en.expl ? { ...en, expl: fn(en.expl) } : en) });
  }, []);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.tree(snapshotId), api.overview(snapshotId)])
      .then(([t, o]) => {
        if (cancelled) return;
        setTree(t.root);
        setOverview(o);
        setLoadError(null);
        setLoading(false);
        if (initial.path) {
          dispatch({
            type: 'push',
            entry: {
              id: uid('h'),
              path: initial.path,
              line: initial.line ?? 1,
              label: initial.path.split('/').pop() ?? initial.path,
              expl: null,
            },
          });
        }
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

  // Load the file for the current entry.
  const path = entry?.path ?? null;
  useEffect(() => {
    if (!path) {
      setFile({ status: 'idle', data: null, error: null });
      return;
    }
    const hit = cache.current.get(path);
    if (hit) {
      setFile({ status: 'ready', data: hit, error: null });
      return;
    }
    let cancelled = false;
    setFile({ status: 'loading', data: null, error: null });
    api
      .file(snapshotId, path)
      .then((f) => {
        cache.current.set(path, f);
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
  }, [snapshotId, path]);

  const openFile = useCallback((p: string, line = 1) => {
    dispatch({
      type: 'push',
      entry: { id: uid('h'), path: p, line, label: p.split('/').pop() ?? p, expl: null },
    });
  }, []);

  const navigate = useCallback((p: string, line: number, label: string, symbolId?: string) => {
    const id = uid('h');
    dispatch({
      type: 'push',
      entry: {
        id,
        path: p,
        line,
        label,
        ...(symbolId ? { relationSymbolId: symbolId } : {}),
        relations: null,
        expl: null,
      },
    });
    void api.event('relation_clicked');
    if (symbolId) {
      api
        .relations(symbolId)
        .then((r) => dispatch({ type: 'patch', id, fn: (e) => ({ ...e, relations: r }) }))
        .catch(() => undefined); // navigation still works without the relations panel
    }
  }, []);

  const handleEvent = useCallback(
    (id: string, m: SseMessage) => {
      const d = m.data;
      if (m.event === 'relations') patchExpl(id, (e) => ({ ...e, relations: d as unknown as Relations }));
      else if (m.event === 'meta') patchExpl(id, (e) => ({ ...e, meta: d as unknown as Meta }));
      else if (m.event === 'section')
        patchExpl(id, (e) => ({ ...e, sections: [...e.sections, d as unknown as Section] }));
      else if (m.event === 'done')
        patchExpl(id, (e) => ({ ...e, status: 'done', done: d as unknown as DoneInfo }));
      else if (m.event === 'error')
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
      else dispatch({ type: 'push', entry: { id, path: sel.path, line: sel.startLine, label, expl } });
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

  const startCheck = useCallback(async () => {
    const cur = current();
    const ex = cur?.expl;
    if (!cur || !ex?.meta) return;
    patchExpl(cur.id, (e) => ({ ...e, check: { question: null, result: null, loading: true, error: null } }));
    void api.event('check_started');
    try {
      const q = await api.createCheck(ex.meta.explanationId);
      patchExpl(cur.id, (e) => ({ ...e, check: { question: q, result: null, loading: false, error: null } }));
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
  }, [patchExpl]);

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

  const closeCheck = useCallback(() => {
    const cur = current();
    if (cur?.expl) patchExpl(cur.id, (e) => ({ ...e, check: null }));
  }, [patchExpl]);

  // Navigating away does not cancel a running stream: it keeps filling its own stop, which Back restores.
  const goTo = useCallback((i: number) => dispatch({ type: 'go', index: i }), []);

  return {
    loading,
    loadError,
    tree,
    overview,
    entry,
    entries: hist.entries,
    index: hist.index,
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
    closeCheck,
    goTo,
    back: () => goTo(hist.index - 1),
    forward: () => goTo(hist.index + 1),
    clearSelectionError: () => setSelectionError(null),
  };
}
