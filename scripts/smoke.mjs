#!/usr/bin/env node
// Post-deploy smoke test. Exercises a running instance end to end with a real import.
//   BASE_URL=https://your.app node scripts/smoke.mjs [--repo https://github.com/tj/commander.js] [--ai]
// Exit code 0 = every step passed. --ai additionally requests a real explanation (costs a few cents with Claude).
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const base = (process.env.BASE_URL ?? opt('--base', 'http://127.0.0.1:8080')).replace(/\/$/, '');
const repo = opt('--repo', 'https://github.com/tj/commander.js');

let cookie = '';
const steps = [];
const step = async (name, fn) => {
  const t = performance.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, ms: Math.round(performance.now() - t), detail });
    console.log(`PASS ${name} (${Math.round(performance.now() - t)} ms)${detail ? ` - ${detail}` : ''}`);
  } catch (e) {
    steps.push({ name, ok: false });
    console.log(`FAIL ${name}: ${e.message}`);
    await cleanup();
    process.exit(1);
  }
};
const req = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return res;
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

let repositoryId = null;
async function cleanup() {
  if (repositoryId) await req('DELETE', `/api/v1/repositories/${repositoryId}`).catch(() => undefined);
}

console.log(`Smoke test against ${base} (repo: ${repo})`);
let health;
await step('health', async () => {
  const r = await req('GET', '/api/v1/health');
  health = await r.json();
  must(r.status === 200, `status ${r.status}`);
  must(health.db === 'ok', 'database is not ok');
  return `status=${health.status} ai=${health.ai} github=${health.github} v${health.version}`;
});
await step('security headers', async () => {
  const r = await req('GET', '/api/v1/health');
  must(r.headers.get('content-security-policy')?.includes("script-src 'self'"), 'CSP missing');
  must(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
});
await step('serves the app', async () => {
  const r = await req('GET', '/');
  const html = await r.text();
  must(r.status === 200 && html.includes('<div id="root">'), 'SPA index not served');
  must((await req('GET', '/r/abc')).status === 200, 'SPA fallback route not served');
});
await step('rejects a bad URL', async () => {
  const r = await req('POST', '/api/v1/repositories', { url: 'https://evil.example/x/y' });
  must(r.status === 400, `expected 400, got ${r.status}`);
});
let snapshotId;
await step('import starts', async () => {
  const r = await req('POST', '/api/v1/repositories', { url: repo });
  const body = await r.json();
  must(r.status === 202, `expected 202, got ${r.status}: ${JSON.stringify(body)}`);
  ({ snapshotId, repositoryId } = body);
});
await step('import completes', async () => {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const s = await (await req('GET', `/api/v1/snapshots/${snapshotId}`)).json();
    if (s.status === 'ready' || s.status === 'ready_partial')
      return `${s.status}, ${s.stages.map((x) => `${x.name}:${x.ms ?? '-'}ms`).join(' ')}`;
    must(s.status !== 'failed', `failed: ${s.error?.code} ${s.error?.message}`);
    must(Date.now() < deadline, 'timed out after 180 s');
    await new Promise((r) => setTimeout(r, 1000));
  }
});
let candidates;
await step('overview and tree', async () => {
  const ov = await (await req('GET', `/api/v1/snapshots/${snapshotId}/overview`)).json();
  must(ov.facts.analysedCount > 0 && ov.facts.symbolCount > 0, 'nothing was analysed');
  const tree = await (await req('GET', `/api/v1/snapshots/${snapshotId}/tree`)).json();
  const walk = (n) => (n.type === 'file' ? [n] : (n.children ?? []).flatMap(walk));
  candidates = walk(tree.root).filter((f) => f.analysable && !/(^|\/)(test|tests|examples?)\//.test(f.path));
  must(candidates.length > 0, 'no analysable file');
  return `${ov.facts.analysedCount} files analysed, ${ov.facts.symbolCount} symbols`;
});
let symbol;
await step('file, selection and verified relations', async () => {
  // Find any function declaration in the first analysable files and select its name.
  for (const file of candidates.slice(0, 30)) {
    const f = await (
      await req('GET', `/api/v1/snapshots/${snapshotId}/file?path=${encodeURIComponent(file.path)}`)
    ).json();
    const lines = f.content.split('\n');
    const idx = lines.findIndex((l) => /^\s*(export\s+)?(async\s+)?function\s+\w+/.test(l));
    if (idx < 0) continue;
    const name = /function\s+(\w+)/.exec(lines[idx])[1];
    const start = lines[idx].indexOf(name, lines[idx].indexOf('function'));
    const sel = {
      path: file.path,
      startLine: idx + 1,
      startCol: start,
      endLine: idx + 1,
      endCol: start + name.length,
    };
    const r = await req('POST', `/api/v1/snapshots/${snapshotId}/resolve`, { selection: sel });
    const res = await r.json();
    must(r.status === 200 && res.symbol, `resolve failed: ${JSON.stringify(res)}`);
    symbol = { res, sel };
    const rel = await (await req('GET', `/api/v1/symbols/${res.symbol.id}/relations`)).json();
    return `${file.path}: ${res.kind} ${res.symbol.name}, ${rel.calledBy.length} callers, ${rel.calls.length} callees`;
  }
  throw new Error('no function declaration found in the first 30 analysable files');
});
if (flag('--ai')) {
  await step('explanation', async () => {
    const r = await req('POST', '/api/v1/explanations', {
      snapshotId,
      selection: symbol.sel,
      depth: 'default',
    });
    must(r.status === 200, `status ${r.status}`);
    const text = await r.text();
    must(text.includes('event: relations'), 'no relations event');
    must(
      !text.includes('event: error'),
      `error event: ${text.slice(text.indexOf('event: error'), text.indexOf('event: error') + 200)}`,
    );
    must(text.includes('event: section') && text.includes('event: done'), 'no explanation sections');
    return health.ai === 'configured'
      ? 'served by the configured AI provider'
      : `served by ${health.ai} (NOT the real model)`;
  });
}
await step('deletes data', async () => {
  const r = await req('DELETE', `/api/v1/repositories/${repositoryId}`);
  must(r.status === 202, `expected 202, got ${r.status}`);
  must(
    (await req('GET', `/api/v1/snapshots/${snapshotId}`)).status === 404,
    'snapshot still readable after delete',
  );
  repositoryId = null;
});
console.log(`\nSmoke test passed (${steps.length} steps).`);
