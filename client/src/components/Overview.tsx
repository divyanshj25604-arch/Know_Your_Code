import { useState } from 'react';
import type { Overview as OverviewData } from '@kyc/contracts';
import { SKIP_REASON_COPY } from '../lib/skip';
import { Inline } from '../lib/inline';
import { ProvenanceTag } from './ui';

/**
 * "What is this project?" (Project mode): the summary, what it is made of (verified facts), and where to start. The
 * AI summary is labelled as such and the facts never depend on it.
 */
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
    <section className="section overview" id="overview" aria-labelledby="ov-h">
      <h2 id="ov-h" className="section-h">
        Project overview
      </h2>
      <p className="section-lede">What this code is, what it is built with, and where its story begins.</p>

      <div className="grid-2">
        <section aria-labelledby="ov-sum" className="card">
          <h3 id="ov-sum" className="card-h section-h">
            Summary <ProvenanceTag kind="explained" />
          </h3>
          {data.summary.status === 'ready' && data.summary.text ? (
            <>
              <p className="overview-summary">
                <Inline text={data.summary.text} />
              </p>
              {data.summary.modules && data.summary.modules.length > 0 && (
                <ul className="start-list">
                  {data.summary.modules.map((m) => (
                    <li key={m.name}>
                      <strong>{m.name}</strong>
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
                Written by an AI from the files listed. It can be wrong; the facts beside it are computed from
                the code.
              </p>
            </>
          ) : (
            <p className="muted">
              {data.summary.status === 'failed'
                ? "Couldn't write a summary this time. The facts beside it don't depend on it."
                : 'No AI summary is available for this repository. The facts beside it are computed from the code.'}
            </p>
          )}
        </section>

        <section aria-labelledby="ov-facts" className="card">
          <h3 id="ov-facts" className="card-h section-h">
            What it's made of <ProvenanceTag kind="verified" />
          </h3>
          <dl className="facts">
            <div>
              <dt>Frameworks</dt>
              <dd>{f.frameworks.length ? f.frameworks.join(', ') : 'none detected from package.json'}</dd>
            </div>
            <div>
              <dt>Languages</dt>
              <dd>{langs.length ? langs.map(([l, n]) => `${l} ${n}`).join(' · ') : 'none detected'}</dd>
            </div>
            <div>
              <dt>Files</dt>
              <dd>
                {f.fileCount} ({f.analysedCount} analysed)
              </dd>
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
      </div>

      {data.startingPoints.length > 0 && (
        <section aria-labelledby="ov-start" className="card">
          <h3 id="ov-start" className="card-h section-h">
            Where to start <ProvenanceTag kind="verified" />
          </h3>
          <p className="small muted">Each opens in Learn, beside an explanation panel.</p>
          <ul className="start-list">
            {data.startingPoints.map((s, i) => (
              <li key={i}>
                <button type="button" className="link" onClick={() => onOpen(s.path, s.line)}>
                  {s.label}
                </button>
                <span className="path">
                  {s.path}:{s.line}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.skipped.length > 0 && (
        <section aria-labelledby="ov-skip">
          <h3 id="ov-skip" className="card-h">
            <button
              type="button"
              className="disclosure"
              aria-expanded={showSkipped}
              onClick={() => setShowSkipped(!showSkipped)}
            >
              <span aria-hidden="true">{showSkipped ? '▾' : '▸'}</span> Skipped files ({data.skipped.length})
            </button>
          </h3>
          {showSkipped && (
            <ul className="plain-list small">
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
    </section>
  );
}
