import type { StageInfo } from '@kyc/contracts';

const LABEL: Record<StageInfo['name'], string> = {
  fetching: 'Fetching the repository',
  filtering: 'Filtering files',
  analysing: 'Analysing code',
  summarising: 'Writing a summary',
};

const ICON: Record<StageInfo['state'], string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  failed: '✕',
  skipped: '–',
};
const WORD: Record<StageInfo['state'], string> = {
  pending: 'waiting',
  running: 'in progress',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
};

export function StageProgress({ stages }: { stages: StageInfo[] }) {
  return (
    <ol className="stages" aria-label="Import progress">
      {stages.map((s) => (
        <li key={s.name} className={`stage stage-${s.state}`}>
          <span className="stage-icon" aria-hidden="true">
            {ICON[s.state]}
          </span>
          <span className="stage-name">{LABEL[s.name]}</span>
          <span className="stage-state">
            {WORD[s.state]}
            {s.state === 'running' && s.progress
              ? ` · ${Math.min(s.progress.done, s.progress.total)}/${s.progress.total}`
              : ''}
            {s.state === 'done' && s.ms !== undefined ? ` · ${(s.ms / 1000).toFixed(1)}s` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}
