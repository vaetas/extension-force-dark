/* eslint-disable */
// Usage: bun scripts/e2e/run.mjs [local|all|<suite>[,<suite>]] [--grep=text]
//   local|all  every offline fixture suite (deterministic, no network)
// Env: HEADLESS=1, CHROME_PATH=…
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRunner, launch, startServer, SHOTS } from './harness.mjs';

const args = process.argv.slice(2);
const grep = args.find((a) => a.startsWith('--grep='))?.slice(7);
const selector = args.find((a) => !a.startsWith('--')) ?? 'local';

const dir = new URL('./suites/', import.meta.url);
const available = readdirSync(dir)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
  .map((f) => f.replace(/\.mjs$/, ''));

const wanted =
  selector === 'local' || selector === 'all' ? available : selector.split(',');
for (const s of wanted) {
  if (!available.includes(s)) {
    console.error(`unknown suite "${s}". available: ${available.join(', ')}`);
    process.exit(2);
  }
}

const server = await startServer();
const { browser, sw } = await launch();
const runner = createRunner({ browser, sw, server, grep, only: wanted });

for (const name of wanted) {
  const mod = await import(new URL(`${name}.mjs`, dir));
  mod.default({
    scenario: (title, fn, opts) => runner.scenario(`[${name}] ${title}`, fn, { ...opts, suite: `${name}` }),
    server,
    api: runner.api,
  });
}

let result;
try {
  result = await runner.run();
} finally {
  await browser.close().catch(() => {});
  server.close();
}

const { totals, failed, xpassed, known } = result;
console.log('\n' + '─'.repeat(60));
console.log(
  `pass ${totals.pass}  fail ${totals.fail}  known-gap ${totals.xfail}  fixed? ${totals.xpass}  skipped ${totals.skip}`,
);
if (known.length) {
  console.log('\nKnown gaps (expected failures — each is a documented extension limitation):');
  for (const k of known) console.log(`  • ${k.where}\n      ${k.reason}`);
}
if (xpassed.length) {
  console.log('\nKnown gaps that now PASS (remove the known() marker):');
  for (const x of xpassed) console.log(`  • ${x}`);
}
if (failed.length) {
  console.log('\nFAILED:');
  for (const f of failed) console.log(`  ✗ ${f}`);
}
mkdirSync(SHOTS, { recursive: true });
writeFileSync(`${SHOTS}/last-run.json`, JSON.stringify({ selector, grep, ...result }, null, 2));
process.exit(failed.length ? 1 : 0);
