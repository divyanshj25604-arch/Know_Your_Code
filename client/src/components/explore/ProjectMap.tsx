import { useMemo, useState } from 'react';
import { GraphCanvas } from '../graph/GraphCanvas';
import { EmptyState, ErrorState, ProvenanceTag, Skeleton } from '../ui';
import { buildApplication } from './graphModel';
import { useArchitecture, useFileGraph } from './useExploreData';

/**
 * Orientation's architecture map (PRD stage 4): the application's modules and the packages they call, drawn from the
 * stored analysis, interactive from the first screen. Selecting a module shows what it is; selecting it again (or
 * "Explore this module") opens Explore one level down, at its files.
 */
export function ProjectMap({
  snapshotId,
  onExploreModule,
  onExplore,
}: {
  snapshotId: string;
  onExploreModule: (key: string) => void;
  onExplore: () => void;
}) {
  const arch = useArchitecture(snapshotId);
  const fg = useFileGraph(snapshotId);
  const [sel, setSel] = useState<string | null>(null);
  const built = useMemo(
    () => (arch.data?.available ? buildApplication(arch.data, fg.data, () => 0) : null),
    [arch.data, fg.data],
  );
  const t = sel ? built?.targets.get(sel) : null;
  const mod = t?.kind === 'module' ? arch.data?.modules.find((m) => m.key === t.key) : null;
  const uses = mod ? (arch.data?.dependencies.filter((d) => d.from === mod.key) ?? []) : [];
  const usedBy = mod ? (arch.data?.dependencies.filter((d) => d.to === mod.key) ?? []) : [];
  const name = (k: string) => arch.data?.modules.find((m) => m.key === k)?.name ?? k;

  return (
    <section className="section project-map" id="map" aria-labelledby="map-h">
      <div className="row between">
        <h2 id="map-h" className="section-h">
          Architecture map
        </h2>
        <button type="button" className="btn btn-small" onClick={onExplore}>
          Open Explore
        </button>
      </div>
      <p className="section-lede">
        The main parts of the code and how they depend on each other, from imports the parser verified. Select
        a module to see what it is; select it again to explore its files.
      </p>
      {arch.error && (
        <ErrorState
          code={arch.error.code}
          message={arch.error.message}
          onAction={arch.retry}
          actionLabel="Try again"
        />
      )}
      {arch.loading && <Skeleton lines={5} />}
      {arch.data && !arch.data.available && (
        <EmptyState title="No map for this snapshot">
          It was analysed before module detection existed. Import the repository again to see its map.
        </EmptyState>
      )}
      {built && (
        <div className="project-map-body">
          <div className="project-map-canvas">
            <GraphCanvas
              label="Architecture map"
              nodes={built.nodes}
              edges={built.edges}
              selectedId={sel}
              onSelect={setSel}
              onActivate={(id) => {
                const x = built.targets.get(id);
                if (x?.kind === 'module') onExploreModule(x.key);
              }}
              resetKey={snapshotId}
            />
          </div>
          <div className="project-map-info" aria-live="polite">
            {mod ? (
              <>
                <p className="row">
                  <strong>{mod.name}</strong> <ProvenanceTag kind="verified" />
                </p>
                <p className="small">
                  {mod.kind === 'package' ? 'Workspace package' : 'Folder'}{' '}
                  <span className="path">{mod.root || '/'}</span> with {mod.files.length} file
                  {mod.files.length === 1 ? '' : 's'}.
                </p>
                <p className="small">
                  {uses.length ? (
                    <>Uses {uses.map((d) => `${name(d.to)} (${d.imports})`).join(', ')}.</>
                  ) : (
                    'Uses no other module.'
                  )}{' '}
                  {usedBy.length ? (
                    <>Used by {usedBy.map((d) => name(d.from)).join(', ')}.</>
                  ) : (
                    'No other module uses it.'
                  )}
                </p>
                <button type="button" className="btn btn-small" onClick={() => onExploreModule(mod.key)}>
                  Explore this module
                </button>
              </>
            ) : t?.kind === 'package' ? (
              <>
                <p className="row">
                  <strong className="mono">{t.name}</strong>
                  {t.database && <ProvenanceTag kind="pattern" />}
                </p>
                <p className="small">
                  {t.database
                    ? 'A database client: the calls into it are verified; that it is the data store is inferred from its name.'
                    : 'An npm package the code calls. Its own code is not analysed.'}
                </p>
              </>
            ) : (
              <p className="small muted">
                Select a module in the map. Keyboard: Tab to the map, arrow keys to move, Enter to select.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
