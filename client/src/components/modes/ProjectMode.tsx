import type { MouseEvent, ReactNode } from 'react';
import type { Overview as OverviewData, PathsView, TourView } from '@kyc/contracts';
import { Overview } from '../Overview';
import { PathList, doneCount } from '../learning/PathPlayer';
import { ErrorState, PageHeader, Skeleton } from '../ui';
import type { Workspace } from '../../hooks/useWorkspace';

const SECTIONS: [string, string][] = [
  ['map', 'Architecture map'],
  ['overview', 'Overview'],
  ['learning', 'Learning paths'],
  ['architecture', 'Modules'],
  ['flows', 'Request flows'],
  ['concepts', 'Concepts'],
  ['bookmarks', 'Bookmarks'],
];

/** In-page links that work under both routers (hash routes must not be replaced by a fragment). */
function jump(e: MouseEvent<HTMLAnchorElement>, id: string) {
  e.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

type Next = { title: string; text: ReactNode; action: string; run: () => void };

/** The one recommended next step (Journey A step 9, Journey B step 4): continue, else start learning, else tour. */
function nextStep(p: {
  learning: Workspace;
  paths: PathsView | null;
  tour: TourView | null;
  onContinue: () => void;
  onStartPath: (id: string) => void;
  onStartTour: () => void;
  onExplore: () => void;
}): Next | null {
  if (!p.learning.restored || !p.paths || !p.tour) return null;
  const started = p.paths.paths.find((x) => x.status === 'started');
  if (p.learning.entry || started)
    return {
      title: 'Continue learning',
      text: started ? (
        <>
          You're part-way through <strong>{started.title}</strong> ({doneCount(started)} of{' '}
          {started.items.length} done).
        </>
      ) : (
        <>
          You were at <span className="mono">{p.learning.entry!.label}</span>. Pick up exactly where you left
          off.
        </>
      ),
      action: 'Continue learning',
      run: started ? () => p.onStartPath(started.id) : p.onContinue,
    };
  const fresh = p.paths.paths.find((x) => x.status === 'not_started');
  if (fresh)
    return {
      title: 'Start here',
      text: (
        <>
          <strong>{fresh.title}</strong>: {fresh.summary}
        </>
      ),
      action: 'Start learning',
      run: () => p.onStartPath(fresh.id),
    };
  if (p.tour.stops.length > 0)
    return {
      title: 'Start here',
      text: `A guided tour of ${p.tour.stops.length} stops through the most important code, in order.`,
      action: 'Start the guided tour',
      run: p.onStartTour,
    };
  return {
    title: 'Start here',
    text: 'Open the code and select anything to see what it does and what it connects to.',
    action: 'Explore the code',
    run: p.onExplore,
  };
}

/**
 * Project mode: "What is this project, and where do I start?" One recommended next step (the only primary action on
 * the page), the overview, then the ways in: learning paths, architecture, flows, concepts and bookmarks. Opening code
 * from here goes to Explore; starting points and paths go to Learn.
 */
export function ProjectMode({
  name,
  learning,
  overview,
  paths,
  pathsError,
  tour,
  onLearnAt,
  onContinue,
  onStartPath,
  onStartTour,
  onExplore,
  map,
  children,
}: {
  name: string;
  learning: Workspace;
  overview: OverviewData | null;
  paths: PathsView | null;
  pathsError: boolean;
  tour: TourView | null;
  onLearnAt: (path: string, line?: number) => void;
  onContinue: () => void;
  onStartPath: (id: string) => void;
  onStartTour: () => void;
  onExplore: () => void;
  /** The interactive architecture map, shown first so the shape of the project is the first thing seen. */
  map?: ReactNode;
  /** The project-wide sections after the learning paths (architecture, flows, concepts, bookmarks). */
  children?: ReactNode;
}) {
  const next = nextStep({ learning, paths, tour, onContinue, onStartPath, onStartTour, onExplore });
  const frameworks = overview?.facts.frameworks ?? [];
  return (
    <main className="page-main" id="main">
      <div className="project-layout">
        <div>
          <PageHeader
            eyebrow="Project"
            title={<span className="mono">{name}</span>}
            lede="How this code is organised, what it is built with, and where to start."
          >
            {frameworks.length > 0 && (
              <ul className="chips bare-list" aria-label="Built with">
                {frameworks.map((f) => (
                  <li key={f} className="stack-chip">
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </PageHeader>
          {learning.loadError && (
            <ErrorState code={learning.loadError.code} message={learning.loadError.message} />
          )}
          {map}
          {overview ? <Overview data={overview} onOpen={onLearnAt} /> : <Skeleton lines={8} />}

          <section className="section" id="learning" aria-labelledby="learning-h">
            <h2 id="learning-h" className="section-h">
              Learning paths
            </h2>
            <p className="section-lede">
              Short routes through this code: lessons that cite real lines, missions where you find the code
              yourself, and checks. Progress is saved.
            </p>
            <PathList view={paths} error={pathsError} onOpen={onStartPath} />
            {tour && tour.stops.length > 0 && (
              <p className="row" style={{ marginTop: 'var(--s4)' }}>
                <span className="muted small">Prefer a quick look first?</span>
                <button type="button" className="btn btn-small" onClick={onStartTour}>
                  Take the guided tour ({tour.stops.length} stops)
                </button>
              </p>
            )}
          </section>
          {children}
        </div>

        <aside className="project-aside" aria-label="Next step and contents">
          <section className="next-step" aria-labelledby="next-h">
            <span className="eyebrow">Recommended</span>
            {next ? (
              <>
                <h2 id="next-h">{next.title}</h2>
                <p>{next.text}</p>
                <button type="button" className="btn btn-primary btn-block" onClick={next.run}>
                  {next.action}
                </button>
                {next.action !== 'Explore the code' && (
                  <button type="button" className="btn btn-block" onClick={onExplore}>
                    Explore the code
                  </button>
                )}
              </>
            ) : (
              <>
                <h2 id="next-h">Finding a good place to start…</h2>
                <Skeleton lines={2} />
              </>
            )}
          </section>
          <nav className="toc" aria-label="On this page">
            <span className="eyebrow">On this page</span>
            <ol>
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} onClick={(e) => jump(e, id)}>
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
      </div>
    </main>
  );
}
