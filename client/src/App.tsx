import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Link, Route, Routes } from 'react-router-dom';
import { Header } from './components/Shell';
import { Landing } from './pages/Landing';
import { Processing } from './pages/Processing';
import { Start } from './pages/Start';
import { isDesktop } from './desktop/bridge';
// The workspace pulls in the code editor; load it only when a repository is opened.
const Workspace = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.Workspace })));

function NotFound() {
  return (
    <div className="page">
      <Header />
      <main className="narrow" id="main">
        <h1 className="page-title">Page not found</h1>
        <p className="lede">
          This link doesn't point to anything here. It may be mistyped, or the page has moved.
        </p>
        <p className="row">
          <Link to="/" className="btn">
            Go home
          </Link>
          <Link to="/start" className="btn">
            Open a repository
          </Link>
        </p>
      </main>
    </div>
  );
}

/**
 * Desktop-safe routing (P2.2): a desktop shell serves the app from a custom origin or the file system, where path
 * routes break on reload, so it uses hash routes. The web build keeps clean paths. VITE_ROUTER=hash forces hash routes.
 */
const useHashRoutes =
  import.meta.env.VITE_ROUTER === 'hash' ||
  isDesktop() ||
  (typeof window !== 'undefined' && !/^https?:$/.test(window.location.protocol));
const Router = useHashRoutes ? HashRouter : BrowserRouter;

export function App() {
  return (
    <Router>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // Hash routes must not be replaced by the fragment: move focus instead of following the link.
          e.preventDefault();
          const main = document.getElementById('main');
          main?.setAttribute('tabindex', '-1');
          main?.focus();
        }}
      >
        Skip to content
      </a>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/start" element={<Start />} />
        <Route path="/r/:id/processing" element={<Processing />} />
        <Route
          path="/r/:id/:mode?"
          element={
            <Suspense
              fallback={
                <p className="muted" role="status" style={{ padding: 16 }}>
                  Opening the workspace…
                </p>
              }
            >
              <Workspace />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}
