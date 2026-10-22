/** Client-side format check while typing (the server validates again; this only gives instant feedback). */
export function checkRepoUrl(input: string): { ok: true } | { ok: false; hint: string } {
  const v = input.trim();
  if (!v) return { ok: false, hint: '' };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
  } catch {
    return { ok: false, hint: 'Paste a link like https://github.com/user/project' };
  }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') {
    return {
      ok: false,
      hint: "That isn't a GitHub repository link. Paste a link like https://github.com/user/project",
    };
  }
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 2)
    return { ok: false, hint: 'Include the repository name: https://github.com/user/project' };
  return { ok: true };
}

export const SAMPLE_REPOS: { label: string; url: string; note: string }[] = [
  {
    label: 'Express',
    url: 'https://github.com/expressjs/express',
    note: 'Node web framework (JavaScript, MIT)',
  },
  { label: 'Commander.js', url: 'https://github.com/tj/commander.js', note: 'CLI library (JavaScript, MIT)' },
  { label: 'ky', url: 'https://github.com/sindresorhus/ky', note: 'HTTP client (TypeScript, MIT)' },
];
