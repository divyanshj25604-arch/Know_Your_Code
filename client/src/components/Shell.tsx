import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { HealthView } from '@kyc/contracts';
import { api } from '../api/client';
import { useTheme } from '../hooks/usePrefs';
import { Banner } from './ui';

export function useHealth(): HealthView | null {
  const [h, setH] = useState<HealthView | null>(null);
  useEffect(() => {
    const c = new AbortController();
    api
      .health(c.signal)
      .then(setH)
      .catch(() => undefined);
    return () => c.abort();
  }, []);
  return h;
}

export function ThemeToggle() {
  const [theme, cycle] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={cycle}
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      title={`Switch to the ${next} theme`}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );
}

export function AiStatusBanner({ health }: { health: HealthView | null }) {
  if (!health) return null;
  if (health.ai === 'test_provider') {
    return (
      <Banner>
        Test mode: explanations come from a deterministic test provider, not from an AI model. Relations are
        real.
      </Banner>
    );
  }
  if (health.ai === 'not_configured') {
    return (
      <Banner>
        AI explanations aren't configured on this server. You can still browse code and see verified
        connections.
      </Banner>
    );
  }
  return null;
}

/**
 * The persistent top bar. The product name is set in text: the brand's logo files are not in the repository and must
 * not be redrawn (08 §D). `children` holds the workspace context (project switcher, modes).
 */
export function Header({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  return (
    <header className="topbar">
      <Link to="/" className="logo" aria-label="Know Your Code, home">
        Know Your Code
      </Link>
      <div className="topbar-mid">{children}</div>
      <div className="row top-end">
        {end}
        <ThemeToggle />
      </div>
    </header>
  );
}
