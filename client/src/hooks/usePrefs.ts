import { useCallback, useEffect, useState } from 'react';
import type { Depth } from '@kyc/contracts';
import { readPref, writePref } from '../lib/storage';

export type Theme = 'system' | 'light' | 'dark';

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (readPref('kyc.theme') as Theme | null) ?? 'system');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  const cycle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system';
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
