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
  /** The line the cursor or selection starts on, whenever the user moves it (code → graph). */
  onCursor?: (line: number) => void;
}

const kycHighlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword],
    color: 'var(--kyc-syntax-keyword)',
  },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--kyc-syntax-string)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--kyc-syntax-comment)',
    fontStyle: 'italic',
  },
  { tag: [t.number, t.bool, t.null], color: 'var(--kyc-syntax-number)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))],
    color: 'var(--kyc-syntax-function)',
  },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--kyc-syntax-type)' },
  { tag: [t.punctuation, t.bracket, t.operator], color: 'var(--kyc-syntax-punct)' },
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

// Brand (08 §A): the selected line is a full-width Highlighter fill with Ink Deep text and syntax colours off; the lines
// an explanation is about keep a quieter tint with a Highlighter rule. One highlight per view.
const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--kyc-code-bg)',
    color: 'var(--kyc-code-text)',
    fontSize: '0.875rem',
  },
  '.cm-scroller': { fontFamily: 'var(--kyc-font-code)', lineHeight: '22px', overflow: 'auto' },
  '.cm-gutters': {
    backgroundColor: 'var(--kyc-code-gutter)',
    color: 'var(--kyc-text-muted)',
    border: 'none',
    borderRight: '1px solid var(--kyc-border)',
  },
  '.cm-content': { caretColor: 'var(--kyc-text)' },
  '.cm-cursor': { borderLeftColor: 'var(--kyc-text)' },
  '&.cm-focused': { outline: '2px solid var(--kyc-focus)', outlineOffset: '-2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--kyc-code-selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-kyc-range': {
    backgroundColor: 'var(--kyc-code-range)',
    boxShadow: 'inset 3px 0 0 var(--kyc-code-range-rule)',
  },
  '.cm-kyc-target': {
    backgroundColor: 'var(--kyc-code-target-bg) !important',
    color: 'var(--kyc-code-target-text)',
    boxShadow: 'none',
  },
  '.cm-kyc-target *': { color: 'var(--kyc-code-target-text) !important' },
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
            // Already in the tab order (contenteditable); stated explicitly so the scroll area counts as focusable.
            tabindex: '0',
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
            if (u.selectionSet) {
              report(u.view);
              if (u.transactions.some((tr) => tr.isUserEvent('select') || tr.isUserEvent('pointer')))
                cb.current.onCursor?.(u.state.doc.lineAt(u.state.selection.main.from).number);
            }
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
