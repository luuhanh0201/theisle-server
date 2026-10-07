import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { Voice } from '../features/voice/Voice';
import { AUTO_KEY, keyName, resetVoiceForTests, startVoice } from '../lib/voice';

// jsdom has no Web Audio: just enough of it for the engine (the meter, the panners, the beeps).
class FakeCtx {
  currentTime = 0; destination = {}; sampleRate = 48000;
  createMediaStreamSource() { return { connect: () => ({ connect: () => {} }), disconnect: () => {} }; }
  createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData: (b: Float32Array) => b.fill(0) }; }
  createStereoPanner() { return { pan: { setTargetAtTime: () => {} } }; }
  createOscillator() { return { frequency: {}, connect: () => ({ connect: () => {} }), start: () => {}, stop: () => {} }; }
  createGain() { return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} } }; }
  close() { return Promise.resolve(); }
}
class FakeStream { constructor(public t: unknown[]) {} }

let room: FakeRoom | null = null;
class FakeRoom {
  handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  remoteParticipants = new Map();
  activeSpeakers: Array<{ identity: string }> = [];
  canPlaybackAudio = true;
  perms: string[] | null = null;
  pub = { isMuted: true, mute: async () => {}, unmute: async () => {},
    track: { mediaStreamTrack: { clone: () => ({ enabled: false, stop: () => {} }) }, restartTrack: async () => {}, getProcessor: () => null,
      stopProcessor: async () => {}, setProcessor: async () => { throw new Error('no RNNoise'); } } };
  localParticipant = {
    setMicrophoneEnabled: async () => {}, getTrackPublication: () => this.pub,
    setTrackSubscriptionPermissions: (_a: boolean, l: Array<{ participantIdentity: string }>) => { this.perms = l.map((x) => x.participantIdentity); },
  };
  constructor() { room = this; }
  on(e: string, f: (...a: unknown[]) => void) { (this.handlers[e] ??= []).push(f); return this; }
  emit(e: string, ...a: unknown[]) { for (const f of this.handlers[e] ?? []) f(...a); }
  async connect() {} async startAudio() {} async disconnect() {} async switchActiveDevice() {}
  getActiveDevice() { return 'mic1'; }
  static async getLocalDevices(kind: string) { return kind === 'audioinput' ? [{ deviceId: 'mic1', label: 'Micro A' }] : []; }
}
const LK = { Room: FakeRoom, Track: { Source: { Microphone: 'mic' } },
  RoomEvent: { TrackPublished: 'tp', ParticipantConnected: 'pc', TrackSubscribed: 'ts', TrackUnsubscribed: 'tu', ActiveSpeakersChanged: 'as',
    Reconnecting: 'rc', Reconnected: 'rd', Disconnected: 'dc', AudioPlaybackStatusChanged: 'ap' }, DisconnectReason: { DUPLICATE_IDENTITY: 2, PARTICIPANT_REMOVED: 4 } };

let api: { me: number; token: number; voice: Record<string, unknown>; ranges: number[]; online?: boolean };
beforeEach(() => {
  api = { me: 200, token: 200, voice: { inGame: true, nameMode: 'name', peers: [], audience: [] }, ranges: [] };
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('MediaStream', FakeStream);
  (window as unknown as { LivekitClient: unknown }).LivekitClient = LK;
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    if (u === '/api/me') return new Response(JSON.stringify({ online: api.online ?? false }), { status: api.me });
    if (u === '/api/voice/token') return new Response(api.token === 200 ? '{"token":"t","url":"wss://x","identity":"me"}' : '{}', { status: api.token });
    if (u === '/api/voice/range') { api.ranges.push(JSON.parse(String(init?.body)).range); return new Response('{"ok":true}'); }
    if (u === '/api/voice') return new Response(JSON.stringify(api.voice));
    return new Response('{}');
  }));
  localStorage.removeItem('isle-voice');
  resetVoiceForTests();
  startVoice();
});
afterEach(() => { vi.unstubAllGlobals(); room = null; });

const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLElement;
const shown = (c: HTMLElement, s: string) => !q(c, s).hidden;

describe('Voice 3D', () => {
  it('a guest: the login card', async () => {
    resetVoiceForTests();
    api.me = 401;
    startVoice();
    const { container } = render(<Voice />);
    await waitFor(() => expect(shown(container, '#v-login-card')).toBe(true));
    expect(shown(container, '#v-join-card')).toBe(false);
    expect(q(container, '#v-login-card a').getAttribute('href')).toBe('/auth/steam?next=voice');
  });

  it('join: the cards, the range sent, the server\'s word on the game, the noise fallback', async () => {
    const { container } = render(<Voice />);
    await waitFor(() => expect(shown(container, '#v-join-card')).toBe(true));
    expect(shown(container, '#v-mic-card')).toBe(false);
    await act(async () => { fireEvent.click(q(container, '#v-join')); });
    await waitFor(() => expect(q(container, '#v-conn-chip').textContent).toBe('● Đã vào kênh'));
    expect(shown(container, '#v-mic-card') && shown(container, '#v-range-card') && shown(container, '#v-peers-card')).toBe(true);
    expect(shown(container, '#v-join')).toBe(false);
    expect(shown(container, '#v-leave')).toBe(true);
    expect(api.ranges).toEqual([30]);
    expect(q(container, '#v-noise-note').textContent).toBe('Máy này không chạy được bộ lọc AI: đang dùng bộ lọc của trình duyệt.');
    await waitFor(() => expect(q(container, '#v-game-chip').textContent).toBe('▲ Đang trong game'));
    expect(q(container, '#v-range-note').textContent).toBe('Người trong 30 m nghe thấy bạn. Càng gần càng to; ra tới mép tầm thì nhỏ dần rồi tắt.');
  });

  it('range, modes, the talk key captured in the page, settings kept', async () => {
    const { container } = render(<Voice />);
    await waitFor(() => expect(shown(container, '#v-join-card')).toBe(true));
    await act(async () => { fireEvent.click(q(container, '#v-join')); });
    await waitFor(() => expect(q(container, '#v-conn-chip').textContent).toBe('● Đã vào kênh'));
    await act(async () => { fireEvent.click(q(container, '[data-range="90"]')); });
    await waitFor(() => expect(api.ranges).toEqual([30, 90]));
    expect(q(container, '[data-range="90"]').getAttribute('aria-pressed')).toBe('true');
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote', bubbles: true })); });
    await waitFor(() => expect(api.ranges).toEqual([30, 90, 15]));
    expect(q(container, '#v-toast').textContent).toBe('Tầm giọng: 15 m (Thì thầm)');
    fireEvent.click(q(container, '[data-mode="ptt"]'));
    expect(q(container, '#v-mode-help').textContent).toBe('giữ V để nói');
    expect(shown(container, '#v-ptt-field')).toBe(true);
    expect(shown(container, '#v-thr-field')).toBe(false);
    await act(async () => { fireEvent.click(q(container, '#v-ptt-key')); });
    expect(q(container, '#v-ptt-key-name').textContent).toBe('bấm một phím hoặc nút chuột…');
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true })); });
    expect(q(container, '#v-ptt-key-name').textContent).toBe('G');
    fireEvent.click(q(container, '[data-mode="off"]'));
    expect(q(container, '#v-talk-text').textContent).toBe('Mic đang tắt');
    expect(JSON.parse(localStorage.getItem('isle-voice') ?? '{}')).toMatchObject({ mode: 'off', pttCode: 'KeyG', range: 15 });
  });

  it('speakers near: names, near / far, sides, mute; who may hear us; the name mode', async () => {
    const { container } = render(<Voice />);
    await waitFor(() => expect(shown(container, '#v-join-card')).toBe(true));
    api.voice = { inGame: true, nameMode: 'name', peers: [{ id: 'a', name: 'Rex', gain: 0.9, pan: 0.8 }, { id: 'b', name: null, gain: 0.2, pan: -0.9 }], audience: ['b', 'a'] };
    await act(async () => { fireEvent.click(q(container, '#v-join')); });
    await waitFor(() => expect(room?.perms).toEqual(['a', 'b']));
    act(() => { if (room) room.activeSpeakers = [{ identity: 'a' }]; room?.emit('as', [{ identity: 'a' }, { identity: 'b' }]); });
    await waitFor(() => expect(container.querySelectorAll('.v-peer')).toHaveLength(2));
    expect(q(container, '#v-peers').textContent).toContain('RexĐang nói · rất gần · bên phải');
    expect(q(container, '#v-peers').textContent).toContain('Người chơiVừa nói · xa · bên trái');
    expect(shown(container, '#v-peers-empty')).toBe(false);
    fireEvent.click(container.querySelectorAll('.v-peer .mute')[0] as HTMLElement);
    expect(container.querySelectorAll('.v-peer .mute')[0]?.textContent).toBe('Đã tắt tiếng');
    api.voice = { ...api.voice, nameMode: 'none' };
    await waitFor(() => expect(q(container, '#v-peers').textContent).toContain('Có người đang nói'), { timeout: 2000 });
  });

  it('dropped (signed in elsewhere), leave, a refused join', async () => {
    const { container } = render(<Voice />);
    await waitFor(() => expect(shown(container, '#v-join-card')).toBe(true));
    await act(async () => { fireEvent.click(q(container, '#v-join')); });
    await waitFor(() => expect(q(container, '#v-conn-chip').textContent).toBe('● Đã vào kênh'));
    await act(async () => { room?.emit('dc', 2); });
    await waitFor(() => expect(q(container, '#v-conn-chip').textContent).toBe('✕ Tài khoản này vừa vào voice ở nơi khác'));
    expect(q(container, '#v-join-note').textContent).toContain('Mỗi tài khoản Steam chỉ ở trong voice một nơi');
    expect(shown(container, '#v-mic-card')).toBe(false);
    await act(async () => { fireEvent.click(q(container, '#v-join')); });
    await waitFor(() => expect(q(container, '#v-conn-chip').textContent).toBe('● Đã vào kênh'));
    await act(async () => { fireEvent.click(q(container, '#v-leave')); });
    await waitFor(() => expect(q(container, '#v-conn-chip').textContent).toBe('○ Chưa vào kênh'));
    api.token = 404;
    await act(async () => { fireEvent.click(q(container, '#v-join')); });
    await waitFor(() => expect(q(container, '#v-conn-chip').textContent).toBe('✕ Không vào được kênh'));
    expect(q(container, '#v-join-note').textContent).toBe('Server chưa bật voice.');
    expect((window as unknown as { isleVoice: { status: () => { connected: boolean } } }).isleVoice.status().connected).toBe(false);
  });

  it('key names', () => {
    expect([keyName('KeyV'), keyName('Digit4'), keyName('Backquote'), keyName('ShiftLeft'), keyName('F5')]).toEqual(['V', '4', '` ~', 'Shift trái', 'F5']);
  });

  it('the launcher remembers the room: next time in again once in game (a look each 5 s); Rời kênh forgets it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      (window as unknown as { isleLauncher: unknown }).isleLauncher = {};
      localStorage.setItem(AUTO_KEY, '1');
      api.online = false;
      resetVoiceForTests();
      startVoice();
      const { container } = render(<Voice />);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(container.querySelector('#v-auto-cancel')).not.toBeNull();
      expect(q(container, '#v-join-note').textContent).toContain('tự vào lại khi bạn vào game');
      expect(room).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(room).toBeNull();
      api.online = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
      // The join itself (its own awaits).
      for (let i = 0; i < 200 && q(container, '#v-conn-chip').textContent !== '● Đã vào kênh'; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(20); await new Promise((r) => setImmediate(r)); });
      }
      expect(room).not.toBeNull();
      expect(q(container, '#v-conn-chip').textContent).toBe('● Đã vào kênh');
      expect(localStorage.getItem(AUTO_KEY)).toBe('1');
      await act(async () => { fireEvent.click(q(container, '#v-leave')); await vi.advanceTimersByTimeAsync(50); });
      expect(localStorage.getItem(AUTO_KEY)).toBeNull();
      expect(container.querySelector('#v-auto-cancel')).toBeNull();
    } finally {
      vi.useRealTimers();
      delete (window as unknown as { isleLauncher?: unknown }).isleLauncher;
      localStorage.removeItem(AUTO_KEY);
    }
  });
  it('in a browser the room is not remembered', async () => {
    const { container } = render(<Voice />);
    await waitFor(() => expect(shown(container, '#v-join-card')).toBe(true));
    await act(async () => { fireEvent.click(q(container, '#v-join')); });
    await waitFor(() => expect(q(container, '#v-conn-chip').textContent).toBe('● Đã vào kênh'));
    expect(localStorage.getItem(AUTO_KEY)).toBeNull();
  });
});
