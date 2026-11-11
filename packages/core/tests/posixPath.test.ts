import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dirname, join, normalize } from '../src/util/posixPath';

const SAMPLES = [
  '',
  '.',
  '..',
  '/',
  '//',
  'a',
  'a/',
  '/a',
  'a/b',
  'a/b/',
  './a',
  '../a',
  'a/../..',
  'a/./b/../c',
  '/a/../../b',
  'src/controllers/authController.js',
  'a//b///c',
  '.hidden/x',
  'a/b/.././../c/',
];

describe('posixPath (behaves exactly like node:path.posix)', () => {
  it.each(SAMPLES)('dirname(%j)', (p) => expect(dirname(p)).toBe(path.posix.dirname(p)));
  it.each(SAMPLES)('normalize(%j)', (p) => expect(normalize(p)).toBe(path.posix.normalize(p)));

  it.each([
    ['src/controllers', '../services/userService'],
    ['.', './auth'],
    ['', './x'],
    ['a/b', '../../../c'],
    ['src', './lib/'],
    ['src', '.'],
    ['/abs', '../x'],
  ])('join(%j, %j)', (a, b) => expect(join(a, b)).toBe(path.posix.normalize(path.posix.join(a, b))));

  it('matches Node on 5,000 random relative and absolute paths', () => {
    const parts = ['a', 'bb', '.', '..', '', 'x.js', 'idx'];
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 5000; i++) {
      const segs = Array.from({ length: 1 + rnd(6) }, () => parts[rnd(parts.length)]!);
      const p = (rnd(4) === 0 ? '/' : '') + segs.join('/') + (rnd(5) === 0 ? '/' : '');
      const q = segs.slice(0, rnd(3)).join('/');
      expect(dirname(p)).toBe(path.posix.dirname(p));
      expect(normalize(p)).toBe(path.posix.normalize(p));
      expect(join(q, p)).toBe(path.posix.normalize(path.posix.join(q, p)));
    }
  });
});
