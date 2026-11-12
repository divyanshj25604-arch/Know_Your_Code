import type { RepositorySource, StageInfo } from '@kyc/contracts';

const LABEL: Record<StageInfo['name'], string> = {
  fetching: 'Fetching the repository',
  filtering: 'Filtering files',
  analysing: 'Analysing code',
  summarising: 'Writing a summary',
};

/**
 * The work each real stage does, in the order it happens. A task is ticked only when its whole stage has finished:
 * the server reports stages, not tasks, so nothing is shown as complete before it is.
 */
const TASKS: Record<StageInfo['name'], string[]> = {
  fetching: ['Repository identified', 'Files retrieved'],
  filtering: [
    'Project structure extracted',
    'Programming languages detected',
    'Unsupported and secret files set aside',
  ],
  analysing: [
    'Functions and classes extracted',
    'Imports and dependencies resolved',
    'API routes identified',
    'Modules and application flows discovered',
  ],
  summarising: ['Project overview prepared'],
};

const DESC: Record<StageInfo['name'], string> = {
  fetching: 'Downloading the public repository from GitHub.',
  filtering: 'Setting aside binaries, dependencies, generated code and files that may hold secrets.',
  analysing: 'Reading the code statically to find functions, calls, imports, routes and concepts.',
  summarising: 'Writing a short summary of the project. The facts above it never depend on this.',
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

export function StageProgress({ stages, source }: { stages: StageInfo[]; source?: RepositorySource }) {
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
          <span className="stage-desc">
            {s.name === 'fetching' && source === 'upload' ? 'Unpacking the ZIP you uploaded.' : DESC[s.name]}
          </span>
          {s.state !== 'skipped' && (
            <ul className="stage-tasks" aria-label={`${LABEL[s.name]}: tasks`}>
              {TASKS[s.name].map((t) => (
                <li key={t} className={`stage-task task-${s.state === 'done' ? 'done' : s.state}`}>
                  <span aria-hidden="true">
                    {s.state === 'done' ? '✓' : s.state === 'running' ? '·' : '○'}
                  </span>{' '}
                  {t}
                  {s.state === 'done' && <span className="sr-only"> (done)</span>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
