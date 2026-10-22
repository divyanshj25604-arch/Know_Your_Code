import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MySnapshot } from '../api/client';
import { AiStatusBanner, Header, useHealth } from '../components/Shell';

export function Landing() {
  const health = useHealth();
  const [mine, setMine] = useState<MySnapshot[]>([]);
  useEffect(() => {
    void api.event('landing_view');
    api
      .mySnapshots()
      .then((r) => setMine(r.snapshots))
      .catch(() => undefined);
  }, []);
  return (
    <div className="page">
      <Header />
      <AiStatusBanner health={health} />
      <main className="landing">
        <section className="hero">
          <h1>Understand the code you build.</h1>
          <p className="lede">
            Paste a public GitHub repository, select any line of your own JavaScript or TypeScript, and get a
            plain-language explanation. Every connection it shows is computed from your code and linked to the
            exact line.
          </p>
          <div className="row">
            <Link to="/start" className="btn btn-primary" onClick={() => void api.event('landing_cta')}>
              Try with your repo
            </Link>
            <Link to="/start?sample=1" className="btn">
              Try a sample
            </Link>
          </div>
          {mine.length > 0 && (
            <div className="continue" aria-label="Continue where you left off">
              <h2 className="panel-h">Continue</h2>
              <ul className="plain-list">
                {mine.map((m) => (
                  <li key={m.snapshotId}>
                    <Link to={`/r/${m.snapshotId}`}>
                      {m.repository.owner}/{m.repository.name}
                    </Link>{' '}
                    <span className="muted small">
                      (deleted {new Date(m.expiresAt).toLocaleDateString()})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-labelledby="how" className="how">
          <h2 id="how">How it works</h2>
          <ol className="steps-3">
            <li>
              <strong>Paste a link.</strong> We fetch the public repository and analyse it. Nothing is run.
            </li>
            <li>
              <strong>Select code.</strong> Pick a line, a function or a call. The connections show up first,
              computed from your code.
            </li>
            <li>
              <strong>Go as deep as you like.</strong> Simpler or deeper, follow a caller and come back, ask a
              question, or learn the concept using your own code.
            </li>
          </ol>
        </section>

        <section aria-labelledby="privacy" className="how">
          <h2 id="privacy">What happens to your code</h2>
          <ul className="plain-list">
            <li>Public repositories only. No sign-up.</li>
            <li>Stored for 7 days, or until you delete it. Imported code is never executed.</li>
            <li>
              Short snippets of what you select are sent to an AI provider (Anthropic's Claude) to write
              explanations. Secrets are removed first.
            </li>
            <li>We never write code for you. The goal is that you can explain it yourself.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
