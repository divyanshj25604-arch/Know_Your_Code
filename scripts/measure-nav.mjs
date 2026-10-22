// Measures navigation endpoints (DB-only reads) under concurrency against a running server, after a real import.
//   node scripts/measure-nav.mjs http://127.0.0.1:18081 https://github.com/expressjs/express [concurrency=20] [seconds=10]
const [base, repo, conc = '20', secs = '10'] = process.argv.slice(2);
if (!base || !repo) {
  console.error('usage: node scripts/measure-nav.mjs <baseUrl> <repoUrl> [concurrency] [seconds]');
  process.exit(2);
}
const j = async (path, init) => {
  const r = await fetch(base + path, init);
  return { r, body: await r.json().catch(() => null) };
};
const imp = await j('/api/v1/repositories', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: repo }),
});
const id = imp.body.snapshotId;
for (;;) {
  const s = (await j(`/api/v1/snapshots/${id}`)).body;
  if (['ready', 'ready_partial'].includes(s.status)) break;
  if (s.status === 'failed') throw new Error('import failed');
  await new Promise((r) => setTimeout(r, 300));
}
const tree = (await j(`/api/v1/snapshots/${id}/tree`)).body.root;
const walk = (n) => (n.type === 'file' ? [n] : (n.children ?? []).flatMap(walk));
const files = walk(tree)
  .filter((f) => f.analysable)
  .slice(0, 40);
// Collect symbols to ask relations for.
const symbols = [];
for (const f of files.slice(0, 15)) {
  const file = (await j(`/api/v1/snapshots/${id}/file?path=${encodeURIComponent(f.path)}`)).body;
  const lines = file.content.split('\n');
  const i = lines.findIndex((l) => /function\s+\w+/.test(l));
  if (i < 0) continue;
  const name = /function\s+(\w+)/.exec(lines[i])[1];
  const col = lines[i].indexOf(name, lines[i].indexOf('function'));
  const r = await j(`/api/v1/snapshots/${id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      selection: { path: f.path, startLine: i + 1, startCol: col, endLine: i + 1, endCol: col + name.length },
    }),
  });
  if (r.body?.symbol) symbols.push(r.body.symbol.id);
}
const ops = [
  ...files.map((f) => ['file', () => j(`/api/v1/snapshots/${id}/file?path=${encodeURIComponent(f.path)}`)]),
  ...symbols.map((s) => ['relations', () => j(`/api/v1/symbols/${s}/relations`)]),
  ['tree', () => j(`/api/v1/snapshots/${id}/tree`)],
  ['overview', () => j(`/api/v1/snapshots/${id}/overview`)],
];
const lat = {};
let errors = 0;
const end = Date.now() + Number(secs) * 1000;
await Promise.all(
  Array.from({ length: Number(conc) }, async () => {
    while (Date.now() < end) {
      const [name, fn] = ops[Math.floor(Math.random() * ops.length)];
      const t = performance.now();
      const { r } = await fn();
      (lat[name] ??= []).push(performance.now() - t);
      if (!r.ok) errors++;
    }
  }),
);
const all = Object.values(lat)
  .flat()
  .sort((a, b) => a - b);
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1);
console.log(
  `${repo}: ${conc} concurrent clients, ${secs}s, ${all.length} requests (${(all.length / Number(secs)).toFixed(0)} req/s), errors=${errors}`,
);
for (const [name, a] of Object.entries(lat)) {
  a.sort((x, y) => x - y);
  console.log(
    `  ${name.padEnd(10)} n=${String(a.length).padStart(5)}  p50=${q(a, 0.5)}ms  p90=${q(a, 0.9)}ms  p99=${q(a, 0.99)}ms`,
  );
}
console.log(`  ALL        p50=${q(all, 0.5)}ms  p90=${q(all, 0.9)}ms  p99=${q(all, 0.99)}ms`);
await fetch(`${base}/api/v1/repositories/${imp.body.repositoryId}`, { method: 'DELETE' }).catch(
  () => undefined,
);
