export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
