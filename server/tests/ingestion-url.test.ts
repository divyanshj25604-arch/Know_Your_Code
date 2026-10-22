import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from '../src/ingestion/url';

describe('parseRepoUrl', () => {
  it.each([
    ['https://github.com/acme/notes-app', { owner: 'acme', name: 'notes-app' }],
    ['https://www.github.com/acme/notes.app/', { owner: 'acme', name: 'notes.app' }],
    ['http://github.com/acme/notes-app', { owner: 'acme', name: 'notes-app' }],
    ['github.com/acme/notes-app', { owner: 'acme', name: 'notes-app' }],
    ['https://github.com/acme/notes-app.git', { owner: 'acme', name: 'notes-app' }],
    ['https://github.com/acme/notes-app/tree/main', { owner: 'acme', name: 'notes-app', ref: 'main' }],
    [
      'https://github.com/acme/notes-app/tree/feature/login-fix',
      { owner: 'acme', name: 'notes-app', ref: 'feature/login-fix' },
    ],
  ])('accepts %s', (url, expected) => {
    expect(parseRepoUrl(url)).toEqual(expected);
  });

  it('lets an explicit ref override the URL ref', () => {
    expect(parseRepoUrl('https://github.com/a/b/tree/main', 'v1.0.0').ref).toBe('v1.0.0');
  });

  it.each([
    '',
    'not a url',
    'https://gitlab.com/acme/app',
    'https://github.com.evil.com/acme/app',
    'https://evil.com/github.com/acme/app',
    'https://github.com@evil.com/acme/app',
    'https://user:pass@github.com/acme/app',
    'https://github.com:8443/acme/app',
    'https://github.com/acme',
    'https://github.com/acme/app/blob/main/x.js',
    'https://github.com/acme/app/tree',
    'https://github.com/acme/app?tab=readme',
    'https://github.com/acme/app#readme',
    'file:///etc/passwd',
    'ftp://github.com/acme/app',
    'javascript:alert(1)',
    'https://localhost/acme/app',
    'https://127.0.0.1/acme/app',
    'https://169.254.169.254/latest/meta-data',
    'https://github.com/-bad/app',
    'https://github.com/acme/..',
    'https://github.com/acme/app/tree/a//b',
    'https://github.com/acme/app%2f..%2f',
    'https://github.com/acme/app\nHost: evil',
    `https://github.com/${'a'.repeat(50)}/app`,
  ])('rejects %j', (url) => {
    expect(() => parseRepoUrl(url)).toThrowError(expect.objectContaining({ code: 'INVALID_URL' }));
  });

  it('treats dot-segments as WHATWG does (normalised before validation), so they cannot smuggle a traversal', () => {
    expect(parseRepoUrl('https://github.com/acme/app/tree/../../etc')).toEqual({
      owner: 'acme',
      name: 'etc',
    });
  });

  it('rejects an unsafe ref override', () => {
    expect(() => parseRepoUrl('https://github.com/a/b', '../x')).toThrow();
    expect(() => parseRepoUrl('https://github.com/a/b', '-flag')).toThrow();
  });
});
