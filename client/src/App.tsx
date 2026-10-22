import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Header } from './components/Shell';
import { Landing } from './pages/Landing';
import { Processing } from './pages/Processing';
import { Start } from './pages/Start';
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

export function App() {
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/start" element={<Start />} />
        <Route path="/r/:id/processing" element={<Processing />} />
        <Route
          path="/r/:id"
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
    </BrowserRouter>
  );
}
