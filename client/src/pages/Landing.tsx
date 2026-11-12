import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MySnapshot } from '../api/client';
import { AiStatusBanner, Header, useHealth } from '../components/Shell';
import { PrivacyFacts } from '../components/PrivacyFacts';
import { repoName } from '../lib/repoName';

const MODES: { name: string; text: string }[] = [
  {
    name: 'Project',
    text: 'See what the repository is: its stack, an architecture map, request flows and where to start.',
  },
  {
    name: 'Learn',
    text: 'Follow learning paths and a guided tour built from your code, one lesson at a time.',
  },
  {
    name: 'Explore',
    text: 'Code, graph and explanation side by side: select a node or a line and see how it connects.',
  },
  {
    name: 'Validate',
    text: 'Answer questions about your code and get feedback that points to the lines that matter.',
  },
];

/**
 * The front door. Returning users see their repositories first (Journey B); first-time users get the product in one
 * screen: what it is, the four modes, and what happens to their code (Journey A).
 */
export function Landing() {
  const health = useHealth();
  const [mine, setMine] = useState<MySnapshot[]>([]);
  useEffect(() => {
    api
      .mySnapshots()
      .then((r) => setMine(r.snapshots))
      .catch(() => undefined);
  }, []);
  return (
    <div className="page">
      <Header />
      <AiStatusBanner health={health} />
      <main className="page-main" id="main">
        <section className="hero hero-split" aria-labelledby="hero-h">
          <div>
            <span className="eyebrow">KnowYourCode</span>
            <h1 id="hero-h">Understand the code you ship.</h1>
            <p className="supporting">Your repository becomes your textbook.</p>
            <p className="lede">
              Bring a GitHub repository or a ZIP. We'll map your project, show how its parts connect, and help
              you understand the code behind it, citing the exact file and line.
            </p>
            <div className="row hero-actions">
              <Link
                to="/start"
                className="btn btn-primary btn-large"
                onClick={() => void api.event('landing_cta')}
              >
                Try with your own repo
              </Link>
              <Link to="/start?sample=1" className="btn btn-large">
                Try a sample
              </Link>
            </div>
          </div>
          <figure className="hero-preview" aria-label="Example of an explanation">
            <figcaption className="eyebrow">Example</figcaption>
            <pre className="preview-code" aria-hidden="true">
              <span className="pl">
                <span className="ln">11</span>export async function login(req, res) {'{'}
              </span>
              <span className="pl pl-on">
                <span className="ln">12</span> const user = await findUserByEmail(req.body.email);
              </span>
              <span className="pl">
                <span className="ln">13</span> if (!user) return res.status(401).end();
              </span>
            </pre>
            <div className="preview-expl">
              <p className="row">
                <strong>What this line does</strong>
                <span className="tag tag-verified">
                  <span aria-hidden="true">✓</span> Verified
                </span>
              </p>
              <p className="small">
                Looks up the account for the email in the request before checking the password.
              </p>
              <p className="small">
                Calls <span className="path">findUserByEmail</span>, defined in{' '}
                <span className="path">src/services/userService.js:4</span>
              </p>
            </div>
          </figure>
        </section>

        {mine.length > 0 && (
          <section className="section" aria-labelledby="continue-h">
            <h2 id="continue-h" className="section-h">
              Continue where you left off
            </h2>
            <ul className="project-list">
              {mine.map((m) => (
                <li key={m.snapshotId} className="project-row">
                  <span className="repo">{repoName(m.repository)}</span>
                  <span className="muted small">
                    Stored until {new Date(m.expiresAt).toLocaleDateString()}
                  </span>
                  <Link to={`/r/${m.snapshotId}/project`} className="btn btn-small">
                    Open <span className="sr-only">{repoName(m.repository)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="section" aria-labelledby="how">
          <h2 id="how" className="section-h">
            How it works
          </h2>
          <p className="section-lede">
            We analyse the repository once. Nothing in it is run. Then you move between four modes, and your
            place in each is saved.
          </p>
          <ol className="grid-4 bare-list">
            {MODES.map((m, i) => (
              <li key={m.name} className="mode-card">
                <span className="eyebrow">{String(i + 1).padStart(2, '0')}</span>
                <h3>{m.name}</h3>
                <p>{m.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" aria-labelledby="privacy">
          <h2 id="privacy" className="section-h">
            What happens to your code
          </h2>
          <div className="card">
            <PrivacyFacts
              health={health}
              lead={['Public GitHub repositories or a ZIP you upload. No sign-up.']}
            />
            <p>We never write code for you. The goal is that you can explain it yourself.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
