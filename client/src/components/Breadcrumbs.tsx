import type { HistoryEntry } from '../lib/expl';

export function Breadcrumbs({
  entries,
  index,
  onJump,
  onBack,
  onForward,
}: {
  entries: HistoryEntry[];
  index: number;
  onJump: (i: number) => void;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <nav className="crumbs" aria-label="Your trail">
      <button
        type="button"
        className="icon-btn"
        onClick={onBack}
        disabled={index <= 0}
        aria-label="Back (Alt+Left)"
        title="Back (Alt+←)"
      >
        ←
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={onForward}
        disabled={index >= entries.length - 1}
        aria-label="Forward (Alt+Right)"
        title="Forward (Alt+→)"
      >
        →
      </button>
      <ol className="crumb-list">
        {entries.slice(Math.max(0, entries.length - 6)).map((e, i, arr) => {
          const real = entries.length - arr.length + i;
          return (
            <li key={e.id}>
              <button
                type="button"
                className={`crumb${real === index ? ' is-current' : ''}`}
                aria-current={real === index ? 'step' : undefined}
                onClick={() => onJump(real)}
              >
                {e.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
