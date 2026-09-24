// RCON client against a fake Evrima RCON server that follows the documented
// framing: 0x01+password -> "Password Accepted"; 0x02+opcode+args -> reply.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Rcon, RCON_COMMANDS, encodeArgs } from '../dist/rcon.js';

const received = [];
const server = createServer((sock) => {
  let authed = false;
  sock.on('data', (buf) => {
    if (!authed) {
      if (buf[0] === 0x01 && buf.subarray(1).toString() === 'secret') {
        authed = true;
        sock.write('Password Accepted');           // no terminator, like the real one
      } else {
        sock.write('Password Rejected');
      }
      return;
    }
    const opcode = buf[1];
    const args = buf.subarray(2).toString('utf8');
    received.push({ opcode, args });
    if (opcode === 0x40) sock.write('Alpha,765...01\nBravo,765...02\n\n');
    else if (opcode === 0x12) sock.write('ServerDetails: Gateway 3/100\n');
    else if (opcode === 0x14) { sock.write('Carnotaurus,Dilophosaurus'); } // no terminator at all
    // 0x10 Announce: says nothing
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
after(() => server.close());

const rcon = (password = 'secret') => new Rcon({ host: '127.0.0.1', port, password, idleMs: 80, timeoutMs: 2000 });

test('login, then a command with a \\n terminator', async () => {
  assert.equal(await rcon().run('serverDetails'), 'ServerDetails: Gateway 3/100');
});

test('GetPlayerList waits for \\n\\n and keeps every line', async () => {
  assert.equal(await rcon().run('getPlayerList'), 'Alpha,765...01\nBravo,765...02');
});

test('a reply with no terminator ends on silence', async () => {
  assert.equal(await rcon().run('getPlayables'), 'Carnotaurus,Dilophosaurus');
});

test('a command that never answers resolves empty, and the frame is right', async () => {
  received.length = 0;
  assert.equal(await rcon().run('announce', 'Restart in 5 minutes, sorry\n!'), '');
  assert.deepEqual(received, [{ opcode: 0x10, args: 'Restart in 5 minutes; sorry !' }],
    'commas and newlines never reach the wire');
});

test('commands are serialized, never interleaved', async () => {
  received.length = 0;
  const r = rcon();
  await Promise.all([r.run('save'), r.run('wipeCorpses'), r.run('toggleAi')]);
  assert.deepEqual(received.map((x) => x.opcode), [0x50, 0x13, 0x90]);
});

test('wrong password and disabled RCON are errors', async () => {
  await assert.rejects(() => rcon('nope').run('save'), /rejected the password/);
  await assert.rejects(() => rcon('').run('save'), /not configured/);
});

test('nothing listening is an error, not a hang', async () => {
  const dead = new Rcon({ host: '127.0.0.1', port: 1, password: 'x', idleMs: 50, timeoutMs: 1000 });
  await assert.rejects(() => dead.run('save'), /connection failed/);
});

test('argument validation', () => {
  assert.equal(encodeArgs('steamIds', '76561198000000001, 76561198000000002'), '76561198000000001,76561198000000002');
  assert.throws(() => encodeArgs('steamIds', '123'), /invalid value/);
  assert.throws(() => encodeArgs('className', 'Rex;DROP'), /letters/);
  assert.throws(() => encodeArgs('number', 500), /0–100/);
  assert.throws(() => encodeArgs('text', '   '), /required/);
  assert.equal(RCON_COMMANDS.pause, undefined, 'Pause is broken upstream and not exposed');
  assert.equal(RCON_COMMANDS.command, undefined, 'raw console commands are not exposed');
});

test('DirectMessage: opcode 0x11, "SteamID,message", commas neutralised', async () => {
  received.length = 0;
  await rcon().directMessage('76561198000000001', "Restored 'default', enjoy");
  assert.deepEqual(received.at(-1), { opcode: 0x11, args: "76561198000000001,Restored 'default'; enjoy" });
  await assert.rejects(() => rcon().directMessage('123', 'x'), /SteamID64/);
  await assert.rejects(() => rcon().directMessage('76561198000000001', '  '), /text required/);
});
