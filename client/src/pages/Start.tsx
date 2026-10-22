import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { ErrorState } from '../components/ui';
import { RepoUrlInput } from '../components/RepoUrlInput';
import { AiStatusBanner, Header, useHealth } from '../components/Shell';
import { SAMPLE_REPOS } from '../lib/repoUrl';

export function Start() {
  const nav = useNavigate();
  const health = useHealth();
  const [params] = useSearchParams();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (u: string) => {
    setSubmitting(true);
    setError(null);
    try {
      void api.event('import_submitted');
      const r = await api.importRepo(u);
      nav(
        r.status === 'ready' || r.status === 'ready_partial'
          ? `/r/${r.snapshotId}`
          : `/r/${r.snapshotId}/processing`,
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError('SERVICE_UNAVAILABLE', 'Something went wrong.', true, 0),
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <Header />
      <AiStatusBanner health={health} />
      <main className="narrow">
        <h1 className="page-title">Open a repository</h1>
        <RepoUrlInput
          value={url}
          onChange={setUrl}
          onSubmit={(u) => void submit(u)}
          submitting={submitting}
          error={
            error && (
              <ErrorState
                code={error.code}
                message={error.message}
                {...(error.retryable ? { onAction: () => void submit(url.trim()) } : {})}
              />
            )
          }
        />
        <section aria-labelledby="samples" className="card">
          <h2 id="samples" className="panel-h">
            {params.get('sample') ? 'Pick a sample to start' : 'Or try a sample'}
          </h2>
          <ul className="plain-list samples">
            {SAMPLE_REPOS.map((s) => (
              <li key={s.url}>
                <button
                  type="button"
                  className="btn"
                  disabled={submitting}
                  onClick={() => {
                    setUrl(s.url);
                    void submit(s.url);
                  }}
                >
                  {s.label}
                </button>{' '}
                <span className="muted">{s.note}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="priv">
          <h2 id="priv" className="panel-h">
            Before you paste
          </h2>
          <ul className="plain-list">
            <li>Only public repositories can be opened.</li>
            <li>Your files are stored for 7 days or until you delete them.</li>
            <li>
              Short snippets of the code you select are sent to Anthropic (Claude) to write explanations.
              Secrets are removed first.
            </li>
            <li>We never run your code.</li>
          </ul>
        </section>
        <p>
          <Link to="/">← Back</Link>
        </p>
      </main>
    </div>
  );
}
