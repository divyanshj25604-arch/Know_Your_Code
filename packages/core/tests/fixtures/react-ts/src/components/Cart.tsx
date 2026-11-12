import { useEffect, useState } from 'react';
import { Price } from './Price';
import { clamp } from '../lib/format';

export function Cart({ items }: { items: { id: number; cents: number }[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.title = `Cart (${items.length})`;
  }, [items.length]);

  const total = items.reduce((sum, item) => sum + item.cents, 0);
  const shown = clamp(items.length, 0, 99);

  return (
    <div>
      <button onClick={() => setOpen(!open)}>{shown} items</button>
      {open && <Price cents={total} />}
    </div>
  );
}

export class Counter {
  private n = 0;
  increment() {
    this.n += 1;
    return this.n;
  }
}
