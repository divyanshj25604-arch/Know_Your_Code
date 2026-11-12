import type { FileGraphView, FileOutlineView, FlowsView } from '@kyc/contracts';
import type { ApiError } from '../../api/client';
import { ErrorState, ProvenanceTag, Skeleton } from '../ui';
import { base, DATABASE_PACKAGES } from './graphModel';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const listOf = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * "What this file does": the selected file's responsibility, main declarations, what it imports, what depends on it,
 * the routes it handles and where to go next. Everything here is read from the stored analysis (Verified), so it is
 * shown even without the AI; asking the AI about a function or line happens in the explanation panel.
 */
export function FileExplanation({
  path,
  outline,
  outlineError,
  onRetry,
  fileGraph,
  flows,
  currentSymbolId,
  onOpen,
  onSymbol,
  onWalk,
}: {
  path: string | null;
  outline: FileOutlineView | null;
  outlineError: ApiError | null;
  onRetry: () => void;
  fileGraph: FileGraphView | null;
  flows: FlowsView | null;
  currentSymbolId: string | null;
  onOpen: (path: string, line: number, label: string) => void;
  onSymbol: (s: FileOutlineView['symbols'][number]) => void;
  onWalk: (flowId: string) => void;
}) {
  if (!path)
    return (
      <section className="file-expl" aria-label="What this file does">
        <h2 className="pane-h">What this file does</h2>
        <p className="small muted">
          Open a file from the graph, the starting points or Files (<kbd>T</kbd>), and its role in the project
          appears here.
        </p>
      </section>
    );
  if (outlineError)
    return (
      <section className="file-expl" aria-label="What this file does">
        <h2 className="pane-h">What this file does</h2>
        <ErrorState
          code={outlineError.code}
          message={outlineError.message}
          onAction={onRetry}
          actionLabel="Try again"
        />
      </section>
    );
  if (!outline || outline.path !== path)
    return (
      <section className="file-expl" aria-label="What this file does" aria-busy="true">
        <h2 className="pane-h">What this file does</h2>
        <Skeleton lines={4} />
      </section>
    );

  const decl = outline.symbols.filter((s) => s.parentId === null && s.kind !== 'variable');
  const fns = decl.filter((s) => s.kind === 'function');
  const classes = decl.filter((s) => s.kind === 'class');
  const exported = outline.symbols.filter((s) => s.exported).map((s) => s.name);
  const internalImports = [...new Set(outline.imports.filter((i) => i.path).map((i) => i.path!))];
  const packages = [...new Set(outline.imports.filter((i) => i.external).map((i) => i.external!))];
  const usedBy = [
    ...new Set([
      ...outline.importedBy.map((i) => i.path),
      ...(fileGraph?.edges.filter((e) => e.to === path && e.from !== path).map((e) => e.from) ?? []),
    ]),
  ];
  const db = (fileGraph?.externals ?? []).filter(
    (x) => x.from === path && x.kind === 'calls' && DATABASE_PACKAGES.has(x.package),
  );
  const routes = (flows?.flows ?? []).filter((f) => f.handler?.path === path);
  const unresolved = outline.symbolEdges.filter(
    (e) => e.from.path === path && !e.to.symbolId && !e.to.external,
  ).length;

  // One sentence of responsibility, built from facts only.
  const parts: string[] = [];
  if (routes.length) parts.push(`handles ${listOf(routes.map((r) => r.name))}`);
  if (fns.length || classes.length)
    parts.push(
      `defines ${listOf(
        [
          fns.length ? plural(fns.length, 'function') : '',
          classes.length ? `${classes.length} class${classes.length === 1 ? '' : 'es'}` : '',
        ].filter(Boolean),
      )}`,
    );
  if (db.length) parts.push(`calls ${listOf([...new Set(db.map((d) => d.package))])}`);
  if (exported.length)
    parts.push(`exports ${listOf(exported.slice(0, 4))}${exported.length > 4 ? ' and more' : ''}`);
  const sentence = parts.length
    ? `${base(path)} ${listOf(parts)}.`
    : outline.analysable
      ? `${base(path)} has no functions or classes of its own; it is configuration or top-level code.`
      : `${base(path)} isn't a JavaScript or TypeScript file, so it was shown for reading but not analysed.`;

  // Where to go next: a route through this file, the most-connected dependency, a file that depends on it.
  const next: { label: string; why: string; go: () => void }[] = [];
  const flow = (flows?.flows ?? []).find((f) => f.handler?.path === path);
  if (flow)
    next.push({
      label: `Walk through ${flow.name}`,
      why: 'Follow the request this file handles.',
      go: () => onWalk(flow.id),
    });
  const dep = internalImports[0];
  if (dep)
    next.push({ label: base(dep), why: 'What this file builds on.', go: () => onOpen(dep, 1, base(dep)) });
  const user = usedBy[0];
  if (user)
    next.push({ label: base(user), why: 'Where this file is used.', go: () => onOpen(user, 1, base(user)) });

  return (
    <section className="file-expl" aria-label="What this file does">
      <div className="row between">
        <h2 className="pane-h">What this file does</h2>
        <ProvenanceTag kind="verified" />
      </div>
      <p>{sentence}</p>
      {outline.module && <p className="small muted">Part of the {outline.module.name} module.</p>}
      {decl.length > 0 && (
        <div className="fx-block">
          <h3>Main parts</h3>
          <ul className="bare-list fx-list">
            {decl.slice(0, 12).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`code-cite${s.id === currentSymbolId ? ' is-current' : ''}`}
                  aria-current={s.id === currentSymbolId ? 'true' : undefined}
                  onClick={() => onSymbol(s)}
                >
                  <span>
                    {s.name}
                    {s.kind === 'class' ? '' : '()'}{' '}
                    <span className="muted small">
                      {s.kind}
                      {s.exported ? ', exported' : ''}
                    </span>
                  </span>
                  <span className="path">line {s.startLine}</span>
                </button>
              </li>
            ))}
          </ul>
          {decl.length > 12 && <p className="small muted">and {decl.length - 12} more in the graph.</p>}
        </div>
      )}
      {(internalImports.length > 0 || packages.length > 0) && (
        <div className="fx-block">
          <h3>Imports</h3>
          <ul className="bare-list fx-list">
            {internalImports.slice(0, 8).map((p) => (
              <li key={p}>
                <button type="button" className="code-cite" onClick={() => onOpen(p, 1, base(p))}>
                  <span>{base(p)}</span>
                  <span className="path">{p}</span>
                </button>
              </li>
            ))}
          </ul>
          {packages.length > 0 && (
            <p className="small">
              Packages: <span className="mono">{packages.join(', ')}</span>
            </p>
          )}
        </div>
      )}
      <div className="fx-block">
        <h3>Used by</h3>
        {usedBy.length ? (
          <ul className="bare-list fx-list">
            {usedBy.slice(0, 8).map((p) => (
              <li key={p}>
                <button type="button" className="code-cite" onClick={() => onOpen(p, 1, base(p))}>
                  <span>{base(p)}</span>
                  <span className="path">{p}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">
            No other analysed file imports or calls this one
            {outline.analysable ? '. It may be an entry point.' : '.'}
          </p>
        )}
      </div>
      {unresolved > 0 && (
        <p className="small">
          <ProvenanceTag kind="unknown" /> {plural(unresolved, 'call')} in this file couldn't be followed. The
          graph shows why.
        </p>
      )}
      {next.length > 0 && (
        <div className="fx-block">
          <h3>Explore next</h3>
          <ul className="bare-list fx-list">
            {next.map((n) => (
              <li key={n.label}>
                <button type="button" className="link" onClick={n.go}>
                  {n.label}
                </button>{' '}
                <span className="small muted">{n.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
