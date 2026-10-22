import type { ErrorCode, Relations, Selection } from '@kyc/contracts';
import type { CheckQuestion, CheckResult } from '../api/client';

export interface Ref {
  path: string;
  line: number;
}

export interface Section {
  name: 'what' | 'why' | 'steps' | 'inputs' | 'dependsOn' | 'effects' | 'edgeCases';
  text?: string;
  refs?: Ref[];
  steps?: { text: string; lines: number[] }[];
  items?: { text: string; refs: Ref[] }[];
}

export interface Meta {
  explanationId: string;
  kind: string;
  cached: boolean;
  depth: string;
  note: string | null;
  spansMultiple: boolean;
  parentId: string | null;
}

export interface DoneInfo {
  concepts: { id: string; label: string }[];
  exploreNext: { type: 'question'; text: string }[];
  tryIt: { type: 'predict' | 'explain'; text: string } | null;
  uncertainty: { text: string }[];
  refsStripped: number;
}

export interface StreamError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export type ThreadItem =
  | { id: string; kind: 'question'; text: string }
  | {
      id: string;
      kind: 'answer';
      messageId: string;
      text: string;
      refs: Ref[];
      uncertainty: { text: string }[];
    }
  | {
      id: string;
      kind: 'concept';
      messageId: string;
      concept: string;
      plain: string;
      term: string;
      inYourCode: { path: string; line: number; note: string }[];
      spotIt?: { question: string };
      backToCode: string;
    }
  | { id: string; kind: 'pending'; label: string }
  | {
      id: string;
      kind: 'error';
      error: StreamError;
      retry?: { intent: 'followup' | 'concept'; text?: string; conceptId?: string };
    };

export interface ExplState {
  status: 'streaming' | 'done' | 'error';
  selection: Selection;
  label: string;
  relations: Relations | null;
  meta: Meta | null;
  sections: Section[];
  done: DoneInfo | null;
  error: StreamError | null;
  thread: ThreadItem[];
  check: {
    question: CheckQuestion | null;
    result: CheckResult | null;
    loading: boolean;
    error: string | null;
  } | null;
  visitedConcepts: string[];
}

export function newExpl(selection: Selection, label: string): ExplState {
  return {
    status: 'streaming',
    selection,
    label,
    relations: null,
    meta: null,
    sections: [],
    done: null,
    error: null,
    thread: [],
    check: null,
    visitedConcepts: [],
  };
}

/** One stop in the learner's trail (docs/06 DP7): a file position, optionally with the explanation shown there. */
export interface HistoryEntry {
  id: string;
  path: string;
  line: number;
  label: string;
  /** When the entry came from clicking a relation: the symbol whose relations the panel shows. */
  relationSymbolId?: string;
  relations?: Relations | null;
  expl: ExplState | null;
}

export function selectionLabel(sel: Selection, symbolName: string | null | undefined, text?: string): string {
  if (symbolName) return symbolName;
  if (text) return text.length > 32 ? `${text.slice(0, 31)}…` : text;
  return `${sel.path.split('/').pop()}:${sel.startLine}`;
}
