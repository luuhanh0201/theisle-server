import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox, ColorInput, NumberInput, Select, Slider } from '@isle/ui';
import type { PlayerMe } from '@isle/api';
import { PRESETS, REGIONS, hex, injectCss, type LinearColor } from '@portal/skin-editor';
import { ERROR_VI, waitCommand } from '../../lib/commands';
import { dino3dNow } from '../../lib/dino3d';
import { isLab } from '../../lib/lab';
import {
  EFFECTS, GLOW_MAX, applySkin, editorSkin, initialState, loadSaved, parseSkinCode, skinBody, skinCode, speciesLabel, storeSaved, withSaved,
  type EditorState, type SavedSkin, type SkinIn,
} from './skin';
import { useSkinViewer } from './useSkinViewer';

type Status = { kind: '' | 'ok' | 'bad'; text: string } | null;
type GameSkin = { colors?: Record<string, LinearColor>; female?: boolean; patternIndex?: number; themeIndex?: number; variation?: number };

/** "#rrggbb" typed: taken once it is a full colour. */
const typedHex = (v: string): string | null => { const m = /^#?([0-9a-f]{6})$/.exec(v.trim().toLowerCase()); return m ? `#${m[1]}` : null; };

/** One region (skin-editor.js mountRegions, the same classes): its colour box, its name, its hex code. */
function Region({ id, label, value, off, onColor }: { id: string; label: string; value: string; off: boolean; onColor: (hex: string) => void }) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(value); }, [value, focus]);
  const bad = typedHex(text) === null && text.trim().length >= 6;
  return (
    <div className={`se-region${off ? ' off' : ''}`} data-region={id}>
      <label className="se-row">
        <ColorInput id={`picker-${id}`} aria-label={label} value={value} size={{ width: 26, height: 26 }} onChange={onColor} />
        <span className="se-name">{label}</span>
        <input type="text" className={`se-hex${bad ? ' bad' : ''}`} id={`hex-${id}`} maxLength={7} spellCheck={false} aria-label={`${label} (mã hex)`} value={text}
          onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); setText(value); }}
          onChange={(e) => { setText(e.target.value); const h = typedHex(e.target.value); if (h) onColor(h); }} />
      </label>
    </div>
  );
}

/**
 * Skin Studio (#skin): colours per region, pattern / theme / variation, the preview (the 3D model when
 * the server has it, else the colours side by side), "apply" onto the dino played now (POST /api/skin →
 * the game), the skin code, the palettes, skins saved in this browser; in lab the effects and the
 * colours kept for the next times.
 */
export function SkinStudio({ me }: { me: PlayerMe | null | undefined }) {
  const lab = isLab();
  const [st, setSt] = useState<EditorState>(initialState);
  const [female, setFemale] = useState(false);
  const [keep, setKeep] = useState(true);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saved, setSaved] = useState<SavedSkin[]>(loadSaved);
  const [preset, setPreset] = useState<number | null>(null);
  useEffect(() => { injectCss(); }, []);

  const sk = useMemo(() => editorSkin(st), [st]);
  const put = (skin: SkinIn): void => setSt((s) => applySkin(s, skin));

  const host = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const dino = me?.online && me.dino ? me.dino : null;
  const gameSkin = (dino?.skin ?? null) as GameSkin | null;
  const live = useMemo(() => (dino?.species ? { species: dino.species, female: gameSkin?.female } : null), [dino?.species, gameSkin?.female]);
  const onLiveFemale = useCallback((f: boolean) => setFemale(f), []);
  const view = useSkinViewer({ host, note, skin: sk, female, live, onLiveFemale });

  const say = (kind: '' | 'ok' | 'bad', text: string): void => setStatus({ kind, text });

  const send = async (): Promise<void> => {
    if (busy) return;
    if (!me?.dino) { say('bad', 'Vào game và điều khiển một con dino để áp dụng. Bạn vẫn chỉnh và xem trước được.'); return; }
    setBusy(true);
    say('', 'Đang gửi…');
    try {
      const r = await fetch('/api/skin', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(skinBody(sk, lab, keep)),
      });
      const res = await r.json().catch(() => null) as { id?: unknown; error?: string } | null;
      if (r.status === 429) { say('bad', 'Chậm lại chút: mỗi vài giây chỉ một lần.'); return; }
      if (r.status !== 202 || typeof res?.id !== 'number') { say('bad', `Không gửi được${res?.error ? `: ${res.error}` : ''}.`); return; }
      say('', 'Đã gửi, chờ game đổi màu…');
      const done = await waitCommand(res.id, 20, (b) => b?.status === 'done');
      if (done === null) { say('bad', 'Chưa thấy game trả lời. Thử lại sau ít phút.'); return; }
      const msgs = (done.messages ?? []).join(' ');
      if (!done.ok) {
        const err = done.error ? ERROR_VI[done.error] ?? done.error : '';
        say('bad', `❌ ${msgs || err || 'Game không đổi được màu.'}`);
        return;
      }
      say('ok', `✅ ${msgs || 'Đã đổi màu dino.'} Nhìn lại dino trong game.`);
    } catch {
      say('bad', 'Mất kết nối, thử lại.');
    } finally {
      setBusy(false);
    }
  };

  const loadMine = (): void => {
    const g = me?.dino?.skin as GameSkin | null | undefined;
    if (!g?.colors) { say('bad', 'Chưa có dữ liệu skin của dino đang chơi. Hãy vào game và điều khiển dino.'); return; }
    // Through fromGame: a region the species does not use (0, 0, 0 in game) gets a stand-in, not black.
    const v = dino3dNow()?.fromGame(g) as SkinIn | null | undefined;
    put(v ? { ...v, pattern: g.patternIndex, theme: g.themeIndex, variation: g.variation } : g);
    say('', 'Đã lấy màu từ dino đang chơi.');
  };

  // The colours kept for the next times (/api/me keptSkins), with a way to stop keeping them.
  const kept = (me?.keptSkins ?? {}) as Record<string, { colors?: Record<string, LinearColor> } | undefined>;
  const keptKey = JSON.stringify(me?.keptSkins ?? {});
  const [forgot, setForgot] = useState<{ key: string; gone: string[]; busy: string[] }>({ key: '', gone: [], busy: [] });
  const fg = forgot.key === keptKey ? forgot : { key: keptKey, gone: [], busy: [] };
  const keptNames = Object.keys(kept).filter((sp) => !fg.gone.includes(sp));
  const forget = async (sp: string): Promise<void> => {
    setForgot({ ...fg, busy: [...fg.busy, sp] });
    const r = await fetch('/api/skin', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forget: sp }) }).catch(() => null);
    if (r?.ok) {
      setForgot((f) => ({ key: keptKey, gone: [...(f.key === keptKey ? f.gone : []), sp], busy: [] }));
      say('', 'Đã bỏ giữ màu cho loài đó.');
    } else setForgot((f) => ({ ...f, key: keptKey, busy: f.busy.filter((b) => b !== sp) }));
  };

  const speciesOptions = view.names === null ? [{ value: '', label: 'Đang tải…' }]
    : view.names.length === 0 ? [{ value: '', label: '-' }]
    : view.names.map((n) => ({ value: n, label: `${n}${n === view.liveName ? ' · đang chơi' : ''}` }));
  const swatches = dino && gameSkin?.colors ? REGIONS.filter(([k]) => gameSkin.colors?.[k]) : null;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">🎨 Chỉnh màu dino</h3>
          <span className="card-subtitle">Phối màu từng vùng, xem trước, rồi áp thẳng vào dino bạn đang chơi trong game.</span>
        </div>
        <div>
          <button type="button" className="btn btn-ghost" id="btn-load-my-skin" style={{ fontSize: 12, padding: '6px 12px' }} onClick={loadMine}>
            Lấy màu từ dino đang chơi
          </button>
        </div>
      </div>

      <div className="skin-layout">
        <div className="skin-main">
          {/* Preview: the 3D model when the server has it, else the colours side by side */}
          <div className="skin-preview" id="skin-preview">
            <div className="skin-preview-3d" id="skin-3d" ref={host} hidden={!view.shown} />
            <div className="skin-preview-flat" id="skin-flat" hidden={view.shown}>
              {REGIONS.map(([id, label]) => <div key={id} style={{ background: sk.colors[id] }}>{label}</div>)}
            </div>
            {/* Its text is the viewer's (skin3d.js writes it). */}
            <span className="skin-preview-note muted" id="skin-preview-note" ref={note} />
          </div>
          <div className="skin-controls">
            <div className="skin-field"><span>Loài</span>
              <Select aria-label="Loài" value={view.chosen ?? ''} options={speciesOptions} onChange={(v) => view.pick(v)} />
            </div>
            <div className="skin-field"><span>Giới tính</span>
              <div className="xseg" id="skin-gender" role="radiogroup">
                {([['m', '♂ Đực'], ['f', '♀ Cái']] as const).map(([g, text]) => {
                  const on = (g === 'f') === female;
                  return <button key={g} type="button" data-g={g} role="radio" aria-checked={on} className={on ? 'on' : undefined} onClick={() => setFemale(g === 'f')}>{text}</button>;
                })}
              </div>
            </div>
            <label title="Kiểu hoa văn (0–2)"><span>Kiểu</span>
              <NumberInput id="skin-pattern" min={0} max={2} step={1} value={st.pattern} onChange={(v) => setSt((s) => ({ ...s, pattern: v }))} /></label>
            <label><span>Tông</span>
              <NumberInput id="skin-theme" min={0} max={20} step={1} value={st.theme} onChange={(v) => setSt((s) => ({ ...s, theme: v }))} /></label>
            <label className="skin-variation"><span>Biến thể: <b id="skin-variation-val">{st.variation}</b></span>
              <Slider id="skin-variation" min={0} max={20} step={1} value={st.variation} onChange={(v) => setSt((s) => ({ ...s, variation: v }))} /></label>
          </div>
          <div className="skin-fx lab-only">
            <div className="skin-fx-head">
              <span className="skin-fx-toggle"><Checkbox id="skin-fx-on" checked={st.fxOn} onChange={(v) => setSt((s) => ({ ...s, fxOn: v }))} label="Hiệu ứng da" /></span>
              <span className="muted">bùn, máu… tự khô và phai dần như trong game</span>
            </div>
            <div className={`skin-fx-grid${st.fxOn ? '' : ' off'}`} id="skin-fx-grid">
              {EFFECTS.map(([id, label]) => (
                <label key={id} className="fx-item"><span>{label}</span><b id={`fx-${id}-val`}>{st.fx[id] ?? 0}%</b>
                  <Slider id={`fx-${id}`} min={0} max={100} step={5} value={st.fx[id] ?? 0} onChange={(v) => setSt((s) => ({ ...s, fxOn: true, fx: { ...s.fx, [id]: v } }))} /></label>
              ))}
            </div>
            <div className="skin-glow" hidden>
              <span>Phát sáng <em>thử nghiệm</em></span>
              <Slider id="skin-glow" min={1} max={4} step={0.1} value={st.glow} onChange={(v) => setSt((s) => ({ ...s, glow: Math.max(1, Math.min(GLOW_MAX, v)) }))} />
              <b id="skin-glow-val">{st.glow.toFixed(1)}×</b>
            </div>
          </div>
          <span className="skin-keep lab-only"><Checkbox id="skin-keep" checked={keep} onChange={setKeep} label="Giữ màu này cho những lần chơi sau (cùng loài), lấy từ gara vẫn giữ màu của ô gara" /></span>
          <button type="button" className="btn btn-emerald" id="btn-skin-apply" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={() => { void send(); }}>Áp dụng lên dino đang chơi</button>
          {/* A chip let go stays gone until the list changes; the line itself stays (as before React). */}
          <div className="skin-kept lab-only" id="skin-kept" hidden={Object.keys(kept).length === 0}>
            {Object.keys(kept).length > 0 && <span className="muted">Đang giữ màu cho:</span>}
            {keptNames.map((sp) => (
              <span key={sp} className="kept-chip">{' '}
                <div className="preset-stripe" style={{ width: 48, height: 12, display: 'inline-flex', borderRadius: 3, overflow: 'hidden', verticalAlign: 'middle', marginRight: 6 }}>
                  {REGIONS.map(([id]) => { const c = kept[sp]?.colors?.[id]; return <i key={id} style={{ background: c ? hex(c) : '#555' }} />; })}
                </div>
                {speciesLabel(sp)}
                <button type="button" data-forget={sp} title="Bỏ giữ màu" disabled={fg.busy.includes(sp)} onClick={() => { void forget(sp); }}>✕</button>
              </span>
            ))}
          </div>
          <div className={`garage-status${status?.kind ? ` ${status.kind}` : ''}`} id="skin-status" hidden={!status?.text}>{status?.text}</div>

          <div className="skin-code">
            <h4>Mã skin (chia sẻ cho người khác)</h4>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" id="btn-skin-export" style={{ fontSize: 12 }} onClick={() => {
                const c = skinCode(sk);
                setCode(c);
                navigator.clipboard?.writeText(c).then(() => say('ok', 'Đã chép mã skin.'), () => undefined);
              }}>Xuất mã</button>
              <input type="text" id="skin-code" placeholder="Dán mã vào đây…" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
              <button type="button" className="btn btn-ghost" id="btn-skin-import" style={{ fontSize: 12 }} onClick={() => {
                const p = parseSkinCode(code);
                if (!p) { say('bad', 'Mã skin không hợp lệ.'); return; }
                put(p);
                say('ok', 'Đã nạp mã skin. Bấm "Áp dụng" để đổi màu trong game.');
              }}>Nạp mã</button>
            </div>
          </div>

          <div className="skin-presets">
            <h4>Bảng màu gợi ý <span className="muted">(bấm để áp cả 10 vùng)</span></h4>
            <div className="preset-grid se-presets" id="skin-presets-bar">
              {PRESETS.map((p, i) => (
                <button key={p.name} type="button" className={`se-preset${preset === i ? ' on' : ''}`} data-preset={i} title={p.name} onClick={() => { setPreset(i); put({ colors: p.colors }); }}>
                  <div className="se-stripe">{REGIONS.slice(0, 5).map(([id]) => <i key={id} style={{ background: p.colors[id] }} />)}</div>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="skin-side">
          {/* The colours of the dino played now */}
          <div id="skin-active-swatches-box" style={{ marginBottom: 16 }} hidden={!swatches}>
            <h4 style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>Màu dino đang dùng trong game:</h4>
            <div id="skin-active-swatches" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {swatches?.map(([k, label]) => (
                <div key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: 12 }}>
                  <i style={{ width: 12, height: 12, borderRadius: 3, background: hex(gameSkin?.colors?.[k]) }} />
                  <span>{label}: <b>{hex(gameSkin?.colors?.[k])}</b></span>
                </div>
              ))}
            </div>
          </div>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Màu từng vùng</h3>
          <div className="regions-grid se-regions" id="skin-regions-grid">
            {REGIONS.map(([id, label]) => (
              <Region key={id} id={id} label={label} value={st.colors[id] ?? '#ffffff'} off={female && id === 'MaleDisplay'}
                onColor={(h) => setSt((s) => ({ ...s, colors: { ...s.colors, [id]: h } }))} />
            ))}
          </div>

          <div className="skin-saved">
            <h4>Skin đã lưu (trên máy này)</h4>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="text" id="skin-save-name" placeholder="Tên skin…" maxLength={40} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
              <button type="button" className="btn btn-emerald" id="btn-skin-save" style={{ fontSize: 12 }} onClick={() => {
                const name = saveName.trim() || `Skin ${new Date().toLocaleString('vi-VN')}`;
                storeSaved(withSaved(loadSaved(), name, skinCode(sk)));
                setSaveName('');
                setSaved(loadSaved());
              }}>Lưu</button>
            </div>
            <ul id="skin-saved-list">
              {saved.length === 0
                ? <li className="muted" style={{ fontSize: 12.5, padding: '12px 0', textAlign: 'center' }}>Chưa có skin nào được lưu trên trình duyệt này.</li>
                : saved.map((it, i) => {
                  const colors = parseSkinCode(it.code)?.colors ?? {};
                  return (
                    <li key={`${i}-${it.name}`} className="saved-skin-card">
                      <div className="saved-skin-header">
                        <div className="preset-stripe saved-stripe">{REGIONS.map(([id]) => { const c = colors[id] ?? '#333'; return <i key={id} style={{ background: c }} title={`${id}: ${c}`} />; })}</div>
                        <span className="saved-skin-name" title={it.name}>{it.name}</span>
                      </div>
                      <div className="saved-skin-actions">
                        <button type="button" className="btn btn-ghost btn-saved-load" data-load={i} title="Nạp skin này" onClick={() => { const p = parseSkinCode(loadSaved()[i]?.code); if (p) put(p); }}>
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                          <span>Nạp</span>
                        </button>
                        <button type="button" className="btn btn-ghost btn-saved-del" data-del={i} title="Xoá skin này" onClick={() => { const list = loadSaved(); list.splice(i, 1); storeSaved(list); setSaved(loadSaved()); }}>
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                          <span>Xoá</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
            <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>Chỉ lưu trên trình duyệt này, không đồng bộ giữa các máy.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
