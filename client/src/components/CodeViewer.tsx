import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { tags as t } from '@lezer/highlight';
import type { Selection } from '@kyc/contracts';

export interface ViewerHandle {
  /** Current selection (or the cursor, as an empty range) in API coordinates; null when nothing is focused. */
  getSelection(): (Selection & { text: string }) | null;
  focus(): void;
}

export interface Anchor {
  x: number;
  y: number;
}

interface Props {
  path: string;
  content: string;
  language: string | null;
  /** Line to flash/centre (navigation target). */
  targetLine: number | null;
  /** Lines of the code the explanation panel is about; kept highlighted. */
  markRange: Selection | null;
  /** Changes whenever navigation should re-scroll even if the line is unchanged. */
  scrollKey: string;
  onSelect: (sel: Selection | null, anchor: Anchor | null) => void;
  onExplainKey: () => void;
}

const kycHighlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword],
    color: 'var(--syn-keyword)',
  },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-number)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))],
    color: 'var(--syn-function)',
  },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.punctuation, t.bracket, t.operator], color: 'var(--syn-punct)' },
]);

const setMarks = StateEffect.define<{ target: number | null; range: { from: number; to: number } | null }>();
const lineMark = Decoration.line({ class: 'cm-kyc-target' });
const rangeMark = Decoration.line({ class: 'cm-kyc-range' });

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue;
      const ranges = [];
      const doc = tr.state.doc;
      if (e.value.range) {
        const a = doc.lineAt(e.value.range.from).number;
        const b = doc.lineAt(e.value.range.to).number;
        for (let n = a; n <= b; n++) ranges.push(rangeMark.range(doc.line(n).from));
      }
      if (e.value.target && e.value.target >= 1 && e.value.target <= doc.lines) {
        ranges.push(lineMark.range(doc.line(e.value.target).from));
      }
      deco = Decoration.set(ranges, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '0.875rem' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-1)',
    color: 'var(--text-muted)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-content': { caretColor: 'var(--accent)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--highlight) !important',
  },
  '.cm-kyc-target': { backgroundColor: 'var(--highlight)', boxShadow: 'inset 3px 0 0 var(--accent)' },
  '.cm-kyc-range': { backgroundColor: 'var(--highlight)' },
});

function toApi(state: EditorState, from: number, to: number, path: string): Selection {
  const a = state.doc.lineAt(from);
  const b = state.doc.lineAt(to);
  return { path, startLine: a.number, startCol: from - a.from, endLine: b.number, endCol: to - b.from };
}

export const CodeViewer = forwardRef<ViewerHandle, Props>(function CodeViewer(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cb = useRef(props);
  cb.current = props;

  useImperativeHandle(ref, () => ({
    getSelection() {
      const v = viewRef.current;
      if (!v) return null;
      const r = v.state.selection.main;
      return { ...toApi(v.state, r.from, r.to, cb.current.path), text: v.state.sliceDoc(r.from, r.to) };
    },
    focus() {
      viewRef.current?.focus();
    },
  }));

  // (Re)create the editor when the file changes.
  useEffect(() => {
    if (!host.current) return;
    const ts = /\.(ts|tsx)$/.test(props.path);
    const jsx = /\.(jsx|tsx)$/.test(props.path) || !ts;
    const lang: Extension[] = props.language ? [javascript({ jsx, typescript: ts })] : [];
    const report = (view: EditorView) => {
      const r = view.state.selection.main;
      if (r.empty) return cb.current.onSelect(null, null);
      const c = view.coordsAtPos(r.head);
      cb.current.onSelect(
        toApi(view.state, r.from, r.to, cb.current.path),
        c ? { x: c.left, y: c.bottom } : null,
      );
    };
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.content,
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({
            'aria-label': `Source code: ${props.path}`,
            'aria-readonly': 'true',
          }),
          ...lang,
          syntaxHighlighting(kycHighlight),
          markField,
          theme,
          keymap.of([
            {
              key: 'e',
              run: () => {
                cb.current.onExplainKey();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet) report(u.view);
          }),
        ],
      }),
    });
    viewRef.current = view;
    const onScroll = () => report(view);
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll);
      view.destroy();
      viewRef.current = null;
    };
  }, [props.path, props.content, props.language]);

  // Marks + scroll.
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    let range: { from: number; to: number } | null = null;
    const m = props.markRange;
    if (m && m.path === props.path && m.startLine <= v.state.doc.lines && m.endLine <= v.state.doc.lines) {
      range = { from: v.state.doc.line(m.startLine).from, to: v.state.doc.line(m.endLine).from };
    }
    v.dispatch({ effects: setMarks.of({ target: props.targetLine, range }) });
    if (props.targetLine && props.targetLine >= 1 && props.targetLine <= v.state.doc.lines) {
      v.dispatch({
        effects: EditorView.scrollIntoView(v.state.doc.line(props.targetLine).from, { y: 'center' }),
      });
    }
  }, [props.targetLine, props.scrollKey, props.markRange, props.path, props.content]);

  return <div className="viewer-host" ref={host} data-testid="code-viewer" />;
});
