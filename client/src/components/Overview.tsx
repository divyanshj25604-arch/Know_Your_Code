import { useState } from 'react';
import type { Overview as OverviewData } from '@kyc/contracts';
import { SKIP_REASON_COPY } from '../lib/skip';
import { Inline } from '../lib/inline';
import { ProvenanceTag } from './ui';

export function Overview({
  data,
  onOpen,
}: {
  data: OverviewData;
  onOpen: (path: string, line?: number) => void;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const f = data.facts;
  const langs = Object.entries(f.languages).sort((a, b) => b[1] - a[1]);
  return (
    <div className="overview">
      <h1 className="page-title">Project overview</h1>

      <section aria-labelledby="ov-facts" className="card">
        <h2 id="ov-facts" className="panel-h">
          What this project is made of <ProvenanceTag kind="verified" />
        </h2>
        <dl className="facts">
          <div>
            <dt>Files</dt>
            <dd>
              {f.fileCount} ({f.analysedCount} analysed)
            </dd>
          </div>
          <div>
            <dt>Languages</dt>
            <dd>{langs.length ? langs.map(([l, n]) => `${l} ${n}`).join(' · ') : 'none detected'}</dd>
          </div>
          <div>
            <dt>Frameworks</dt>
            <dd>{f.frameworks.length ? f.frameworks.join(', ') : 'none detected from package.json'}</dd>
          </div>
          <div>
            <dt>Entry points</dt>
            <dd>
              {f.entryPoints.length
                ? f.entryPoints.map((p) => (
                    <button key={p} type="button" className="link mono" onClick={() => onOpen(p, 1)}>
                      {p}
                    </button>
                  ))
                : 'not detected'}
            </dd>
          </div>
          <div>
            <dt>Analysis</dt>
            <dd>
              {f.symbolCount} symbols · {f.edgeCount} relationships · {f.unresolvedCount} that can't be
              followed statically
            </dd>
          </div>
        </dl>
      </section>

      {data.startingPoints.length > 0 && (
        <section aria-labelledby="ov-start" className="card">
          <h2 id="ov-start" className="panel-h">
            Where to start <ProvenanceTag kind="verified" />
          </h2>
          <ul className="plain-list">
            {data.startingPoints.map((s, i) => (
              <li key={i}>
                <button type="button" className="link" onClick={() => onOpen(s.path, s.line)}>
                  {s.label}
                </button>
                <span className="muted mono">
                  {' '}
                  {s.path}:{s.line}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ov-sum" className="card">
        <h2 id="ov-sum" className="panel-h">
          Summary <ProvenanceTag kind="explained" />
        </h2>
        {data.summary.status === 'ready' && data.summary.text ? (
          <>
            <p>
              <Inline text={data.summary.text} />
            </p>
            {data.summary.modules && data.summary.modules.length > 0 && (
              <ul className="plain-list">
                {data.summary.modules.map((m) => (
                  <li key={m.name}>
                    <strong>{m.name}</strong>{' '}
                    {m.paths.map((p) => (
                      <button key={p} type="button" className="link mono" onClick={() => onOpen(p, 1)}>
                        {p}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">
              Written by an AI from the files above. It can be wrong; the facts above are computed from your
              code.
            </p>
          </>
        ) : (
          <p className="muted">
            {data.summary.status === 'failed'
              ? "Couldn't write a summary this time. The facts above don't depend on it."
              : 'No AI summary is available for this repository.'}
          </p>
        )}
      </section>

      {data.skipped.length > 0 && (
        <section aria-labelledby="ov-skip" className="card">
          <h2 id="ov-skip" className="panel-h">
            <button
              type="button"
              className="disclosure"
              aria-expanded={showSkipped}
              onClick={() => setShowSkipped(!showSkipped)}
            >
              {showSkipped ? '▾' : '▸'} Skipped files ({data.skipped.length})
            </button>
          </h2>
          {showSkipped && (
            <ul className="plain-list">
              {data.skipped.map((s) => (
                <li key={s.path}>
                  <span className="mono">{s.path}</span>{' '}
                  <span className="muted">— {SKIP_REASON_COPY[s.reason] ?? s.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p className="muted">
        Pick a file from the tree, or choose a starting point. Then select any code to see what it does.
      </p>
    </div>
  );
}
