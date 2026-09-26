'use strict';
/*
 * Proximity voice: the "Voice gần" tab of the player page (index.html,
 * #page-voice). It lives in the same page as the other tabs, so voice keeps
 * running while you look at your garage or the map.
 *
 * The audio goes through our LiveKit server; who you hear, how loud and from
 * which side comes from /api/voice, which the bridge works out from the
 * game's live positions every second:
 *
 *   - you subscribe only to the voice users whose voice reaches you;
 *   - your microphone may only be subscribed by those inside YOUR range
 *     (setTrackSubscriptionPermissions), so nobody far away can listen in;
 *   - out of the game: nobody is listed, you hear no one and no one hears you.
 *
 * In Xóm Gáy Launcher (window.isleLauncher, Electron preload) the talk key and
 * the range key are global: they work while The Isle has the focus.
 */
(() => {
  const launcher = window.isleLauncher || null;
  const LK_SRC = '/vendor/livekit-client-2.22.3.umd.js';
  const NS_DIR = '/vendor/noise-suppressor-0.4.1';
  const RANGES = [15, 30, 60, 90];
  const RANGE_NAMES = { 15: 'Thì thầm', 30: 'Nói thường', 60: 'Nói to', 90: 'Hét' };
  const $ = (id) => document.getElementById(`v-${id}`);
  if (!$('join')) return;             // not the player page
  const POLL_MS = 500;
  const HANGOVER_MS = 450;            // keep sending this long after the voice drops under the line
  const RECENT_MS = 15_000;           // a speaker stays in the list this long after they stop

  // --- settings (per browser; everything works without storage) --------------
  const defaults = {
    mode: launcher ? 'ptt' : 'vad', threshold: -50, pttCode: 'KeyV', rangeCode: 'Backquote',
    master: 100, mic: '', out: '', people: {}, range: 30,
    noise: 'ai',                      // off | browser | ai (RNNoise)
  };
  let settings = { ...defaults };
  try { settings = { ...defaults, ...JSON.parse(localStorage.getItem('isle-voice') || '{}') }; } catch { /* private window */ }
  if (!RANGES.includes(settings.range)) settings.range = 30;
  if (!['off', 'browser', 'ai'].includes(settings.noise)) settings.noise = 'ai';
  const save = () => { try { localStorage.setItem('isle-voice', JSON.stringify(settings)); } catch { /* ignore */ } };
  const person = (id) => settings.people[id] || { vol: 100, muted: false };

  // --- state -------------------------------------------------------------------
  let LK = null;
  let room = null;
  let audioCtx = null;
  let identity = null;
  let pollTimer = null;
  let meterTimer = null;
  let analyserSrc = null;
  let micClone = null;
  let inGame = null;
  let nameMode = 'name';              // the server's choice: name | id | none
  let peers = new Map();              // id -> { name, gain, pan } from the server: who we hear
  let audience = [];                  // who may hear us (inside our range), from the server
  let allowed = '';                   // who may subscribe to our mic, as last sent
  let lost = false;                   // the connection dropped (red dot until you join again)
  const panners = new Map();          // id -> StereoPannerNode
  const lastSpoke = new Map();        // id -> ms
  let pttHeld = false;                // in-page key, or the launcher's global key
  let externalPtt = false;
  let sending = false;
  let lastLoud = 0;
  let capturing = null;               // 'ptt' | 'range' while waiting for a key
  let reconnecting = false;
  let lastToast = null;               // { text, at } for the overlay
  let noiseActive = null;             // what really runs: off | browser | ai

  // --- login -------------------------------------------------------------------
  async function start() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      if (r.status === 401) { $('login-card').hidden = false; return; }
    } catch {
      return;
    }
    $('join-card').hidden = false;
    renderSettings();
  }

  /** The LiveKit client (600 KB), fetched only when someone joins. */
  function loadLiveKit() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LK_SRC;
      s.onload = () => (window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error('Không tải được thư viện voice.')));
      s.onerror = () => reject(new Error('Không tải được thư viện voice — kiểm tra mạng.'));
      document.head.append(s);
    });
  }

  // --- join / leave --------------------------------------------------------------
  async function join() {
    $('join').disabled = true;
    lost = false;
    setConn('warn', '◌ Đang kết nối…');
    try {
      LK = await loadLiveKit();
      const r = await fetch('/api/voice/token', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await r.json().catch(() => ({}));
      if (r.status === 404) throw new Error('Server chưa bật voice.');
      if (r.status === 429) throw new Error('Thử lại sau ít giây.');
      if (!r.ok || !body.token || !body.url) throw new Error(body.error || 'Không lấy được vé vào kênh.');
      identity = body.identity;

      // 48 kHz: the rate RNNoise works at (and Opus's own).
      try { audioCtx = new AudioContext({ sampleRate: 48000 }); } catch { audioCtx = new AudioContext(); }
      room = new LK.Room({
        autoSubscribe: false,
        adaptiveStream: false,
        dynacast: false,
        webAudioMix: { audioContext: audioCtx },
        audioCaptureDefaults: captureOptions(),
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
      $('join').hidden = true;
      $('leave').hidden = false;
      $('mic-card').hidden = false;
      $('range-card').hidden = false;
      $('peers-card').hidden = false;
      await sendRange();
      $('join-note').textContent = launcher
        ? 'Voice chạy nền: chuyển tab hay thu nhỏ launcher vẫn nói và nghe được. Ra khỏi game thì bạn tự được tắt tiếng.'
        : 'Voice chạy khi bạn chuyển sang các tab khác của trang này — đừng đóng trang. Ra khỏi game thì bạn tự được tắt tiếng.';
      await listDevices();
      poll();
    } catch (err) {
      await leave();
      setConn('bad', '✕ Không vào được kênh');
      $('join-note').textContent = micError(err);
    } finally {
      $('join').disabled = false;
      renderNav();
    }
  }

  function micError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError') return 'Bạn đã chặn quyền micro. Bấm biểu tượng ổ khoá cạnh địa chỉ trang → cho phép Micro, rồi thử lại.';
    if (name === 'NotFoundError') return 'Không tìm thấy micro nào trên máy.';
    return (err && err.message) || 'Lỗi không rõ — thử lại.';
  }

  async function leave() {
    clearTimeout(pollTimer); pollTimer = null;
    stopMeter();
    const r = room; room = null;
    if (r) await r.disconnect().catch(() => {});
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    panners.clear(); peers = new Map(); audience = []; lastSpoke.clear(); allowed = ''; inGame = null; sending = false;
    reconnecting = false; noiseActive = null; workletCtx = null;
    $('join').hidden = false; $('leave').hidden = true;
    $('mic-card').hidden = true; $('peers-card').hidden = true; $('range-card').hidden = true;
    $('game-chip').hidden = true;
    setConn('', '○ Chưa vào kênh');
    renderPeers();
    renderNav();
    renderNoise();
    pushOverlay();
  }

  // --- noise suppression ---------------------------------------------------------------
  // off: nothing · browser: the browser's own filter · ai: RNNoise (a small neural
  // network, WebAssembly in an AudioWorklet) on your mic before it is sent. It
  // runs on your machine, not on the server.
  function captureOptions() {
    return {
      echoCancellation: true, autoGainControl: true,
      noiseSuppression: settings.noise === 'browser',
      ...(settings.mic ? { deviceId: settings.mic } : {}),
    };
  }

  let nsModule = null;
  let nsWasm = null;
  let workletCtx = null;
  async function rnnoiseProcessor() {
    nsModule ??= await import(`${NS_DIR}/index.js`);
    nsWasm ??= await nsModule.loadRnnoise({ url: `${NS_DIR}/rnnoise.wasm`, simdUrl: `${NS_DIR}/rnnoise_simd.wasm` });
    if (workletCtx !== audioCtx) {
      await audioCtx.audioWorklet.addModule(`${NS_DIR}/rnnoise/workletProcessor.js`);
      workletCtx = audioCtx;
    }
    let src = null; let node = null; let dest = null;
    const processor = {
      name: 'rnnoise',
      processedTrack: undefined,
      async init(opts) {
        src = audioCtx.createMediaStreamSource(new MediaStream([opts.track]));
        node = new nsModule.RnnoiseWorkletNode(audioCtx, { wasmBinary: nsWasm, maxChannels: 1 });
        dest = audioCtx.createMediaStreamDestination();
        src.connect(node).connect(dest);
        processor.processedTrack = dest.stream.getAudioTracks()[0];
      },
      async restart(opts) { await processor.destroy(); await processor.init(opts); },
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
  async function applyNoise(restart) {
    const pub = room && room.localParticipant.getTrackPublication(LK.Track.Source.Microphone);
    const track = pub && pub.track;
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
    renderNoise();
  }

  function renderNoise() {
    for (const b of document.querySelectorAll('#page-voice .v-seg-noise button')) b.setAttribute('aria-pressed', String(b.dataset.noise === settings.noise));
    const el = $('noise-note');
    if (!el) return;
    if (!room) { el.textContent = 'Áp dụng khi bạn vào kênh.'; return; }
    el.textContent = {
      off: 'Không lọc — tiếng ồn quanh bạn (quạt, bàn phím) đi thẳng vào voice.',
      browser: settings.noise === 'ai'
        ? 'Máy này không chạy được bộ lọc AI — đang dùng bộ lọc của trình duyệt.'
        : 'Bộ lọc có sẵn của trình duyệt: nhẹ, lọc được tiếng ồn đều (quạt, điều hoà).',
      ai: 'Đang lọc bằng AI (RNNoise) ngay trên máy bạn: lọc cả tiếng bàn phím, chuột, tiếng ồn nền — giọng vẫn rõ.',
    }[noiseActive] || '';
  }

  // --- the launcher's in-game overlay ---------------------------------------------------------
  let overlaySent = '';
  let overlayTimer = null;
  /** What the overlay shows, sent when it changes (at most ~8 times a second). */
  function pushOverlay() {
    if (!launcher || !launcher.overlayState || overlayTimer !== null) return;
    overlayTimer = setTimeout(() => {
      overlayTimer = null;
      const now = Date.now();
      const speakers = [...peers.values()]
        .filter((p) => now - (lastSpoke.get(p.id) || 0) < RECENT_MS)
        .map((p) => ({
          name: p.name || null, gain: p.gain, pan: p.pan,
          speaking: Boolean(room && [...room.activeSpeakers].some((s) => s.identity === p.id)),
        }))
        .sort((a, b) => Number(b.speaking) - Number(a.speaking) || b.gain - a.gain);
      const state = {
        connected: room !== null, lost, phase: reconnecting ? 'reconnecting' : 'ok', inGame,
        talking: sending, mode: settings.mode, pttLabel: launcher.pttLabel(),
        range: settings.range, rangeName: RANGE_NAMES[settings.range], nameMode, speakers, toast: lastToast,
      };
      const json = JSON.stringify(state);
      if (json === overlaySent) return;
      overlaySent = json;
      launcher.overlayState(state);
    }, 120);
  }

  function wireRoom(r) {
    const E = LK.RoomEvent;
    r.on(E.TrackPublished, () => applyPeers());
    r.on(E.ParticipantConnected, () => applyPeers());
    r.on(E.TrackSubscribed, (track, _pub, participant) => {
      if (track.kind !== 'audio') return;
      track.attach();                                     // web audio mix: the element stays muted
      const pan = audioCtx.createStereoPanner();
      panners.set(participant.identity, pan);
      track.setWebAudioPlugins([pan]);
      applyPeers();
    });
    r.on(E.TrackUnsubscribed, (track, _pub, participant) => {
      track.detach();
      panners.delete(participant.identity);
    });
    r.on(E.ActiveSpeakersChanged, (speakers) => {
      const now = Date.now();
      for (const s of speakers) if (s.identity !== identity) lastSpoke.set(s.identity, now);
      renderPeers();
      pushOverlay();
    });
    r.on(E.Reconnecting, () => { reconnecting = true; setConn('warn', '◌ Mất kết nối, đang nối lại…'); renderNav('reconnecting'); pushOverlay(); });
    r.on(E.Reconnected, () => { reconnecting = false; allowed = ''; setConn('good', '● Đã vào kênh'); applyPeers(); renderNav(); pushOverlay(); });
    r.on(E.Disconnected, async (reason) => {
      if (room !== r) return;
      await leave();
      lost = true;
      const R = LK.DisconnectReason || {};
      if (reason === R.DUPLICATE_IDENTITY) {
        setConn('bad', '✕ Tài khoản này vừa vào voice ở nơi khác');
        $('join-note').textContent = 'Mỗi tài khoản Steam chỉ ở trong voice một nơi: bạn vừa vào kênh bằng tab / máy / launcher khác nên phiên này bị thay thế.';
      } else if (reason === R.PARTICIPANT_REMOVED) {
        setConn('bad', '✕ Admin đã đưa bạn ra khỏi kênh voice');
      } else {
        setConn('bad', '✕ Đã mất kết nối — bấm vào lại');
      }
      renderNav();
    });
    r.on(E.AudioPlaybackStatusChanged, () => {
      if (!r.canPlaybackAudio) $('join-note').textContent = 'Trình duyệt đang chặn âm thanh — bấm vào bất kỳ đâu trên trang.';
    });
  }
  document.addEventListener('click', () => { if (room && !room.canPlaybackAudio) room.startAudio().catch(() => {}); });

  // --- who is near (server) --------------------------------------------------------
  async function poll() {
    if (!room) return;
    try {
      const r = await fetch('/api/voice', { credentials: 'same-origin' });
      if (r.ok) {
        const v = await r.json();
        inGame = v.inGame === true;
        nameMode = ['name', 'id', 'none'].includes(v.nameMode) ? v.nameMode : 'name';
        peers = new Map((Array.isArray(v.peers) ? v.peers : []).map((p) => [p.id, p]));
        audience = Array.isArray(v.audience) ? v.audience.filter((id) => typeof id === 'string') : [];
      } else if (r.status === 401) {
        await leave(); location.reload(); return;
      }
    } catch { /* keep the last list for a moment; the next poll decides */ }
    applyPeers();
    renderGame();
    renderPeers();
    renderNav();
    pushOverlay();
    pollTimer = setTimeout(poll, POLL_MS);
  }

  /** Subscribe to the people near, set their volume and side; drop everyone else. */
  function applyPeers() {
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

  // --- range: buttons, and a key that cycles it (` by default) ---------------------------
  /** Tell the server how far our voice carries (it decides who may hear us). */
  async function sendRange() {
    try {
      const r = await fetch('/api/voice/range', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ range: settings.range }) });
      $('range-note').textContent = r.ok
        ? `Người trong ${settings.range} m nghe thấy bạn. Càng gần càng to; ra tới mép tầm thì nhỏ dần rồi tắt.`
        : 'Không đổi được tầm — thử lại sau ít giây.';
    } catch {
      $('range-note').textContent = 'Không đổi được tầm — kiểm tra mạng.';
    }
  }

  function setRange(range, announce) {
    settings.range = range;
    save();
    renderSettings();
    if (room) sendRange();
    if (announce) {
      const text = `Tầm giọng: ${range} m — ${RANGE_NAMES[range]}`;
      beep(RANGES.indexOf(range) + 1);
      toast(text);
      lastToast = { text, at: Date.now() };
    }
    pushOverlay();
  }

  function cycleRange() {
    setRange(RANGES[(RANGES.indexOf(settings.range) + 1) % RANGES.length], true);
  }

  /** 1–4 short beeps = the range step, so you know it changed while in game. */
  function beep(count) {
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

  let toastTimer = null;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // --- microphone: voice activation / push-to-talk / off -------------------------------
  function startMeter() {
    const pub = room.localParticipant.getTrackPublication(LK.Track.Source.Microphone);
    const track = pub && pub.track && pub.track.mediaStreamTrack;
    if (!track) return;
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
      if (inGame === false) want = false;
      setSending(want);
      const pct = Math.max(0, Math.min(100, ((db + 80) / 60) * 100));
      $('lvl').style.width = `${pct}%`;
      $('lvl').classList.toggle('open', want);
    }, 50);
  }

  function stopMeter() {
    clearInterval(meterTimer); meterTimer = null;
    if (analyserSrc) analyserSrc.disconnect();
    if (micClone) micClone.stop();
    analyserSrc = null; micClone = null;
  }

  function setSending(on) {
    if (!room) return;
    const pub = room.localParticipant.getTrackPublication(LK.Track.Source.Microphone);
    if (pub && pub.track) {
      if (on && pub.isMuted) pub.unmute().catch(() => {});
      if (!on && !pub.isMuted) pub.mute().catch(() => {});
    }
    if (on === sending) return;
    sending = on;
    renderTalk();
  }

  function renderTalk() {
    pushOverlay();
    $('talk').classList.toggle('on', sending);
    $('talk-text').textContent = sending ? 'Đang phát tiếng' : (settings.mode === 'off' ? 'Mic đang tắt' : 'Đang im lặng');
  }

  // --- keys: in the page (browser), or global (launcher) -------------------------------------
  function keyName(code) {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return { Space: 'Space', CapsLock: 'Caps Lock', Backquote: '` ~', ShiftLeft: 'Shift trái', ControlLeft: 'Ctrl trái', AltLeft: 'Alt trái' }[code] || code;
  }
  const typing = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;

  document.addEventListener('keydown', (e) => {
    if (launcher) return;             // the launcher's global keys do it, in game too
    if (capturing !== null) {
      e.preventDefault();
      if (e.code !== 'Escape') settings[capturing === 'ptt' ? 'pttCode' : 'rangeCode'] = e.code;
      save();
      capturing = null;
      renderSettings();
      return;
    }
    if (typing(e) || e.repeat) return;
    if (e.code === settings.pttCode) pttHeld = true;
    if (e.code === settings.rangeCode && room) { e.preventDefault(); cycleRange(); }
  });
  document.addEventListener('keyup', (e) => { if (!launcher && e.code === settings.pttCode) pttHeld = false; });
  window.addEventListener('blur', () => { pttHeld = false; });
  if (launcher) {
    launcher.onPushToTalk((held) => { externalPtt = held === true; });
    if (launcher.onRangeKey) launcher.onRangeKey(() => { if (room) cycleRange(); });
  }

  // --- devices ---------------------------------------------------------------------------
  async function listDevices() {
    const fill = async (sel, kind, current) => {
      const list = await LK.Room.getLocalDevices(kind).catch(() => []);
      sel.replaceChildren(...list.map((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || `${kind === 'audioinput' ? 'Micro' : 'Loa'} ${i + 1}`;
        o.selected = d.deviceId === current;
        return o;
      }));
      return list.length;
    };
    await fill($('mic-dev'), 'audioinput', settings.mic || (room && room.getActiveDevice('audioinput')));
    // Choosing the output needs setSinkId (Chrome/Edge, the launcher); hide it elsewhere.
    const canPickOut = typeof AudioContext.prototype.setSinkId === 'function';
    $('out-field').hidden = !canPickOut || (await fill($('out-dev'), 'audiooutput', settings.out)) === 0;
  }
  if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => { if (room) listDevices(); });

  // --- rendering ---------------------------------------------------------------------------
  function setConn(kind, text) {
    const c = $('conn-chip');
    c.className = `v-chip ${kind}`;
    c.textContent = text;
  }

  /** The dot next to "Voice gần" in the menu: green = working, amber = needs you, red = dropped. */
  function renderNav(phase) {
    const dot = document.getElementById('nav-voice-dot');
    if (!dot) return;
    let kind = null; let text = '';
    if (phase === 'reconnecting') { kind = 'warn'; text = 'Voice: đang nối lại'; }
    else if (room && inGame) { kind = 'ok'; text = 'Voice đang hoạt động'; }
    else if (room) { kind = 'warn'; text = 'Voice: đã vào kênh, chưa vào game'; }
    else if (lost) { kind = 'bad'; text = 'Voice: mất kết nối'; }
    dot.hidden = kind === null;
    dot.className = `nav-voice-dot ${kind || ''}`;
    dot.title = text;
    dot.setAttribute('aria-label', text);
  }

  function renderGame() {
    const c = $('game-chip');
    c.hidden = inGame === null;
    if (inGame) { c.className = 'v-chip good'; c.textContent = '▲ Đang trong game'; }
    else { c.className = 'v-chip warn'; c.textContent = '! Chưa vào game — không ai nghe thấy bạn'; }
  }

  function renderSettings() {
    for (const b of document.querySelectorAll('#page-voice .v-seg-mode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === settings.mode));
    for (const b of document.querySelectorAll('#page-voice .v-seg-range button')) b.setAttribute('aria-pressed', String(Number(b.dataset.range) === settings.range));
    $('thr-field').hidden = settings.mode !== 'vad';
    $('ptt-field').hidden = settings.mode !== 'ptt';
    $('thr').hidden = settings.mode !== 'vad';
    $('threshold').value = String(settings.threshold);
    $('thr').style.left = `${((settings.threshold + 80) / 60) * 100}%`;
    $('master').value = String(settings.master);
    const pttLabel = launcher ? launcher.pttLabel() : keyName(settings.pttCode);
    const rangeLabel = launcher && launcher.rangeLabel ? launcher.rangeLabel() : keyName(settings.rangeCode);
    const waiting = 'bấm một phím hoặc nút chuột…';
    $('ptt-key-name').textContent = capturing === 'ptt' ? waiting : pttLabel;
    $('range-key-name').textContent = capturing === 'range' ? waiting : rangeLabel;
    if (launcher) {
      $('ptt-hint').textContent = 'Phím nói — dùng được cả khi đang trong game';
      $('range-hint').textContent = `Bấm ${rangeLabel} (cả khi đang trong game) để đổi tầm: 15 → 30 → 60 → 90 m. Nghe tiếng bíp: 1 bíp = 15 m … 4 bíp = 90 m.`;
    } else {
      $('range-hint').textContent = `Bấm ${rangeLabel} để đổi tầm: 15 → 30 → 60 → 90 m (1–4 tiếng bíp). Trên web chỉ khi trang này đang được chọn.`;
    }
    $('mode-help').textContent = { vad: 'phát khi bạn nói to hơn vạch vàng', ptt: `giữ ${pttLabel} để nói`, off: 'không ai nghe thấy bạn' }[settings.mode];
    renderTalk();
  }

  const ICON_MIC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

  function renderPeers() {
    const now = Date.now();
    const list = [...peers.values()].filter((p) => now - (lastSpoke.get(p.id) || 0) < RECENT_MS);
    const ul = $('peers');
    ul.replaceChildren(...list.map((p) => {
      const speaking = room && [...room.activeSpeakers].some((s) => s.identity === p.id);
      const pref = person(p.id);
      const li = document.createElement('li');
      li.className = `v-peer${speaking ? ' speaking' : ''}`;
      const ico = document.createElement('span');
      ico.className = 'ico';
      ico.innerHTML = ICON_MIC;
      const who = document.createElement('div');
      const nm = document.createElement('div');
      nm.className = 'name';
      // The server decides what may be shown (panel admin → Voice): a name, a tag, or nothing.
      nm.textContent = nameMode === 'none' ? 'Có người đang nói' : (p.name || 'Người chơi');
      const d = document.createElement('div');
      d.className = 'dist';
      d.textContent = `${speaking ? 'Đang nói' : 'Vừa nói'} · ${p.gain >= 0.8 ? 'rất gần' : p.gain >= 0.4 ? 'gần' : 'xa'}${Math.abs(p.pan) >= 0.5 ? (p.pan > 0 ? ' · bên phải' : ' · bên trái') : ''}`;
      who.append(nm, d);
      const vol = document.createElement('input');
      vol.type = 'range'; vol.min = '0'; vol.max = '200'; vol.step = '10'; vol.value = String(pref.vol);
      vol.setAttribute('aria-label', 'Âm lượng người này');
      vol.addEventListener('input', () => { settings.people[p.id] = { ...person(p.id), vol: Number(vol.value) }; save(); applyPeers(); });
      const mute = document.createElement('button');
      mute.type = 'button'; mute.className = 'btn btn-ghost mute';
      mute.setAttribute('aria-pressed', String(pref.muted));
      mute.textContent = pref.muted ? 'Đã tắt tiếng' : 'Tắt tiếng';
      mute.addEventListener('click', () => { settings.people[p.id] = { ...person(p.id), muted: !pref.muted }; save(); applyPeers(); renderPeers(); });
      li.append(ico, who, vol, mute);
      return li;
    }));
    $('peers-empty').hidden = list.length > 0;
    $('peers-empty').textContent = inGame === false ? 'Vào game để nghe người chơi ở gần.' : 'Chưa có ai nói gần bạn.';
  }
  // Re-render now and then, so "vừa nói" fades out.
  setInterval(() => { if (room) renderPeers(); }, 2000);

  // --- controls ---------------------------------------------------------------------------
  $('join').addEventListener('click', join);
  $('leave').addEventListener('click', leave);
  for (const b of document.querySelectorAll('#page-voice .v-seg-mode button')) {
    b.addEventListener('click', () => { settings.mode = b.dataset.mode; save(); renderSettings(); });
  }
  for (const b of document.querySelectorAll('#page-voice .v-seg-noise button')) {
    b.addEventListener('click', async () => {
      settings.noise = b.dataset.noise; save(); renderNoise();
      if (room) await applyNoise(true);
    });
  }
  for (const b of document.querySelectorAll('#page-voice .v-seg-range button')) {
    b.addEventListener('click', () => setRange(Number(b.dataset.range), false));
  }
  $('threshold').addEventListener('input', (e) => { settings.threshold = Number(e.target.value); save(); renderSettings(); });
  $('master').addEventListener('input', (e) => { settings.master = Number(e.target.value); save(); applyPeers(); });
  const captureKey = async (which) => {
    capturing = which; renderSettings();
    if (launcher) {
      const r = await (which === 'ptt' ? launcher.capturePttKey() : launcher.captureRangeKey());
      capturing = null; renderSettings();
      if (r && r.error) $(which === 'ptt' ? 'ptt-key-name' : 'range-key-name').textContent = r.error;   // already used by another key
    }
  };
  $('ptt-key').addEventListener('click', () => captureKey('ptt'));
  $('range-key').addEventListener('click', () => captureKey('range'));
  $('mic-dev').addEventListener('change', async (e) => {
    settings.mic = e.target.value; save();
    if (!room) return;
    await room.switchActiveDevice('audioinput', settings.mic).catch(() => {});
    stopMeter(); startMeter();
  });
  $('out-dev').addEventListener('change', async (e) => {
    settings.out = e.target.value; save();
    if (room) await room.switchActiveDevice('audiooutput', settings.out).catch(() => {});
  });

  // For the launcher's tray (and tests): what voice is doing now.
  window.isleVoice = {
    setPushToTalk(held) { externalPtt = held === true; },
    status() {
      const subscribed = [];
      if (room) {
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.audioTrackPublications.values()) if (pub.isSubscribed) subscribed.push(p.name || p.identity);
        }
      }
      return {
        connected: room !== null, inGame, sending, mode: settings.mode, range: settings.range, nameMode, noise: noiseActive,
        near: [...peers.values()].map((p) => ({ name: p.name, gain: p.gain, pan: p.pan })),
        subscribed,
      };
    },
  };

  renderNoise();
  start();
})();
