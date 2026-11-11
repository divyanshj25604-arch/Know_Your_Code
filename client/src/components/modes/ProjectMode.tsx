import type { Overview as OverviewData } from '@kyc/contracts';
import { Overview } from '../Overview';
import { ErrorState, Skeleton } from '../ui';
import type { Workspace } from '../../hooks/useWorkspace';

/**
 * Project mode (P2.2): the whole repository at a glance. Starting points open in Learn, so following one starts (or
 * continues) the guided learning trail; an existing learning position can be resumed exactly.
 */
export function ProjectMode({
  learning,
  overview,
  onLearnAt,
  onContinue,
}: {
  learning: Workspace;
  overview: OverviewData | null;
  onLearnAt: (path: string, line?: number) => void;
  onContinue: () => void;
}) {
  return (
    <main className="mode-page" id="main">
      {learning.entry && (
        <p className="note">
          You were learning at <span className="mono">{learning.entry.label}</span>.{' '}
          <button type="button" className="btn btn-small btn-primary" onClick={onContinue}>
            Continue learning
          </button>
        </p>
      )}
      {learning.loadError && (
        <ErrorState code={learning.loadError.code} message={learning.loadError.message} />
      )}
      {overview ? <Overview data={overview} onOpen={onLearnAt} /> : <Skeleton lines={6} />}
    </main>
  );
}
