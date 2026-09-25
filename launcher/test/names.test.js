// Every name the launcher's code uses exists (a missing helper crashes the
// main process — it happened: notifyOnce went missing in a rewrite and closing
// the window threw). TypeScript reads the JS; only "cannot find name" counts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

test('no undefined names in the main-process files', () => {
  const tsc = join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc');
  const files = ['main.js', 'overlay.js', 'ptt.js', 'login.js'].map((f) => join(__dirname, '..', 'src', f));
  const r = spawnSync(process.execPath, [tsc, '--allowJs', '--checkJs', '--noEmit', '--skipLibCheck', '--target', 'es2022',
    '--module', 'commonjs', '--moduleResolution', 'node', '--types', 'node', ...files], { encoding: 'utf8' });
  const missing = (r.stdout + r.stderr).split('\n').filter((l) => /error TS(2304|2552|2663)/.test(l));
  assert.deepEqual(missing, [], missing.join('\n'));
});
