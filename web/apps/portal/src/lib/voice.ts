import { useSyncExternalStore } from 'react';
import { setVoiceDot } from './voiceDot';

/*
 * Proximity voice (voice.js before React), for the whole visit: the room stays joined whatever page is
 * shown. The audio goes through our LiveKit server; who you hear, how loud and from which side comes
 * from /api/voice, which the bridge works out from the game's live positions every second:
 *   - you subscribe only to the voice users whose voice reaches you;
 *   - your microphone may only be subscribed by those inside YOUR range (setTrackSubscriptionPermissions),
 *     so nobody far away can listen in;
 *   - out of the game: nobody is listed, you hear no one and no one hears you.
 * In Xóm Gáy Launcher (window.isleLauncher) the talk key and the range key are global: they work while
 * The Isle has the focus. The page (pages/voice) draws `useVoice()` and calls the actions below.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- LiveKit's UMD build (/vendor) has no types here. */
type LK = any;

const LK_SRC = '/vendor/livekit-client-2.22.3.umd.js';
const NS_DIR = '/vendor/noise-suppressor-0.4.1';
export const RANGES = [15, 30, 60, 90] as const;
export const RANGE_NAMES: Record<number, string> = { 15: 'Thì thầm', 30: 'Nói thường', 60: 'Nói to', 90: 'Hét' };
const POLL_MS = 500;
const HANGOVER_MS = 450;            // keep sending this long after the voice drops under the line
const RECENT_MS = 15_000;           // a speaker stays in the list this long after they stop

export type Mode = 'vad' | 'ptt' | 'off';
export type Noise = 'off' | 'browser' | 'ai';
export interface Settings {
  mode: Mode; threshold: number; pttCode: string; rangeCode: string; master: number; mic: string; out: string;
  people: Record<string, { vol: number; muted: boolean }>; range: number; noise: Noise;
}
export interface Peer { id: string; name?: string | null; gain: number; pan: number }
export interface PeerView extends Peer { speaking: boolean; vol: number; muted: boolean }
export interface Device { id: string; label: string }

/** The voice launcher calls (launcher/src/preload.js); each may be missing on an older launcher. */
interface VoiceLauncher {
  pttLabel?: () => string; rangeLabel?: () => string;
  capturePttKey?: () => Promise<{ error?: string } | null>; captureRangeKey?: () => Promise<{ error?: string } | null>;
  onPushToTalk?: (cb: (held: boolean) => void) => void; onRangeKey?: (cb: () => void) => void;
  overlayState?: (s: unknown) => void;
}
const launcher = (): VoiceLauncher | null => (window.isleLauncher as VoiceLauncher | undefined) ?? null;

// --- settings (per browser, the same key as before React; everything works without storage) ---------------
function loadSettings(): Settings {
  const defaults: Settings = {
    mode: launcher() ? 'ptt' : 'vad', threshold: -50, pttCode: 'KeyV', rangeCode: 'Backquote',
    master: 100, mic: '', out: '', people: {}, range: 30, noise: 'ai',
  };
  let s = { ...defaults };
  try { s = { ...defaults, ...JSON.parse(localStorage.getItem('isle-voice') || '{}') as Partial<Settings> }; } catch { /* private window */ }
  if (!(RANGES as readonly number[]).includes(s.range)) s.range = 30;
  if (!['off', 'browser', 'ai'].includes(s.noise)) s.noise = 'ai';
  return s;
}

/** What the page draws (rebuilt on each change). */
export interface VoiceView {
  /** null: not read yet (or /api/me failed); false: not logged in. */
  loggedIn: boolean | null;
  connected: boolean; joining: boolean;
  conn: { kind: '' | 'good' | 'warn' | 'bad'; text: string };
  joinNote: string; rangeNote: string; noiseNote: string;
  inGame: boolean | null; nameMode: 'name' | 'id' | 'none';
  peers: PeerView[];
  settings: Settings; noiseActive: Noise | null;
  capturing: 'ptt' | 'range' | null; captureError: { which: 'ptt' | 'range'; text: string } | null;
  sending: boolean;
  mics: Device[]; outs: Device[]; outField: boolean; micNow: string;
  test: { on: boolean; busy: boolean; note: string };
  toast: string | null;
}

let LKC: LK = null;
let room: LK = null;
let audioCtx: AudioContext | null = null;
let identity: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let meterTimer: ReturnType<typeof setInterval> | null = null;
let analyserSrc: MediaStreamAudioSourceNode | null = null;
let micClone: MediaStreamTrack | null = null;
let inGame: boolean | null = null;
let nameMode: 'name' | 'id' | 'none' = 'name';
let peers = new Map<string, Peer>();
let audience: string[] = [];
let allowed = '';
let lost = false;
const panners = new Map<string, StereoPannerNode>();
const lastSpoke = new Map<string, number>();
let pttHeld = false;
let externalPtt = false;
let sending = false;
let lastLoud = 0;
let capturing: 'ptt' | 'range' | null = null;
let captureError: VoiceView['captureError'] = null;
let reconnecting = false;
let lastToast: { text: string; at: number } | null = null;
let noiseActive: Noise | null = null;
let settings: Settings = { mode: 'vad', threshold: -50, pttCode: 'KeyV', rangeCode: 'Backquote', master: 100, mic: '', out: '', people: {}, range: 30, noise: 'ai' };
let loggedIn: boolean | null = null;
let joining = false;
/** In the channel: the settings, range and speakers cards show (set once a join fully worked). */
let joined = false;
let conn: VoiceView['conn'] = { kind: '', text: '○ Chưa vào kênh' };
let joinNote = 'Cần quyền dùng micro. Voice tiếp tục chạy khi bạn chuyển sang các tab khác.';
let rangeNote = 'Càng gần bạn càng nghe to; ra tới mép tầm thì nhỏ dần rồi tắt.';
let mics: Device[] = [];
let outs: Device[] = [];
let outField = true;
let toastText: string | null = null;
let hearing: { stream: MediaStream; ctx: AudioContext } | null = null;
let test = { on: false, busy: false, note: 'Bật rồi nói: nghe lại giọng mình ngay qua loa / tai nghe. Nên dùng tai nghe.' };

const save = (): void => { try { localStorage.setItem('isle-voice', JSON.stringify(settings)); } catch { /* ignore */ } };
const person = (id: string): { vol: number; muted: boolean } => settings.people[id] || { vol: 100, muted: false };

// --- the store the page reads ---------------------------------------------------------------
const subs = new Set<() => void>();
let view: VoiceView | null = null;
function changed(): void {
  view = null;
  renderNav();
  pushOverlay();
  for (const s of subs) s();
}
function speakingNow(id: string): boolean {
  return Boolean(room && [...room.activeSpeakers].some((s: { identity: string }) => s.identity === id));
}
function getView(): VoiceView {
  if (view) return view;
  const now = Date.now();
  const list = [...peers.values()].filter((p) => now - (lastSpoke.get(p.id) || 0) < RECENT_MS)
    .map((p) => ({ ...p, speaking: speakingNow(p.id), ...person(p.id) }));
  view = {
    loggedIn, connected: joined, joining, conn, joinNote, rangeNote, noiseNote: noiseNote(),
    inGame, nameMode, peers: list, settings, noiseActive, capturing, captureError, sending,
    mics, outs, outField, micNow: settings.mic || (room?.getActiveDevice?.('audioinput') ?? ''), test, toast: toastText,
  };
  return view;
}
const subscribe = (cb: () => void): (() => void) => { subs.add(cb); return () => subs.delete(cb); };
export const useVoice = (): VoiceView => useSyncExternalStore(subscribe, getView, getView);

// The meter: 20 times a second, to its own listeners only (the page's bar), not a redraw of the page.
export interface Level { pct: number; open: boolean }
let level: Level = { pct: 0, open: false };
const levelSubs = new Set<(l: Level) => void>();
export function onLevel(cb: (l: Level) => void): () => void { levelSubs.add(cb); cb(level); return () => levelSubs.delete(cb); }

// --- login --------------------------------------------------------------------------------
let started = false;
let wired = false;
/** Once per visit (main.tsx): who is logged in, the keys, the launcher's push-to-talk, window.isleVoice. */
export function startVoice(): void {
  if (started) return;
  started = true;
  settings = loadSettings();
  if (!wired) { wired = true; wireKeys(); }
  void (async () => {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      loggedIn = r.status !== 401;
    } catch {
      return;
    }
    changed();
  })();
  changed();
}

/** The LiveKit client (600 KB), fetched only when someone joins. */
function loadLiveKit(): Promise<LK> {
  const w = window as unknown as { LivekitClient?: LK };
  if (w.LivekitClient) return Promise.resolve(w.LivekitClient);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LK_SRC;
    s.onload = () => (w.LivekitClient ? resolve(w.LivekitClient) : reject(new Error('Không tải được thư viện voice.')));
    s.onerror = () => reject(new Error('Không tải được thư viện voice: kiểm tra mạng.'));
    document.head.append(s);
  });
}

function setConn(kind: VoiceView['conn']['kind'], text: string): void { conn = { kind, text }; }

// --- join / leave -----------------------------------------------------------------------------
export async function join(): Promise<void> {
  joining = true;
  lost = false;
  setConn('warn', '◌ Đang kết nối…');
  changed();
  try {
    LKC = await loadLiveKit();
    const r = await fetch('/api/voice/token', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await r.json().catch(() => ({})) as { token?: string; url?: string; identity?: string; error?: string };
    if (r.status === 404) throw new Error('Server chưa bật voice.');
    if (r.status === 429) throw new Error('Thử lại sau ít giây.');
    if (!r.ok || !body.token || !body.url) throw new Error(body.error || 'Không lấy được vé vào kênh.');
    identity = body.identity ?? null;
    // 48 kHz: the rate RNNoise works at (and Opus's own).
    try { audioCtx = new AudioContext({ sampleRate: 48000 }); } catch { audioCtx = new AudioContext(); }
    room = new LKC.Room({
      autoSubscribe: false, adaptiveStream: false, dynacast: false,
      webAudioMix: { audioContext: audioCtx }, audioCaptureDefaults: captureOptions(),
    });
    wireRoom(room);
    await room.connect(body.url, body.token);
    // Nobody may listen until the server says who is near.
    room.localParticipant.setTrackSubscriptionPermissions(false, []);
    allowed = '';
    await room.localParticipant.setMicrophoneEnabled(true);
    await applyNoise(false);
    await room.startAudio().catch(() => {});
    if (settings.out) await room.switchActiveDevice('audiooutput', settings.out).catch(() => {});
    startMeter();
    setConn('good', '● Đã vào kênh');
    joined = true;
    changed();
    await sendRange();
    joinNote = launcher()
      ? 'Voice chạy nền: chuyển tab hay thu nhỏ launcher vẫn nói và nghe được. Ra khỏi game thì bạn tự được tắt tiếng.'
      : 'Voice chạy khi bạn chuyển sang các tab khác của trang này: đừng đóng trang. Ra khỏi game thì bạn tự được tắt tiếng.';
    await listDevices();
    void poll();
  } catch (err) {
    await leave();
    setConn('bad', '✕ Không vào được kênh');
    joinNote = micError(err);
  } finally {
    joining = false;
    changed();
  }
}

function micError(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'NotAllowedError') return 'Bạn đã chặn quyền micro. Bấm biểu tượng ổ khoá cạnh địa chỉ trang → cho phép Micro, rồi thử lại.';
  if (e?.name === 'NotFoundError') return 'Không tìm thấy micro nào trên máy.';
  return e?.message || 'Lỗi không rõ: thử lại.';
}

export async function leave(): Promise<void> {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  stopMeter();
  stopHearing();
  const r = room; room = null;
  joined = false;
  if (r) await r.disconnect().catch(() => {});
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  panners.clear(); peers = new Map(); audience = []; lastSpoke.clear(); allowed = ''; inGame = null; sending = false;
  reconnecting = false; noiseActive = null; workletCtx = null;
  setConn('', '○ Chưa vào kênh');
  changed();
}

// --- noise suppression --------------------------------------------------------------------------
// off: nothing · browser: the browser's own filter · ai: RNNoise (a small neural network, WebAssembly
// in an AudioWorklet) on your mic before it is sent. It runs on your machine, not on the server.
function captureOptions(): Record<string, unknown> {
  return {
    echoCancellation: true, autoGainControl: true, noiseSuppression: settings.noise === 'browser',
    ...(settings.mic ? { deviceId: settings.mic } : {}),
  };
}

let nsModule: LK = null;
let nsWasm: unknown = null;
let workletCtx: AudioContext | null = null;
async function rnnoiseProcessor(): Promise<LK> {
  nsModule ??= await import(/* @vite-ignore */ `${NS_DIR}/index.js`);
  nsWasm ??= await nsModule.loadRnnoise({ url: `${NS_DIR}/rnnoise.wasm`, simdUrl: `${NS_DIR}/rnnoise_simd.wasm` });
  const ctx = audioCtx as AudioContext;
  if (workletCtx !== ctx) {
    await ctx.audioWorklet.addModule(`${NS_DIR}/rnnoise/workletProcessor.js`);
    workletCtx = ctx;
  }
  let src: MediaStreamAudioSourceNode | null = null; let node: LK = null; let dest: MediaStreamAudioDestinationNode | null = null;
  const processor: LK = {
    name: 'rnnoise',
    processedTrack: undefined,
    async init(opts: { track: MediaStreamTrack }) {
      src = ctx.createMediaStreamSource(new MediaStream([opts.track]));
      node = new nsModule.RnnoiseWorkletNode(ctx, { wasmBinary: nsWasm, maxChannels: 1 });
      dest = ctx.createMediaStreamDestination();
      src.connect(node).connect(dest);
      processor.processedTrack = dest.stream.getAudioTracks()[0];
    },
    async restart(opts: { track: MediaStreamTrack }) { await processor.destroy(); await processor.init(opts); },
    async destroy() {
      if (src) src.disconnect();
      if (node) { node.disconnect(); node.destroy(); }
      if (processor.processedTrack) processor.processedTrack.stop();
      src = null; node = null; dest = null;
    },
  };
  return processor;
}

/** Put the chosen filter on the mic (restart = the browser filter changed too). */
async function applyNoise(restart: boolean): Promise<void> {
  const pub = room?.localParticipant.getTrackPublication(LKC.Track.Source.Microphone);
  const track = pub?.track;
  if (!track) return;
  if (restart) await track.restartTrack(captureOptions()).catch(() => {});
  if (settings.noise === 'ai') {
    try {
      await track.setProcessor(await rnnoiseProcessor());
      noiseActive = 'ai';
    } catch (err) {
      console.warn('[voice] RNNoise unavailable, using the browser filter:', err);
      await track.restartTrack({ ...captureOptions(), noiseSuppression: true }).catch(() => {});
      noiseActive = 'browser';
    }
  } else {
    if (track.getProcessor()) await track.stopProcessor().catch(() => {});
    noiseActive = settings.noise;
  }
  if (restart) { stopMeter(); startMeter(); }
  changed();
}

function noiseNote(): string {
  if (!room) return 'Áp dụng khi bạn vào kênh.';
  return ({
    off: 'Không lọc: tiếng ồn quanh bạn (quạt, bàn phím) đi thẳng vào voice.',
    browser: settings.noise === 'ai'
      ? 'Máy này không chạy được bộ lọc AI: đang dùng bộ lọc của trình duyệt.'
      : 'Bộ lọc có sẵn của trình duyệt: nhẹ, lọc được tiếng ồn đều (quạt, điều hoà).',
    ai: 'Đang lọc bằng AI (RNNoise) ngay trên máy bạn: lọc cả tiếng bàn phím, chuột, tiếng ồn nền, giọng vẫn rõ.',
  } as Record<string, string>)[noiseActive ?? ''] || '';
}

// --- the launcher's in-game overlay ------------------------------------------------------------------
let overlaySent = '';
let overlayTimer: ReturnType<typeof setTimeout> | null = null;
/** What the overlay shows, sent when it changes (at most ~8 times a second). */
function pushOverlay(): void {
  const l = launcher();
  if (!l?.overlayState || overlayTimer !== null) return;
  overlayTimer = setTimeout(() => {
    overlayTimer = null;
    const now = Date.now();
    const speakers = [...peers.values()]
      .filter((p) => now - (lastSpoke.get(p.id) || 0) < RECENT_MS)
      .map((p) => ({ name: p.name || null, gain: p.gain, pan: p.pan, speaking: speakingNow(p.id) }))
      .sort((a, b) => Number(b.speaking) - Number(a.speaking) || b.gain - a.gain);
    const state = {
      connected: room !== null, lost, phase: reconnecting ? 'reconnecting' : 'ok', inGame,
      talking: sending, mode: settings.mode, pttLabel: l.pttLabel?.(),
      range: settings.range, rangeName: RANGE_NAMES[settings.range], nameMode, speakers, toast: lastToast,
    };
    const json = JSON.stringify(state);
    if (json === overlaySent) return;
    overlaySent = json;
    l.overlayState?.(state);
  }, 120);
}

function wireRoom(r: LK): void {
  const E = LKC.RoomEvent;
  r.on(E.TrackPublished, () => applyPeers());
  r.on(E.ParticipantConnected, () => applyPeers());
  r.on(E.TrackSubscribed, (track: LK, _pub: LK, participant: LK) => {
    if (track.kind !== 'audio' || !audioCtx) return;
    track.attach();                                     // web audio mix: the element stays muted
    const pan = audioCtx.createStereoPanner();
    panners.set(participant.identity, pan);
    track.setWebAudioPlugins([pan]);
    applyPeers();
  });
  r.on(E.TrackUnsubscribed, (track: LK, _pub: LK, participant: LK) => {
    track.detach();
    panners.delete(participant.identity);
  });
  r.on(E.ActiveSpeakersChanged, (speakers: Array<{ identity: string }>) => {
    const now = Date.now();
    for (const s of speakers) if (s.identity !== identity) lastSpoke.set(s.identity, now);
    changed();
  });
  r.on(E.Reconnecting, () => { reconnecting = true; setConn('warn', '◌ Mất kết nối, đang nối lại…'); changed(); });
  r.on(E.Reconnected, () => { reconnecting = false; allowed = ''; setConn('good', '● Đã vào kênh'); applyPeers(); changed(); });
  r.on(E.Disconnected, async (reason: unknown) => {
    if (room !== r) return;
    await leave();
    lost = true;
    const R = LKC.DisconnectReason || {};
    if (reason === R.DUPLICATE_IDENTITY) {
      setConn('bad', '✕ Tài khoản này vừa vào voice ở nơi khác');
      joinNote = 'Mỗi tài khoản Steam chỉ ở trong voice một nơi: bạn vừa vào kênh bằng tab / máy / launcher khác nên phiên này bị thay thế.';
    } else if (reason === R.PARTICIPANT_REMOVED) {
      setConn('bad', '✕ Admin đã đưa bạn ra khỏi kênh voice');
    } else {
      setConn('bad', '✕ Đã mất kết nối: bấm vào lại');
    }
    changed();
  });
  r.on(E.AudioPlaybackStatusChanged, () => {
    if (!r.canPlaybackAudio) { joinNote = 'Trình duyệt đang chặn âm thanh: bấm vào bất kỳ đâu trên trang.'; changed(); }
  });
}

// --- who is near (server) ---------------------------------------------------------------------
async function poll(): Promise<void> {
  if (!room) return;
  try {
    const r = await fetch('/api/voice', { credentials: 'same-origin' });
    if (r.ok) {
      const v = await r.json() as { inGame?: unknown; nameMode?: unknown; peers?: unknown; audience?: unknown };
      inGame = v.inGame === true;
      nameMode = (['name', 'id', 'none'] as const).find((m) => m === v.nameMode) ?? 'name';
      peers = new Map((Array.isArray(v.peers) ? v.peers as Peer[] : []).map((p) => [p.id, p]));
      audience = Array.isArray(v.audience) ? (v.audience as unknown[]).filter((id): id is string => typeof id === 'string') : [];
    } else if (r.status === 401) {
      await leave(); location.reload(); return;
    }
  } catch { /* keep the last list for a moment; the next poll decides */ }
  applyPeers();
  changed();
  pollTimer = setTimeout(() => { void poll(); }, POLL_MS);
}

/** Subscribe to the people near, set their volume and side; drop everyone else. */
function applyPeers(): void {
  if (!room) return;
  const master = settings.master / 100;
  for (const p of room.remoteParticipants.values()) {
    const peer = peers.get(p.identity);
    for (const pub of p.audioTrackPublications.values()) {
      if (!peer) { if (pub.isSubscribed || pub.isDesired) pub.setSubscribed(false); continue; }
      if (!pub.isDesired) pub.setSubscribed(true);
      const pref = person(p.identity);
      const vol = pref.muted ? 0 : Math.min(2, peer.gain * master * (pref.vol / 100));
      if (pub.track) pub.track.setVolume(vol);
      const pan = panners.get(p.identity);
      if (pan && audioCtx) pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, peer.pan)), audioCtx.currentTime, 0.15);
    }
  }
  // Our microphone: only the people inside our range may subscribe to it.
  const ids = [...audience].sort();
  const key = ids.join(',');
  if (key !== allowed) {
    allowed = key;
    room.localParticipant.setTrackSubscriptionPermissions(false, ids.map((id) => ({ participantIdentity: id, allowAll: true })));
  }
}

// --- range: buttons, and a key that cycles it (` by default) --------------------------------------
/** Tell the server how far our voice carries (it decides who may hear us). */
async function sendRange(): Promise<void> {
  try {
    const r = await fetch('/api/voice/range', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ range: settings.range }) });
    rangeNote = r.ok
      ? `Người trong ${settings.range} m nghe thấy bạn. Càng gần càng to; ra tới mép tầm thì nhỏ dần rồi tắt.`
      : 'Không đổi được tầm: thử lại sau ít giây.';
  } catch {
    rangeNote = 'Không đổi được tầm: kiểm tra mạng.';
  }
  changed();
}

export function setRange(range: number, announce = false): void {
  settings = { ...settings, range };
  captureError = null;
  save();
  if (room) void sendRange();
  if (announce) {
    const text = `Tầm giọng: ${range} m (${RANGE_NAMES[range]})`;
    beep((RANGES as readonly number[]).indexOf(range) + 1);
    toast(text);
    lastToast = { text, at: Date.now() };
  }
  changed();
}

function cycleRange(): void {
  setRange(RANGES[((RANGES as readonly number[]).indexOf(settings.range) + 1) % RANGES.length] ?? 30, true);
}

/** 1-4 short beeps = the range step, so you know it changed while in game. */
function beep(count: number): void {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + 0.02;
  for (let i = 0; i < count; i++) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 660 + i * 110;
    g.gain.setValueAtTime(0, t0 + i * 0.16);
    g.gain.linearRampToValueAtTime(0.12, t0 + i * 0.16 + 0.01);
    g.gain.linearRampToValueAtTime(0, t0 + i * 0.16 + 0.1);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + i * 0.16);
    o.stop(t0 + i * 0.16 + 0.12);
  }
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(text: string): void {
  toastText = text;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastText = null; changed(); }, 2200);
}

// --- microphone: voice activation / push-to-talk / off --------------------------------------------
function startMeter(): void {
  const pub = room?.localParticipant.getTrackPublication(LKC.Track.Source.Microphone);
  const track: MediaStreamTrack | undefined = pub?.track?.mediaStreamTrack;
  if (!track || !audioCtx) return;
  // Measure a clone: muting the published track must not blind the meter.
  micClone = track.clone();
  micClone.enabled = true;
  analyserSrc = audioCtx.createMediaStreamSource(new MediaStream([micClone]));
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyserSrc.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  meterTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
    const now = Date.now();
    if (db >= settings.threshold) lastLoud = now;
    let want = false;
    if (settings.mode === 'vad') want = now - lastLoud < HANGOVER_MS;
    else if (settings.mode === 'ptt') want = pttHeld || externalPtt;
    if (inGame === false || hearing) want = false;
    setSending(want);
    level = { pct: Math.max(0, Math.min(100, ((db + 80) / 60) * 100)), open: want };
    for (const s of levelSubs) s(level);
  }, 50);
}

function stopMeter(): void {
  if (meterTimer) clearInterval(meterTimer);
  meterTimer = null;
  if (analyserSrc) analyserSrc.disconnect();
  if (micClone) micClone.stop();
  analyserSrc = null; micClone = null;
}

function setSending(on: boolean): void {
  if (!room) return;
  const pub = room.localParticipant.getTrackPublication(LKC.Track.Source.Microphone);
  if (pub?.track) {
    if (on && pub.isMuted) pub.unmute().catch(() => {});
    if (!on && !pub.isMuted) pub.mute().catch(() => {});
  }
  if (on === sending) return;
  sending = on;
  changed();
}

// --- keys: in the page (browser), or global (launcher) -------------------------------------------
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return ({ Space: 'Space', CapsLock: 'Caps Lock', Backquote: '` ~', ShiftLeft: 'Shift trái', ControlLeft: 'Ctrl trái', AltLeft: 'Alt trái' } as Record<string, string>)[code] || code;
}
/** The two keys as shown: the launcher's (global) or this page's. */
export function keyLabels(): { ptt: string; range: string } {
  const l = launcher();
  return {
    ptt: l?.pttLabel ? l.pttLabel() : keyName(settings.pttCode),
    range: l?.rangeLabel ? l.rangeLabel() : keyName(settings.rangeCode),
  };
}
const typing = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;

function wireKeys(): void {
  document.addEventListener('keydown', (e) => {
    if (launcher()) return;             // the launcher's global keys do it, in game too
    if (capturing !== null) {
      e.preventDefault();
      if (e.code !== 'Escape') settings = { ...settings, [capturing === 'ptt' ? 'pttCode' : 'rangeCode']: e.code };
      save();
      capturing = null;
      changed();
      return;
    }
    if (typing(e) || e.repeat) return;
    if (e.code === settings.pttCode) pttHeld = true;
    if (e.code === settings.rangeCode && room) { e.preventDefault(); cycleRange(); }
  });
  document.addEventListener('keyup', (e) => { if (!launcher() && e.code === settings.pttCode) pttHeld = false; });
  window.addEventListener('blur', () => { pttHeld = false; });
  const l = launcher();
  if (l) {
    l.onPushToTalk?.((held) => { externalPtt = held === true; });
    l.onRangeKey?.(() => { if (room) cycleRange(); });
  }
  document.addEventListener('click', () => { if (room && !room.canPlaybackAudio) room.startAudio().catch(() => {}); });
  if (navigator.mediaDevices) navigator.mediaDevices.addEventListener?.('devicechange', () => { if (room) void listDevices(); });
  // Re-render now and then, so "vừa nói" fades out.
  setInterval(() => { if (room) changed(); }, 2000);
  // For the launcher's tray (and tests): what voice is doing now.
  (window as unknown as { isleVoice: unknown }).isleVoice = {
    setPushToTalk(held: boolean) { externalPtt = held === true; },
    status() {
      const subscribed: string[] = [];
      if (room) {
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.audioTrackPublications.values()) if (pub.isSubscribed) subscribed.push(p.name || p.identity);
        }
      }
      return {
        connected: room !== null, inGame, sending, mode: settings.mode, range: settings.range, nameMode, noise: noiseActive,
        near: [...peers.values()].map((p) => ({ name: p.name, gain: p.gain, pan: p.pan })), subscribed,
      };
    },
  };
}

export async function captureKey(which: 'ptt' | 'range'): Promise<void> {
  capturing = which;
  captureError = null;
  changed();
  const l = launcher();
  if (l) {
    const r = await (which === 'ptt' ? l.capturePttKey?.() : l.captureRangeKey?.());
    capturing = null;
    if (r?.error) captureError = { which, text: r.error };   // already used by another key
    changed();
  }
}

// --- settings from the page ------------------------------------------------------------------------
export function setMode(mode: Mode): void { settings = { ...settings, mode }; captureError = null; save(); changed(); }
export async function setNoise(noise: Noise): Promise<void> {
  settings = { ...settings, noise }; save(); changed();
  if (room) await applyNoise(true);
}
export function setThreshold(v: number): void { settings = { ...settings, threshold: v }; captureError = null; save(); changed(); }
export function setMaster(v: number): void { settings = { ...settings, master: v }; save(); applyPeers(); changed(); }
export function setPeerVol(id: string, vol: number): void {
  settings = { ...settings, people: { ...settings.people, [id]: { ...person(id), vol } } }; save(); applyPeers(); changed();
}
export function togglePeerMute(id: string): void {
  settings = { ...settings, people: { ...settings.people, [id]: { ...person(id), muted: !person(id).muted } } }; save(); applyPeers(); changed();
}
export async function setMic(id: string): Promise<void> {
  settings = { ...settings, mic: id }; save(); changed();
  if (hearing) { stopHearing(); void startHearing(); }
  if (!room) return;
  await room.switchActiveDevice('audioinput', settings.mic).catch(() => {});
  stopMeter(); startMeter();
}
export async function setOut(id: string): Promise<void> {
  settings = { ...settings, out: id }; save(); changed();
  const ctx = hearing?.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | undefined;
  if (ctx && typeof ctx.setSinkId === 'function') ctx.setSinkId(settings.out).catch(() => {});
  if (room) await room.switchActiveDevice('audiooutput', settings.out).catch(() => {});
}

// --- devices ------------------------------------------------------------------------------------------
async function listDevices(): Promise<void> {
  const fill = async (kind: string): Promise<Device[]> => {
    const list = await LKC.Room.getLocalDevices(kind).catch(() => []) as Array<{ deviceId: string; label: string }>;
    return list.map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Micro' : 'Loa'} ${i + 1}` }));
  };
  mics = await fill('audioinput');
  // Choosing the output needs setSinkId (Chrome/Edge, the launcher); hide it elsewhere.
  const canPickOut = typeof (AudioContext.prototype as { setSinkId?: unknown }).setSinkId === 'function';
  outs = canPickOut ? await fill('audiooutput') : [];
  outField = canPickOut && outs.length > 0;
  changed();
}

// --- "Thử âm thanh": the micro straight to the output, to hear yourself as you speak ------------------
// On until pressed again; nothing goes out to the channel meanwhile (the meter sends nothing).
function stopHearing(): void {
  if (hearing) {
    for (const t of hearing.stream.getTracks()) t.stop();
    hearing.ctx.close().catch(() => {});
  }
  hearing = null;
  test = { ...test, on: false };
}
async function startHearing(): Promise<void> {
  test = { ...test, busy: true };
  changed();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...captureOptions(), ...(settings.mic ? { deviceId: { exact: settings.mic } } : {}) } });
    const ctx = new AudioContext({ latencyHint: 'interactive' }) as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    hearing = { stream, ctx };
    if (settings.out && typeof ctx.setSinkId === 'function') await ctx.setSinkId(settings.out).catch(() => {});
    await ctx.resume().catch(() => {});
    ctx.createMediaStreamSource(stream).connect(ctx.destination);
    test = { on: true, busy: false, note: 'Đang nghe lại giọng bạn, người khác không nghe thấy lúc này.' };
  } catch (err) {
    stopHearing();
    test = { on: false, busy: false, note: micError(err) };
  } finally {
    test = { ...test, busy: false };
    changed();
  }
}
export function toggleTest(): void {
  if (hearing) { stopHearing(); test = { ...test, note: 'Đã tắt thử âm thanh.' }; changed(); } else void startHearing();
}

/** The dot beside Voice 3D in the menu: green = working, amber = needs you, red = dropped. */
function renderNav(): void {
  if (reconnecting) setVoiceDot({ kind: 'warn', text: 'Voice: đang nối lại' });
  else if (joined && inGame) setVoiceDot({ kind: 'ok', text: 'Voice đang hoạt động' });
  else if (joined) setVoiceDot({ kind: 'warn', text: 'Voice: đã vào kênh, chưa vào game' });
  else if (lost) setVoiceDot({ kind: 'bad', text: 'Voice: mất kết nối' });
  else setVoiceDot(null);
}

/** Tests only: back to a fresh visit. */
export function resetVoiceForTests(): void {
  started = false; room = null; joined = false; LKC = null; loggedIn = null; joining = false; lost = false; inGame = null; peers = new Map();
  conn = { kind: '', text: '○ Chưa vào kênh' }; capturing = null; captureError = null; sending = false; noiseActive = null;
  joinNote = 'Cần quyền dùng micro. Voice tiếp tục chạy khi bạn chuyển sang các tab khác.';
  rangeNote = 'Càng gần bạn càng nghe to; ra tới mép tầm thì nhỏ dần rồi tắt.';
  test = { on: false, busy: false, note: 'Bật rồi nói: nghe lại giọng mình ngay qua loa / tai nghe. Nên dùng tai nghe.' };
  mics = []; outs = []; outField = true; toastText = null; view = null;
}
