import { useEffect, useState } from 'react';
import type { FlowsView } from '@kyc/contracts';
import { api } from '../../api/client';
import { EmptyState, ProvenanceTag, Skeleton } from '../ui';
import { queries } from '../../state/queryCache';

/**
 * Request flows (P3.2): every Express route the analysis found, from the client call (when one matches) through
 * middleware and the handler down the verified call graph. Each opens in the step-by-step walkthrough.
 */
export function FlowList({
  snapshotId,
  onWalk,
  compact,
}: {
  snapshotId: string;
  onWalk: (flowId: string) => void;
  /** A short list (Explore's start page) instead of the project section. */
  compact?: boolean;
}) {
  const [view, setView] = useState<FlowsView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    queries
      .get(`flows:${snapshotId}`, () => api.flows(snapshotId))
      .then(setView)
      .catch(() => setError(true));
  }, [snapshotId]);
  if (compact) {
    if (!view?.available || view.flows.length === 0) return null;
    return (
      <section className="section" aria-labelledby="flows-c-h">
        <h3 id="flows-c-h">Walk a request flow</h3>
        <ul className="start-list">
          {view.flows.map((f) => (
            <li key={f.id}>
              <button type="button" className="link mono" onClick={() => onWalk(f.id)}>
                {f.name}
              </button>
              <span className="muted small">
                {f.stepCount} step{f.stepCount === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section className="section" id="flows" aria-labelledby="flows-h">
      <h2 id="flows-h" className="section-h">
        Request flows <ProvenanceTag kind="pattern" />
      </h2>
      <p className="section-lede">
        How a request travels through the app: route, middleware, handler and the calls it makes. Each one can
        be walked step by step beside the code.
      </p>
      {error ? (
        <p className="muted">Request flows couldn't be loaded.</p>
      ) : !view ? (
        <Skeleton lines={3} />
      ) : !view.available ? (
        <EmptyState title="No flows for this snapshot">
          It was analysed before flow discovery existed. Import the repository again to see its flows.
        </EmptyState>
      ) : view.flows.length === 0 ? (
        <EmptyState title="No request flows found">
          Flows are discovered for Express apps, and no Express routes were found in this code.
        </EmptyState>
      ) : (
        <ul className="arch-map">
          {view.flows.map((f) => (
            <li key={f.id} className="arch-node" aria-label={`Flow ${f.name}`}>
              <h3 className="node-title mono">{f.name}</h3>
              <p className="small muted">
                {f.stepCount} step{f.stepCount === 1 ? '' : 's'}
                {f.handler ? ` · handled by ${f.handler.name}` : ''}
                {f.clients > 0
                  ? ` · called from ${f.clients} place${f.clients === 1 ? '' : 's'} in the client`
                  : ''}
                {f.unknownCount > 0 ? ` · ${f.unknownCount} not followed` : ''}
              </p>
              <div className="node-actions">
                <button type="button" className="btn btn-small" onClick={() => onWalk(f.id)}>
                  Walk through {f.name}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
