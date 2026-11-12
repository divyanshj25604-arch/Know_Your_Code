// Measures API responsiveness (GET /health latency) while a real repository is being imported and analysed.
//   node scripts/measure-blocking.mjs http://127.0.0.1:18081 https://github.com/sindresorhus/ky
const [base, repo] = process.argv.slice(2);
if (!base || !repo) {
  console.error('usage: node scripts/measure-blocking.mjs <baseUrl> <repoUrl>');
  process.exit(2);
}
const lat = [];
let stop = false;
const poll = (async () => {
  while (!stop) {
    const t = performance.now();
    await fetch(`${base}/api/v1/health`)
      .then((r) => r.text())
      .catch(() => undefined);
    lat.push(performance.now() - t);
    await new Promise((r) => setTimeout(r, 25));
  }
})();
const started = performance.now();
const res = await fetch(`${base}/api/v1/repositories`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: repo }),
});
const { snapshotId } = await res.json();
let status = 'queued';
while (!['ready', 'ready_partial', 'failed'].includes(status)) {
  await new Promise((r) => setTimeout(r, 200));
  status = (await (await fetch(`${base}/api/v1/snapshots/${snapshotId}`)).json()).status;
}
stop = true;
await poll;
const total = performance.now() - started;
lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(0);
console.log(
  `${repo}: ${status} in ${(total / 1000).toFixed(1)}s; /health during import: n=${lat.length} p50=${q(0.5)}ms p90=${q(0.9)}ms p99=${q(0.99)}ms max=${lat[lat.length - 1].toFixed(0)}ms`,
);
