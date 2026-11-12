import { NavLink, useLocation } from 'react-router-dom';

export const MODES = ['project', 'learn', 'explore', 'validate'] as const;
export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Record<Mode, string> = {
  project: 'Project',
  learn: 'Learn',
  explore: 'Explore',
  validate: 'Validate',
};

const HINTS: Record<Mode, string> = {
  project: 'What this repository is and where to start',
  learn: 'Guided lessons and tours through the code',
  explore: 'Investigate any file or symbol yourself',
  validate: 'Check your understanding',
};

/** The four modes of a repository workspace (P2.2). A share link (?share=…) is kept when switching. */
export function ModeNav({ snapshotId }: { snapshotId: string }) {
  const share = new URLSearchParams(useLocation().search).get('share');
  return (
    <nav className="mode-nav" aria-label="Modes">
      {MODES.map((m) => (
        <NavLink
          key={m}
          to={`/r/${snapshotId}/${m}${share ? `?share=${encodeURIComponent(share)}` : ''}`}
          className="mode-tab"
          title={HINTS[m]}
        >
          {MODE_LABELS[m]}
        </NavLink>
      ))}
    </nav>
  );
}
