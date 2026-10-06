// A stand-in for the voice server, for the Voice 3D flows: a fake LiveKit client (window.LivekitClient, which both
// voice.js and the React engine take when it is already there) and /api/voice, /api/voice/token, /api/voice/range
// answered in the page. window.__voice drives it: peers, audience, inGame, nameMode, tokenStatus; it records the
// ranges sent and who may hear us (perms). window.__room is the room; __room.emit(event, ...args) fires a LiveKit event.
export const VOICE_STUB = `if (location.protocol === 'http:') {
  try { localStorage.removeItem('isle-voice'); } catch {}
  const realFetch = window.fetch.bind(window);
  window.__voice = { ranges: [], peers: [], audience: [], inGame: true, nameMode: 'name', tokenStatus: 200, perms: null, switched: [] };
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (u, o) => {
    const url = new URL(String(u), location.href).pathname;
    const V = window.__voice;
    if (url === '/api/voice/token') return V.tokenStatus === 200 ? json({ token: 't', url: 'wss://voice.test', identity: 'me' }) : json({ error: 'off' }, V.tokenStatus);
    if (url === '/api/voice/range') { V.ranges.push(JSON.parse(o.body).range); return json({ ok: true }); }
    if (url === '/api/voice') return json({ inGame: V.inGame, nameMode: V.nameMode, peers: V.peers, audience: V.audience });
    return realFetch(u, o);
  };
  let ctx0 = null;
  const track = () => { ctx0 ??= new AudioContext(); return ctx0.createMediaStreamDestination().stream.getAudioTracks()[0]; };
  class Room {
    constructor(opts) {
      this.opts = opts; this.handlers = {}; this.remoteParticipants = new Map(); this.activeSpeakers = []; this.canPlaybackAudio = true;
      const pub = { isMuted: true, mute: async () => { pub.isMuted = true; }, unmute: async () => { pub.isMuted = false; },
        track: { mediaStreamTrack: track(), restartTrack: async () => {}, getProcessor: () => null, stopProcessor: async () => {},
          setProcessor: async () => { throw new Error('no RNNoise in the flows'); } } };
      this.localParticipant = { setMicrophoneEnabled: async () => {}, getTrackPublication: () => pub,
        setTrackSubscriptionPermissions: (_all, list) => { window.__voice.perms = list.map((x) => x.participantIdentity); } };
      window.__room = this;
    }
    on(e, f) { (this.handlers[e] ??= []).push(f); return this; }
    emit(e, ...a) { for (const f of this.handlers[e] ?? []) f(...a); }
    async connect() {} async startAudio() {} async disconnect() {}
    async switchActiveDevice(kind, id) { window.__voice.switched.push(kind + ':' + id); }
    getActiveDevice() { return 'mic1'; }
    static async getLocalDevices(kind) {
      return kind === 'audioinput' ? [{ deviceId: 'mic1', label: 'Micro A' }, { deviceId: 'mic2', label: '' }] : [{ deviceId: 'out1', label: 'Loa A' }];
    }
  }
  window.LivekitClient = { Room, Track: { Source: { Microphone: 'microphone' } },
    RoomEvent: { TrackPublished: 'tp', ParticipantConnected: 'pc', TrackSubscribed: 'ts', TrackUnsubscribed: 'tu', ActiveSpeakersChanged: 'as',
      Reconnecting: 'rc', Reconnected: 'rd', Disconnected: 'dc', AudioPlaybackStatusChanged: 'ap' },
    DisconnectReason: { DUPLICATE_IDENTITY: 2, PARTICIPANT_REMOVED: 4 } };
}`;
