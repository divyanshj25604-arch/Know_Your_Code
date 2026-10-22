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
  const label = theme === 'system' ? 'Theme: system' : theme === 'dark' ? 'Theme: dark' : 'Theme: light';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={cycle}
      aria-label={`${label}. Activate to change.`}
      title={label}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}</span>
    </button>
  );
}

export function AiStatusBanner({ health }: { health: HealthView | null }) {
  if (!health) return null;
  if (health.ai === 'test_provider') {
    return (
      <Banner>
        Test mode: explanations come from a deterministic test provider, not from Claude. Relations are real.
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

export function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <Link to="/" className="logo" aria-label="Know Your Code, home">
        <span aria-hidden="true">{'{ }'}</span> Know Your Code
      </Link>
      <div className="topbar-mid">{children}</div>
      <ThemeToggle />
    </header>
  );
}
