import { useEffect, useRef } from 'react';
import { Select, Slider } from '@isle/ui';
import { inLauncher } from '../../lib/launcher';
import {
  RANGES, captureKey, join, keyLabels, leaveByUser, onLevel, setMaster, setMic, setMode, setNoise, setOut, setPeerVol, setRange, setThreshold,
  toggleTest, togglePeerMute, useVoice, type Mode, type Noise, type PeerView,
} from '../../lib/voice';

const RANGE_TEXT: Record<number, string> = { 15: 'Thì thầm', 30: 'Nói thường', 60: 'Nói to', 90: 'Hét' };
const ICON_MIC = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);

/** The mic level bar: drawn from the engine's meter (20 a second) straight into the element, not a page redraw. */
function Meter({ threshold, vad }: { threshold: number; vad: boolean }) {
  const lvl = useRef<HTMLDivElement>(null);
  useEffect(() => onLevel((l) => {
    if (!lvl.current) return;
    lvl.current.style.width = `${l.pct}%`;
    lvl.current.classList.toggle('open', l.open);
  }), []);
  return (
    <div className="v-meter" aria-hidden="true">
      <div className="lvl" id="v-lvl" ref={lvl} />
      <div className="thr" id="v-thr" hidden={!vad} style={{ left: `${((threshold + 80) / 60) * 100}%` }} />
    </div>
  );
}

function PeerRow({ p, nameMode }: { p: PeerView; nameMode: string }) {
  const near = p.gain >= 0.8 ? 'rất gần' : p.gain >= 0.4 ? 'gần' : 'xa';
  const side = Math.abs(p.pan) >= 0.5 ? (p.pan > 0 ? ' · bên phải' : ' · bên trái') : '';
  return (
    <li className={`v-peer${p.speaking ? ' speaking' : ''}`}>
      <span className="ico">{ICON_MIC}</span>
      <div>
        {/* The server decides what may be shown (panel admin → Voice): a name, a tag, or nothing. */}
        <div className="name">{nameMode === 'none' ? 'Có người đang nói' : (p.name || 'Người chơi')}</div>
        <div className="dist">{`${p.speaking ? 'Đang nói' : 'Vừa nói'} · ${near}${side}`}</div>
      </div>
      <Slider aria-label="Âm lượng người này" min={0} max={200} step={10} value={p.vol} onChange={(v) => setPeerVol(p.id, v)} />
      <button type="button" className="btn btn-ghost mute" aria-pressed={p.muted} onClick={() => togglePeerMute(p.id)}>{p.muted ? 'Đã tắt tiếng' : 'Tắt tiếng'}</button>
    </li>
  );
}

/**
 * Voice (#voice): join the proximity room, how far your voice carries, the micro (voice activation /
 * push-to-talk / off, noise filter, devices, a self test), who speaks near you. The room itself is the
 * engine's (lib/voice.ts): it stays joined on every page.
 */
export function Voice() {
  const v = useVoice();
  const s = v.settings;
  const keys = keyLabels();
  const launcher = inLauncher();
  const waiting = 'bấm một phím hoặc nút chuột…';
  const keyText = (which: 'ptt' | 'range' | 'mute'): string => (v.capturing === which ? waiting
    : v.captureError?.which === which ? v.captureError.text : keys[which] ?? '');
  const rangeHint = launcher
    ? `Bấm ${keys.range} (cả khi đang trong game) để đổi tầm: 15 → 30 → 60 → 90 m. Nghe tiếng bíp: 1 bíp = 15 m … 4 bíp = 90 m.`
    : `Bấm ${keys.range} để đổi tầm: 15 → 30 → 60 → 90 m (1–4 tiếng bíp). Trên web chỉ khi trang này đang được chọn.`;
  const modeHelp = { vad: 'phát khi bạn nói to hơn vạch vàng', ptt: `giữ ${keys.ptt} để nói`, off: 'không ai nghe thấy bạn' }[s.mode];
  const talkText = v.sending ? 'Đang phát tiếng' : (s.mode === 'off' ? 'Mic đang tắt' : 'Đang im lặng');
  return (
    <>
      <div className="card" id="v-login-card" hidden={v.loggedIn !== false}>
        <div className="card-header"><h2 className="card-title">🎙️ Đăng nhập để dùng voice</h2></div>
        <p className="card-subtitle">Voice gắn với tài khoản Steam bạn dùng trong game: bạn nghe và được nghe bởi những người ở gần dino của bạn.</p>
        <p style={{ margin: '14px 0 0' }}><a className="btn btn-steam" href="/auth/steam?next=voice">Đăng nhập bằng Steam</a></p>
      </div>

      <div className="card" id="v-join-card" hidden={v.loggedIn !== true}>
        <div className="card-header"><h2 className="card-title">🎙️ Kênh voice gần</h2></div>
        <div className="v-join-row">
          <button type="button" className="btn btn-emerald btn-big" id="v-join" hidden={v.connected} disabled={v.joining} onClick={() => { void join(); }}>Vào kênh voice</button>
          <button type="button" className="btn btn-danger btn-big" id="v-leave" hidden={!v.connected} onClick={() => { void leaveByUser(); }}>Rời kênh</button>
          {/* The launcher remembers the room: waiting for the game to join again by itself (lib/voice.ts). */}
          {v.autoWaiting && !v.connected && <button type="button" className="btn btn-ghost" id="v-auto-cancel" onClick={() => { void leaveByUser(); }}>Rời kênh (thôi tự vào)</button>}
          <div className="v-chips">
            <span className={`v-chip ${v.conn.kind}`} id="v-conn-chip">{v.conn.text}</span>
            <span className={`v-chip ${v.inGame ? 'good' : 'warn'}`} id="v-game-chip" hidden={v.inGame === null}>
              {v.inGame ? '▲ Đang trong game' : '! Chưa vào game: không ai nghe thấy bạn'}
            </span>
          </div>
        </div>
        <p className="v-note" id="v-join-note">{v.joinNote}</p>
      </div>

      <div className="card" id="v-range-card" hidden={!v.connected}>
        <div className="card-header">
          <h2 className="card-title">Tầm giọng nói</h2>
          <span className="card-subtitle">ai ở trong tầm này mới nghe thấy bạn</span>
        </div>
        <div className="v-seg v-seg-range" role="group" aria-label="Tầm giọng nói">
          {RANGES.map((r) => (
            <button key={r} type="button" data-range={r} aria-pressed={s.range === r} onClick={() => setRange(r, false)}><b>{r} m</b> {RANGE_TEXT[r]}</button>
          ))}
        </div>
        <div className="v-keys">
          <button type="button" className="btn btn-ghost" id="v-range-key" onClick={() => { void captureKey('range'); }}>Phím đổi tầm: <kbd id="v-range-key-name">{keyText('range')}</kbd></button>
          <span id="v-range-hint">{rangeHint}</span>
        </div>
        <p className="v-note" id="v-range-note">{v.rangeNote}</p>
      </div>

      <div className="card" id="v-mic-card" hidden={!v.connected}>
        <div className="card-header">
          <h2 className="card-title">Micro</h2>
          <span className="card-subtitle" id="v-mode-help">{modeHelp}</span>
        </div>
        <div className="v-seg v-seg-mode" role="group" aria-label="Chế độ micro">
          {([['vad', 'Tự nhận giọng'], ['ptt', 'Giữ phím để nói'], ['off', 'Tắt mic']] as Array<[Mode, string]>).map(([m, text]) => (
            <button key={m} type="button" data-mode={m} aria-pressed={s.mode === m} onClick={() => setMode(m)}>{text}</button>
          ))}
        </div>
        {keys.mute !== null && (
          // The launcher's micro key (1.0.38+): off / on in game too, back to the mode it was in.
          <div className="v-keys" id="v-mute-keys">
            <button type="button" className="btn btn-ghost" id="v-mute-key" onClick={() => { void captureKey('mute'); }}>Phím tắt / bật mic: <kbd id="v-mute-key-name">{keyText('mute')}</kbd></button>
            <span id="v-mute-hint">Bấm {keys.mute} (cả khi đang trong game) để tắt mic, bấm lần nữa để bật lại như cũ.</span>
          </div>
        )}
        <div className="v-subhead">Khử tiếng ồn</div>
        <div className="v-seg v-seg-noise" role="group" aria-label="Khử tiếng ồn">
          {([['off', 'Tắt'], ['browser', 'Cơ bản'], ['ai', 'Mạnh (AI)']] as Array<[Noise, string]>).map(([n, text]) => (
            <button key={n} type="button" data-noise={n} aria-pressed={s.noise === n} onClick={() => { void setNoise(n); }}>{text}</button>
          ))}
        </div>
        <p className="v-note" id="v-noise-note" style={{ marginTop: 6 }}>{v.noiseNote}</p>
        <Meter threshold={s.threshold} vad={s.mode === 'vad'} />
        <div className={`v-talk${v.sending ? ' on' : ''}`} id="v-talk"><span className="dot" /><span id="v-talk-text">{talkText}</span></div>
        <div className="v-grid">
          <label className="v-field" id="v-thr-field" hidden={s.mode !== 'vad'}>Độ nhạy (vạch vàng: nói to hơn vạch thì mới phát)
            <Slider id="v-threshold" min={-80} max={-20} step={1} value={s.threshold} onChange={setThreshold} />
          </label>
          <div className="v-field" id="v-ptt-field" hidden={s.mode !== 'ptt'}>
            <span id="v-ptt-hint">{launcher ? 'Phím nói: dùng được cả khi đang trong game'
              : 'Phím nói (trên web chỉ khi trang này đang được chọn. Dùng Xóm Gáy Launcher để nói cả khi đang trong game)'}</span>
            <button type="button" className="btn btn-ghost" id="v-ptt-key" onClick={() => { void captureKey('ptt'); }}>Phím: <kbd id="v-ptt-key-name">{keyText('ptt')}</kbd> (bấm để đổi)</button>
          </div>
          <label className="v-field">Âm lượng nghe
            <Slider id="v-master" min={0} max={150} step={5} value={s.master} onChange={setMaster} />
          </label>
          <label className="v-field">Micro
            <Select id="v-mic-dev" aria-label="Micro" value={v.micNow || (v.mics[0]?.id ?? null)} options={v.mics.map((d) => ({ value: d.id, label: d.label }))}
              placeholder="" onChange={(id) => { void setMic(id); }} />
          </label>
          <label className="v-field" id="v-out-field" hidden={!v.outField}>Loa / tai nghe
            <Select id="v-out-dev" aria-label="Loa / tai nghe" value={s.out || (v.outs[0]?.id ?? null)} options={v.outs.map((d) => ({ value: d.id, label: d.label }))}
              placeholder="" onChange={(id) => { void setOut(id); }} />
          </label>
        </div>
        {/* Speak and hear yourself back at once, on the micro and output picked above */}
        <div className="v-keys">
          <button type="button" className={`btn btn-ghost${v.test.on ? ' btn-emerald' : ''}`} id="v-test" disabled={v.test.busy} onClick={toggleTest}>{v.test.on ? '⏹ Tắt thử âm thanh' : '🎧 Thử âm thanh'}</button>
          <span className="v-note" id="v-test-note" style={{ margin: 0 }}>{v.test.note}</span>
        </div>
      </div>

      <div className="card" id="v-peers-card" hidden={!v.connected}>
        <div className="card-header"><h2 className="card-title">Đang nói gần bạn</h2></div>
        <ul className="v-peers" id="v-peers">{v.peers.map((p) => <PeerRow key={p.id} p={p} nameMode={v.nameMode} />)}</ul>
        <p className="v-empty" id="v-peers-empty" hidden={v.peers.length > 0}>{v.inGame === false ? 'Vào game để nghe người chơi ở gần.' : 'Chưa có ai nói gần bạn.'}</p>
      </div>
      <div className="v-toast" id="v-toast" role="status" hidden={!v.toast}>{v.toast}</div>
    </>
  );
}
