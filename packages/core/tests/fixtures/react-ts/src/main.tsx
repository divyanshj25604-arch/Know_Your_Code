import { createRoot } from 'react-dom/client';
import { Cart } from './components/Cart';

createRoot(document.getElementById('root')!).render(<Cart items={[]} />);
