import { useState } from 'react';
import type { Relations, RelationItem } from '@kyc/contracts';
import { ProvenanceTag } from './ui';

const REASON_TEXT: Record<string, string> = {
  dynamic_import: 'the module name is decided at runtime',
  computed_member: 'the method is chosen at runtime (obj[name]())',
  external_package: 'it belongs to an external package',
  parse_error: 'the target file could not be parsed',
  no_declaration: "the code doesn't show where this is defined",
  callback_parameter: 'it is a function passed in as an argument',
};

function reasonText(reason: string): string {
  const [code, pkg] = reason.split(':');
  const base = REASON_TEXT[code ?? ''] ?? 'it could not be resolved statically';
  return pkg ? `${base}: ${pkg}` : base;
}

export function RelationList({
  relations,
  onNavigate,
}: {
  relations: Relations;
  onNavigate: (path: string, line: number, label: string, symbolId?: string) => void;
}) {
  const [showImports, setShowImports] = useState(false);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const item = (r: RelationItem, i: number) => (
    <li key={`${r.path}:${r.line}:${i}`}>
      <button
        type="button"
        className="rel-link"
        onClick={() => onNavigate(r.path, r.line, r.label, r.symbolId)}
      >
        <span className="rel-label">{r.label}</span>
        <span className="rel-loc">
          {r.path}:{r.line}
        </span>
      </button>
      <ProvenanceTag kind={r.provenance} />
    </li>
  );
  const empty =
    relations.calledBy.length === 0 && relations.calls.length === 0 && relations.unresolved.length === 0;
  return (
    <section className="relations" aria-labelledby="rel-h">
      <h3 id="rel-h" className="panel-h">
        Connections <ProvenanceTag kind="verified" />
      </h3>
      {relations.definedIn && (
        <p className="rel-def">
          Defined in{' '}
          <button
            type="button"
            className="rel-link inline"
            onClick={() =>
              onNavigate(
                relations.definedIn!.path,
                relations.definedIn!.line,
                relations.symbol?.name ?? 'definition',
                relations.symbol?.id,
              )
            }
          >
            {relations.definedIn.path}:{relations.definedIn.line}
          </button>
        </p>
      )}
      <h4 className="rel-h">Called by / used by</h4>
      {relations.calledBy.length ? (
        <ul className="rel-list">{relations.calledBy.map(item)}</ul>
      ) : (
        <p className="muted">Nothing in the analysed code calls or uses this.</p>
      )}
      <h4 className="rel-h">Calls</h4>
      {relations.calls.length ? (
        <ul className="rel-list">{relations.calls.map(item)}</ul>
      ) : (
        <p className="muted">No calls that resolve to code in this repository.</p>
      )}
      {relations.imports.length > 0 && (
        <>
          <button
            type="button"
            className="disclosure"
            aria-expanded={showImports}
            onClick={() => setShowImports(!showImports)}
          >
            {showImports ? '▾' : '▸'} Imports in this file ({relations.imports.length})
          </button>
          {showImports && (
            <ul className="rel-list">
              {relations.imports.map((i, idx) => (
                <li key={idx}>
                  {i.path ? (
                    <button
                      type="button"
                      className="rel-link"
                      onClick={() => onNavigate(i.path!, 1, i.label)}
                    >
                      <span className="rel-label">{i.label}</span>
                      <span className="rel-loc">{i.path}</span>
                    </button>
                  ) : (
                    <span className="rel-link is-disabled">
                      <span className="rel-label">{i.label}</span>
                      <span className="rel-loc">{i.external ? 'external package' : 'not found'}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {relations.unresolved.length > 0 && (
        <>
          <button
            type="button"
            className="disclosure"
            aria-expanded={showUnresolved}
            onClick={() => setShowUnresolved(!showUnresolved)}
          >
            {showUnresolved ? '▾' : '▸'} Can't follow statically ({relations.unresolved.length})
          </button>
          {showUnresolved && (
            <ul className="rel-list">
              {relations.unresolved.map((u, i) => (
                <li key={i} className="is-unresolved">
                  <code>{u.label}</code>{' '}
                  <span className="muted">
                    line {u.line}: {reasonText(u.reason)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {empty && (
        <p className="muted">
          No relations were found for this code. Static analysis can't see calls that are decided at runtime.
        </p>
      )}
    </section>
  );
}
