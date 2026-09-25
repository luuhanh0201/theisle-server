// "Làm mới AI" (ai-reset.ts) with a virtual clock: warn, the mod kills, the
// game clears the corpses, done; cancel in the countdown; a silent mod.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'ai-reset-test-'));
process.env.DATA_DIR = root;
const { AiReset, validateReset } = await import('../dist/ai-reset.js');
after(() => rmSync(root, { recursive: true, force: true }));

function rig({ answer = { ok: true, made: 42 }, answerAfterPolls = 2, blockSleep = false } = {}) {
  let t = 0;
  const said = [];
  const queued = [];
  const kept = [];
  let polls = 0;
  const rcon = { enabled: true, run: async (name, args) => { said.push(args === undefined ? name : `${name}: ${args}`); return ''; } };
  const reset = new AiReset({
    rcon,
    enqueue: async (classes, keep) => { queued.push(classes); kept.push(keep); return { id: 7 }; },
    zoneClasses: async () => ['BP_Boar_C', 'BP_Deer_C'],
    result: async (id) => (++polls >= answerAfterPolls ? { id, ...answer } : null),
    now: () => t,
    sleep: (ms, signal) => new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('cancelled'));
      if (blockSleep) { signal.addEventListener('abort', () => reject(new Error('cancelled'))); return; }
      t += Math.max(0, ms);
      resolve();
    }),
    answerTimeoutMs: 20_000,
  });
  return { reset, said, queued, kept };
}

test('validation: a countdown 0–600 s, known kinds, corpses cleared unless said no', () => {
  assert.deepEqual(validateReset({ countdownSec: 60 }), { countdownSec: 60, species: [], wipeCorpses: true, keepZoneSpecies: false });
  assert.deepEqual(validateReset({ countdownSec: 0, species: ['Rabbit', 'Rabbit'], wipeCorpses: false }), { countdownSec: 0, species: ['Rabbit'], wipeCorpses: false, keepZoneSpecies: false });
  assert.equal(validateReset({ countdownSec: 0, keepZoneSpecies: true }).keepZoneSpecies, true);
  assert.throws(() => validateReset({ countdownSec: 601 }), /countdownSec/);
  assert.throws(() => validateReset({ countdownSec: 0, species: ['Dragon'] }), /unknown AI/);
});

test('warned at the start and 10 s before; the mod kills; corpses cleared; done said with the count', async () => {
  const r = rig();
  const { op, done } = r.reset.request({ countdownSec: 60, species: ['Rabbit'], wipeCorpses: true });
  assert.equal(op.step, 'countdown');
  assert.throws(() => r.reset.request({ countdownSec: 0, species: [], wipeCorpses: true }), /already running/);
  await done;
  assert.deepEqual(r.queued, [['BP_Rabbit_C']], 'the chosen kind, as its class');
  assert.deepEqual(r.said, [
    'announce: AI sẽ được làm mới sau 1 phút / AI reset in 1 min.',
    'announce: AI sẽ được làm mới sau 10 giây / AI reset in 10 s.',
    'wipeCorpses',
    'announce: Đã làm mới AI (42 con) / AI has been reset.',
  ]);
  assert.equal(r.reset.status().last.step, 'done');
  assert.equal(r.reset.status().last.killed, 42);
  assert.equal(r.reset.status().current, null);
});

test('no countdown, no corpse wipe: straight to the mod, then done', async () => {
  const r = rig();
  await r.reset.request({ countdownSec: 0, species: [], wipeCorpses: false }).done;
  assert.deepEqual(r.queued, [[]], 'every AI');
  assert.deepEqual(r.said, ['announce: Đã làm mới AI (42 con) / AI has been reset.']);
});

test('keep the zones\' species: every other AI is killed, theirs spared', async () => {
  const r = rig();
  await r.reset.request({ countdownSec: 0, species: [], wipeCorpses: false, keepZoneSpecies: true }).done;
  assert.deepEqual(r.queued, [[]], 'every kind…');
  assert.deepEqual(r.kept, [['BP_Boar_C', 'BP_Deer_C']], '…but the zones\' boars and deer');
  const plain = rig();
  await plain.reset.request({ countdownSec: 0, species: [], wipeCorpses: false }).done;
  assert.deepEqual(plain.kept, [[]], 'a plain reset spares nothing');
});

test('cancelled in the countdown: players told, the mod never asked', async () => {
  const r = rig({ blockSleep: true });
  const { done } = r.reset.request({ countdownSec: 120, species: [], wipeCorpses: true });
  await new Promise((res) => setImmediate(res));
  assert.equal(r.reset.cancel(), true);
  await done;
  assert.deepEqual(r.queued, []);
  assert.equal(r.said.at(-1), 'announce: Đã huỷ làm mới AI / AI reset cancelled.');
  assert.equal(r.reset.status().last.step, 'cancelled');
  assert.equal(r.reset.cancel(), false, 'nothing left to cancel');
});

test('a mod that does not answer: failed, with the reason, nothing wiped', async () => {
  const r = rig({ answerAfterPolls: 1e9 });
  await r.reset.request({ countdownSec: 0, species: [], wipeCorpses: true }).done;
  const last = r.reset.status().last;
  assert.equal(last.step, 'failed');
  assert.match(last.message, /did not answer/);
  assert.ok(!r.said.includes('wipeCorpses'));
});
