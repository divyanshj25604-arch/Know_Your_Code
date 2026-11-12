import { useEffect, useState } from 'react';
import type { ArchitectureView } from '@kyc/contracts';
import { api } from '../../api/client';
import { ProvenanceTag, Skeleton } from '../ui';
import { queries } from '../../state/queryCache';

/**
 * Architecture map (P3.1): the repository's modules (workspace packages, or folders), what each one uses (import
 * counts from verified edges), and the real files in each module, every one of which opens in the code viewer.
 */
export function ArchitectureMap({
  snapshotId,
  onOpenFile,
}: {
  snapshotId: string;
  onOpenFile: (path: string) => void;
}) {
  const [arch, setArch] = useState<ArchitectureView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    queries
      .get(`architecture:${snapshotId}`, () => api.architecture(snapshotId))
      .then(setArch)
      .catch(() => setError(true));
  }, [snapshotId]);
  if (error) return <p className="muted">The architecture map couldn't be loaded.</p>;
  if (!arch) return <Skeleton lines={4} />;
  if (!arch.available)
    return (
      <p className="muted">
        This snapshot was analysed before module detection. Import it again to see its map.
      </p>
    );
  const nameOf = new Map(arch.modules.map((m) => [m.key, m.name]));
  return (
    <section className="sec" aria-labelledby="arch-h">
      <h2 id="arch-h" className="panel-h">
        Architecture {arch.monorepo ? '(monorepo packages)' : '(modules)'} <ProvenanceTag kind="verified" />
      </h2>
      <ul className="arch-map">
        {arch.modules.map((m) => {
          const uses = arch.dependencies.filter((d) => d.from === m.key);
          const usedBy = arch.dependencies.filter((d) => d.to === m.key).length;
          return (
            <li key={m.key} className="arch-node" aria-label={`Module ${m.name}`}>
              <strong>{m.name}</strong>{' '}
              <span className="tag">{m.kind === 'package' ? 'package' : 'folder'}</span>{' '}
              <span className="mono muted small">{m.root || '/'}</span>
              <p className="small muted">
                {m.files.length} file{m.files.length === 1 ? '' : 's'} · used by {usedBy} module
                {usedBy === 1 ? '' : 's'}
              </p>
              {uses.length > 0 && (
                <p className="small">
                  Uses:{' '}
                  {uses.map((d, i) => (
                    <span key={d.to}>
                      {i > 0 && ', '}
                      {nameOf.get(d.to) ?? d.to}{' '}
                      <span className="muted">
                        ({d.imports} import{d.imports === 1 ? '' : 's'})
                      </span>
                    </span>
                  ))}
                </p>
              )}
              <details>
                <summary className="small">Files</summary>
                <ul className="plain-list">
                  {m.files.map((f) => (
                    <li key={f}>
                      <button type="button" className="link mono small" onClick={() => onOpenFile(f)}>
                        {f}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
