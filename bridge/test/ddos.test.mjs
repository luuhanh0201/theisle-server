// DDoS watch (ddos.ts): /proc/net/dev read, rates between readings, an attack
// told once after sustainSec and its end after a calm minute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { parseNetDev, defaultIface, DdosWatch, validateDdos, startText, endText, DDOS_DEFAULTS } = await import('../dist/ddos.js');

const NETDEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
  eth0: 5000000 40000 0 0 0 0 0 0 7000000 9000 0 0 0 0 0 0
`;
const ROUTE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
eth0\t00000000\t0102A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0
eth0\t0002A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
`;

test('reading the interface', () => {
  assert.deepEqual(parseNetDev(NETDEV, 'eth0'), { rxBytes: 5000000, rxPackets: 40000, txBytes: 7000000, txPackets: 9000 });
  assert.equal(parseNetDev(NETDEV, 'wlan0'), null);
  assert.equal(defaultIface(ROUTE), 'eth0');
  assert.equal(defaultIface('Iface\n'), null);
});

test('settings: defaults sane, ranges checked', () => {
  assert.deepEqual(validateDdos(DDOS_DEFAULTS), DDOS_DEFAULTS);
  assert.throws(() => validateDdos({ ...DDOS_DEFAULTS, pps: 10 }), /pps/);
  assert.throws(() => validateDdos({ ...DDOS_DEFAULTS, enabled: 'yes' }), /enabled/);
});

test('an attack: told once after sustainSec, peak kept, its end after a calm minute', () => {
  const w = new DdosWatch();
  const s = { enabled: true, pps: 20000, mbps: 50, sustainSec: 30 };
  let rxP = 0, rxB = 0, t = 1000;
  const step = (pps, mbps, online = 5) => { t += 5; rxP += pps * 5; rxB += (mbps * 1e6 / 8) * 5; return w.feed(t, { rxBytes: rxB, rxPackets: rxP, txBytes: 0, txPackets: 0 }, s, online); };
  w.feed(t, { rxBytes: 0, rxPackets: 0, txBytes: 0, txPackets: 0 }, s, 5);
  assert.deepEqual(step(40, 0.03), []);
  assert.equal(w.history.at(-1).pps, 40);
  for (let i = 0; i < 5; i++) assert.deepEqual(step(150000, 800, 5), [], 'not before 30 s');
  const ev = step(180000, 900, 2);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, 'start');
  assert.equal(ev[0].attack.since, 1005);
  assert.equal(ev[0].attack.onlineBefore, 5);
  assert.match(startText(ev[0], 2, 12), /Nghi bị DDoS.*180\.000 gói\/s · 900 Mbit\/s.*2 người online \(trước đó 5\) · FPS server 12/s);
  assert.deepEqual(step(210000, 950), [], 'told once');
  assert.equal(w.attack.peakPps, 210000);
  for (let i = 0; i < 12; i++) assert.deepEqual(step(40, 0.03), [], 'a calm minute first');
  const end = step(40, 0.03);
  assert.equal(end[0].kind, 'end');
  assert.match(endText(end[0]), /Hết lưu lượng bất thường\*\* sau 40 giây.*210\.000 gói\/s · 950 Mbit\/s/s);
  assert.equal(w.attack, null);
});

test('a short burst, off, or a counter reset: nothing told', () => {
  const w = new DdosWatch();
  const s = { enabled: true, pps: 20000, mbps: 50, sustainSec: 30 };
  let t = 0, p = 0;
  const feed = (pps, en = true) => { t += 5; p += pps * 5; return w.feed(t, { rxBytes: 0, rxPackets: p, txBytes: 0, txPackets: 0 }, { ...s, enabled: en }, 1); };
  feed(0);
  for (let i = 0; i < 3; i++) assert.deepEqual(feed(100000), []);
  assert.deepEqual(feed(10), [], 'dropped before 30 s: no alert');
  for (let i = 0; i < 10; i++) assert.deepEqual(feed(100000, false), [], 'off');
  assert.deepEqual(w.feed(t + 5, { rxBytes: 0, rxPackets: 1, txBytes: 0, txPackets: 0 }, s, 1), [], 'counters went back: skipped');
});
