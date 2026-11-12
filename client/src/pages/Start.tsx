import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { ErrorState, OnboardSteps, PageHeader } from '../components/ui';
import { RepoUrlInput } from '../components/RepoUrlInput';
import { ZipDrop } from '../components/ZipDrop';
import { AiStatusBanner, Header, useHealth } from '../components/Shell';
import { PrivacyFacts } from '../components/PrivacyFacts';
import { SAMPLE_REPOS } from '../lib/repoUrl';

export function Start() {
  const nav = useNavigate();
  const health = useHealth();
  const [params] = useSearchParams();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [via, setVia] = useState<'github' | 'zip' | null>(null);

  const submit = (u: string) => run('github', () => api.importRepo(u));
  const upload = (f: File) => run('zip', () => api.importZip(f, f.name));

  const run = async (kind: 'github' | 'zip', start: () => ReturnType<typeof api.importRepo>) => {
    if (submitting) return; // one import at a time: never send the same repository twice
    setSubmitting(true);
    setVia(kind);
    setError(null);
    try {
      void api.event('import_submitted');
      const r = await start();
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
  const errorFor = (kind: 'github' | 'zip') =>
    error && via === kind ? (
      <ErrorState
        code={error.code}
        message={error.message}
        {...(error.retryable
          ? { onAction: () => void (kind === 'zip' && zip ? upload(zip) : submit(url.trim())) }
          : {})}
      />
    ) : null;

  return (
    <div className="page">
      <Header />
      <AiStatusBanner health={health} />
      <main className="narrow onboard" id="main">
        <OnboardSteps current={1} />
        <PageHeader
          eyebrow="Get started"
          title="Bring your repository"
          lede="Link a public GitHub repository or upload a ZIP of your project. We map its structure, then you explore it."
        />
        <section className="import-split card" aria-label="Import a repository">
          <div className="import-half" aria-labelledby="imp-gh">
            <h2 id="imp-gh" className="card-h">
              From GitHub
            </h2>
            <RepoUrlInput
              value={url}
              onChange={setUrl}
              onSubmit={(u) => void submit(u)}
              submitting={submitting}
              busyLabel={via === 'github' ? 'Checking…' : undefined}
              error={errorFor('github')}
            />
            <details className="small">
              <summary>Is your repository private?</summary>
              <p className="muted">
                Private repositories can't be opened yet: we only read public code, and we never ask for a
                GitHub token. Upload a ZIP of the project instead. It is analysed the same way.
              </p>
            </details>
          </div>
          <div className="import-or" aria-hidden="true">
            <span>or</span>
          </div>
          <div className="import-half" aria-labelledby="imp-zip">
            <h2 id="imp-zip" className="card-h">
              From a ZIP file
            </h2>
            <ZipDrop
              file={zip}
              onFile={(f) => {
                setZip(f);
                if (via === 'zip') setError(null);
              }}
              onSubmit={(f) => void upload(f)}
              submitting={submitting}
              uploading={submitting && via === 'zip'}
              error={errorFor('zip')}
            />
          </div>
        </section>
        <section aria-labelledby="samples" className="section">
          <h2 id="samples" className="section-h">
            {params.get('sample') ? 'Pick a sample to start' : 'Or try a sample'}
          </h2>
          <p className="section-lede">Well-known open-source projects, if you want to look around first.</p>
          <ul className="sample-list">
            {SAMPLE_REPOS.map((s) => (
              <li key={s.url}>
                <button
                  type="button"
                  className="sample"
                  disabled={submitting}
                  onClick={() => {
                    setUrl(s.url);
                    void submit(s.url);
                  }}
                >
                  <strong>{s.label}</strong>
                  <span>{s.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="next" className="section">
          <h2 id="next" className="section-h">
            What happens next
          </h2>
          <ol className="plain-list">
            <li>
              We fetch the repository (or unpack your ZIP) and set aside files we can't or shouldn't read.
            </li>
            <li>
              We analyse the JavaScript and TypeScript statically: functions, calls, imports, Express routes
              and concepts. Nothing is run.
            </li>
            <li>
              You get a project overview and, where the code supports them, learning paths and a guided tour.
            </li>
          </ol>
        </section>
        <section className="card" aria-labelledby="priv">
          <h2 id="priv" className="card-h">
            Before you import
          </h2>
          <PrivacyFacts
            health={health}
            lead={['Only public GitHub repositories, or a ZIP you upload, can be opened.']}
          />
        </section>
        <p>
          <Link to="/">← Back</Link>
        </p>
      </main>
    </div>
  );
}
