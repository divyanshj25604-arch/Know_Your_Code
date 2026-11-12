import { useEffect, useState } from 'react';
import type { FlowsView } from '@kyc/contracts';
import { api } from '../../api/client';
import { ProvenanceTag, Skeleton } from '../ui';
import { queries } from '../../state/queryCache';

/**
 * Request flows (P3.2): every Express route the analysis found, from the client call (when one matches) through
 * middleware and the handler down the verified call graph. Each opens in the step-by-step walkthrough.
 */
export function FlowList({ snapshotId, onWalk }: { snapshotId: string; onWalk: (flowId: string) => void }) {
  const [view, setView] = useState<FlowsView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    queries
      .get(`flows:${snapshotId}`, () => api.flows(snapshotId))
      .then(setView)
      .catch(() => setError(true));
  }, [snapshotId]);
  if (error) return <p className="muted">Request flows couldn't be loaded.</p>;
  if (!view) return <Skeleton lines={3} />;
  return (
    <section className="sec" aria-labelledby="flows-h">
      <h2 id="flows-h" className="panel-h">
        Request flows <ProvenanceTag kind="pattern" />
      </h2>
      {!view.available ? (
        <p className="muted">
          This snapshot was analysed before flow discovery. Import it again to see its flows.
        </p>
      ) : view.flows.length === 0 ? (
        <p className="muted">
          No Express routes were found in this code. Flows are discovered for Express apps.
        </p>
      ) : (
        <ul className="arch-map">
          {view.flows.map((f) => (
            <li key={f.id} className="arch-node" aria-label={`Flow ${f.name}`}>
              <strong className="mono">{f.name}</strong>
              <p className="small muted">
                {f.stepCount} step{f.stepCount === 1 ? '' : 's'}
                {f.handler ? ` · handled by ${f.handler.name}` : ''}
                {f.clients > 0
                  ? ` · called from ${f.clients} place${f.clients === 1 ? '' : 's'} in the client`
                  : ''}
                {f.unknownCount > 0 ? ` · ${f.unknownCount} not followed` : ''}
              </p>
              <button type="button" className="btn btn-small" onClick={() => onWalk(f.id)}>
                Walk through {f.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
