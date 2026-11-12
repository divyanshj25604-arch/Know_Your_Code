import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isDesktop } from './desktop/bridge';
import './styles/tokens.css';
import './styles/base.css';

const root = createRoot(document.getElementById('root')!);
const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

if (isDesktop()) {
  // Desktop shell (P4.1): connect to the cloud API and sign in before the app renders. Loaded only inside Tauri.
  void Promise.all([import('./desktop/bridge'), import('./desktop/DesktopGate')]).then(
    async ([{ tauriBridge }, { DesktopGate }]) => {
      const bridge = await tauriBridge();
      render(
        <DesktopGate bridge={bridge}>
          <App />
        </DesktopGate>,
      );
    },
  );
} else {
  render(<App />);
}
