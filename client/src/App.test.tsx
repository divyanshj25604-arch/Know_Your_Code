import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App routing', () => {
  beforeEach(() => {
    // The landing page asks the API for health and the user's repos; answer like the real API would.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/health')
          ? Response.json({
              status: 'ok',
              db: 'ok',
              ai: 'configured',
              github: 'token',
              queueDepth: 0,
              version: 't',
            })
          : Response.json({ snapshots: [] }),
      ),
    );
    window.history.pushState({}, '', '/');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the landing page with the product promise and a path to start', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Understand the code you build.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try with your repo' })).toHaveAttribute('href', '/start');
  });

  it('states what happens to the code on the landing page', async () => {
    render(<App />);
    expect(await screen.findByText(/Public repositories only/)).toBeInTheDocument();
    expect(screen.getByText(/never executed/)).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', async () => {
    window.history.pushState({}, '', '/nope');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
