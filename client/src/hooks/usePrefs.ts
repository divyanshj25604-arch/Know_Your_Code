import { useCallback, useEffect, useState } from 'react';
import type { Depth } from '@kyc/contracts';
import { readPref, writePref } from '../lib/storage';

export type Theme = 'light' | 'dark';

/** Dark-first (brand kit): dark unless the user chose light. An older stored "system" value reads as dark. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (readPref('kyc.theme') === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }, [theme]);
  const cycle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      writePref('kyc.theme', next);
      return next;
    });
  }, []);
  return [theme, cycle];
}

/** Depth is remembered per browser (docs/06 §G). */
export function useDepth(): [Depth, (d: Depth) => void] {
  const [depth, setDepth] = useState<Depth>(() => {
    const v = readPref('kyc.depth');
    return v === 'simpler' || v === 'deeper' ? v : 'default';
  });
  const set = useCallback((d: Depth) => {
    setDepth(d);
    writePref('kyc.depth', d);
  }, []);
  return [depth, set];
}
