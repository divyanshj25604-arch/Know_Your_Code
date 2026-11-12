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
      <main className="narrow">
        <h1 className="page-title">Page not found</h1>
        <p>
          <Link to="/">Go home</Link>
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
      <a className="skip-link" href="#main">
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
                <p className="muted" style={{ padding: 16 }}>
                  Loading…
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
