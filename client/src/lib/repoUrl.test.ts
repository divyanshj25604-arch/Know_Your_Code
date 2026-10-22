import { checkRepoUrl } from './repoUrl';

describe('checkRepoUrl (instant feedback only; the server validates again)', () => {
  it.each([
    'https://github.com/acme/app',
    'github.com/acme/app',
    'https://www.github.com/acme/app/tree/main',
  ])('accepts %s', (u) => {
    expect(checkRepoUrl(u)).toEqual({ ok: true });
  });
  it.each([
    ['', ''],
    ['not a url ::', 'Paste a link like https://github.com/user/project'],
    [
      'https://gitlab.com/acme/app',
      "That isn't a GitHub repository link. Paste a link like https://github.com/user/project",
    ],
    ['https://github.com/acme', 'Include the repository name: https://github.com/user/project'],
  ])('rejects %j with a hint', (u, hint) => {
    expect(checkRepoUrl(u)).toEqual({ ok: false, hint });
  });
});
