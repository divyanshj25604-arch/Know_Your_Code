import { formatPrice } from '@/lib/format';

interface Props {
  cents: number;
}

export function Price({ cents }: Props) {
  return <span className="price">{formatPrice(cents)}</span>;
}
