import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Checkbox, Select, Slider } from '@isle/ui';
import { launcher, launcherUi } from '../../lib/launcher';

/*
 * "Overlay trong game" (#overlay; overlay-settings.js before React). The overlay is Xóm Gáy Launcher's
 * (launcher/src/overlay.js): four widgets (voice, mini map, dino numbers, prime quests), each its own small
 * window. This page only edits their settings through window.isleLauncher. In a browser the card says it
 * is only a preview (no launcher, nothing to edit).
 */

type Widget = 'voice' | 'map' | 'dino' | 'quests';
interface WidgetSettings {
  enabled: boolean; scale: number; bg: number; opacity: number; show: Record<string, boolean>;
  style?: string; autoHide?: string; maxSpeakers?: number; radius?: number; shape?: string; rotate?: string; layout?: string; hideDone?: boolean;
}
interface Settings { enabled: boolean; widgets: Record<Widget, WidgetSettings> }
interface Bounds { x: number; y: number; width: number; height: number }
interface Layout { displays: Array<{ id: string; bounds: Bounds }>; widgets: Record<Widget, { enabled: boolean; bounds: Bounds; scale: number }> }
interface OverlayApi {
  overlayGet?: () => { settings?: Settings; editing?: boolean } | null;
  overlaySet: (patch: Record<string, unknown>) => Promise<Settings | null>;
  overlayLayout: () => Layout | null;
  overlayPlace: (id: Widget, at: { x: number; y: number; scale: number }) => void;
  overlayPreview: () => void;
  overlayEdit: (on: boolean) => void;
  overlayMiniFrame?: unknown;
  keyLabel: (k: string) => string;
  captureKey: (k: string) => Promise<{ error?: string } | null>;
  gameModeGet?: () => { on: boolean; keep: Record<string, boolean> };
  gameModeKeep?: (keep: Record<string, boolean>) => void;
  bigMapClose?: unknown;
  bigMapDisplayGet?: () => { value: string; choices: Array<{ id: string; label: string }> } | null;
  bigMapDisplaySet?: (id: string) => void;
  overlayCompatGet?: () => { saved: boolean } | null;
  overlayCompatSet?: (on: boolean) => void;
  onOverlayChanged?: (cb: (s: Settings | null) => void) => void;
}

const WIDGETS: ReadonlyArray<readonly [Widget, string]> = [['voice', '🎙️ Voice'], ['map', '🗺️ Mini map'], ['dino', '🦖 Thông số dino'], ['quests', '🏆 Nhiệm vụ']];
const SHOW: Record<Widget, ReadonlyArray<readonly [string, string]>> = {
  voice: [['speakers', 'Người đang nói gần bạn'], ['direction', 'Hướng & khoảng cách (trái / phải, gần / xa)'], ['self', 'Mic của bạn (đang nói / im lặng / tắt)'],
    ['range', 'Tầm giọng hiện tại'], ['toasts', 'Thông báo khi đổi tầm giọng'], ['warnings', 'Cảnh báo (chưa vào game, mất kết nối)']],
  map: [['target', 'Đường tới điểm đến (bấm vào tab Bản đồ để đặt)'], ['ai', 'Quét AI trực tiếp quanh bạn (Heo, Hươu...)'], ['trail', 'Vệt đường bạn vừa đi'], ['zones', 'Vùng di cư / sanctuary / tuần tra'], ['water', 'Nguồn nước'],
    ['landmarks', 'Địa danh'], ['labels', 'Tên địa điểm'], ['coords', 'Toạ độ của bạn']],
  dino: [['species', 'Loài'], ['growth', 'Growth %'], ['health', 'Máu'], ['hpValue', 'Số máu cụ thể (980 / 1.300 · 75%)'],
    ['damage', 'Hiệu ứng khi mất máu (−120 bay lên, thanh máu nháy)'], ['stamina', 'Thể lực'], ['hunger', 'Đói'], ['thirst', 'Nước'],
    ['blood', 'Huyết'], ['oxygen', 'Oxy'], ['prime', 'Huy hiệu cấp F0–F4'], ['tierFx', 'Hiệu ứng khung theo đời dino (như gara)']],
  quests: [['deadline', 'Thanh growth tới mốc chốt Prime (75%)'], ['passive', 'Cả điều kiện bị động (không bị vô sinh, loài nhỏ…)']],
};
const NOTE: Record<Widget, string> = {
  voice: 'Ai đang nói gần bạn, mic và tầm giọng của bạn. Hiện khi bạn đã vào kênh voice.',
  map: 'Bản đồ nhỏ quanh dino: vị trí, hướng, vệt đường, radar quét AI TRỰC TIẾP (Heo rừng, Hươu...) và các vùng. Hiện khi bạn có dino trong game.',
  dino: 'Máu (cả số cụ thể), thể lực, đói, nước… của dino đang chơi, cập nhật mỗi giây. Mỗi lần mất máu hiện số máu bị trừ.',
  quests: 'Các điều kiện Prime Elder: đã xong ✓, chưa xong ○, chưa rõ ?. Cần xong 5 trước khi growth tới 75%.',
};
const LABEL: Record<Widget, string> = { voice: '🎙️ Voice', map: '🗺️ Mini map', dino: '🦖 Dino', quests: '🏆 Nhiệm vụ' };
const DIRS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const;
const WAITING = 'bấm một phím hoặc nút chuột…';

/** The launcher's overlay calls, when this launcher has them (a browser or an old launcher: null). */
function overlayApi(): OverlayApi | null {
  const l = launcher() as unknown as OverlayApi | undefined;
  if (!l?.overlayGet) return null;
  const got = l.overlayGet();
  return got?.settings?.widgets ? l : null;
}

export function Overlay() {
  const [L] = useState(overlayApi);
  return L ? <Editor L={L} /> : <Card app={false} />;
}

/** The card's frame; in a browser (`app` false) its controls are there but do nothing (as before React). */
function Card({ app, children, top }: { app: boolean; children?: ReactNode; top?: ReactNode }) {
  return (
    <div className="card" id="v-overlay-card">
      <div className="card-header">
        <h2 className="card-title">🖥️ Overlay trong game</h2>
        <span className="card-subtitle">các khung nhỏ nằm đè lên game: voice, mini map, thông số dino, nhiệm vụ</span>
      </div>
      {top ?? (
        <div className="ov-top">
          <span className="ov-switch"><Checkbox id="ov-enabled" checked={false} onChange={() => undefined} label="Bật overlay" /></span>
          <span className="v-chip good" id="ov-app" hidden={!app}>✓ Trong launcher</span>
          <span className="v-chip" id="ov-web" hidden={app}>○ Chỉ xem thử</span>
          <button type="button" className="btn btn-ghost" id="ov-drag">Sắp xếp khung</button>
          <button type="button" className="btn btn-ghost" id="ov-preview">Xem thử 6 giây</button>
          <button type="button" className="btn btn-ghost" id="ov-key">Bật/tắt: <kbd id="ov-key-name">F8</kbd></button>
          <button type="button" className="btn btn-ghost" id="ov-edit-key">Chỉnh sửa: <kbd id="ov-edit-key-name">F9</kbd></button>
          <button type="button" className="btn btn-ghost" id="ov-bigmap-key" hidden>Bản đồ lớn: <kbd id="ov-bigmap-key-name">M</kbd></button>
        </div>
      )}
      {children ?? (
        <>
          <div className="ov-gm">
            <div><b>🎮 Chế độ chơi game</b>: thu launcher xuống khay, trang không vẽ gì; overlay chỉ giữ:</div>
            <div className="ov-checks" id="ov-gm-keep" />
            <p className="v-note" style={{ marginTop: 4 }}>Bật bằng nút 🎮 trên đầu trang, trong khay hệ thống, hoặc tự bật khi bấm ▶ Chơi The Isle. Voice vẫn chạy.</p>
          </div>
          <div className="v-subhead">Bố cục trên màn hình</div>
          <div className="ov-stage-wrap"><div className="ov-stage" id="ov-stage" /></div>
          <p className="v-note" id="ov-stage-note">Kéo một khung để di chuyển · rê chuột vào mép hoặc góc khung rồi kéo để phóng to / thu nhỏ · thả ở đâu cũng được, kể cả màn hình khác. Overlay thật di chuyển theo ngay.</p>
          <div className="ov-tabs" role="tablist" id="ov-tabs" />
          <div id="ov-panel" />
        </>
      )}
    </div>
  );
}

/** In the launcher: every setting, the layout editor, the keys, game mode, the big map's screen, the black-edge fix. */
function Editor({ L }: { L: OverlayApi }) {
  const [all, setAll] = useState<Settings>(() => (L.overlayGet?.()?.settings as Settings));
  const [current, setCurrent] = useState<Widget>('voice');
  const [editing, setEditing] = useState<boolean>(() => Boolean(L.overlayGet?.()?.editing));
  const [capture, setCapture] = useState<{ key: string; text: string } | null>(null);
  const [, redraw] = useState(0);
  const [gm, setGm] = useState(() => L.gameModeGet?.() ?? null);
  const [compat] = useState(() => L.overlayCompatGet?.() ?? null);
  const [compatOn, setCompatOn] = useState(() => Boolean(compat?.saved));
  const allNow = useRef(all);
  allNow.current = all;

  // Settings changed elsewhere (the overlay on screen, the tray): read them again.
  useEffect(() => {
    L.onOverlayChanged?.((saved) => {
      if (saved?.widgets) setAll(saved);
      setEditing(Boolean(L.overlayGet?.()?.editing));
    });
    const onGm = (): void => setGm(L.gameModeGet?.() ?? null);
    window.addEventListener('isle-gamemode', onGm);
    return () => window.removeEventListener('isle-gamemode', onGm);
  }, [L]);

  /** Send a change for the current widget; sliders call this while dragging, so the overlay moves live. */
  const pending = useRef<Record<string, unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = useCallback((patch: Partial<WidgetSettings>): void => {
    const w = allNow.current.widgets[current];
    setAll((a) => ({ ...a, widgets: { ...a.widgets, [current]: { ...w, ...patch, show: { ...w.show, ...(patch.show ?? {}) } } } }));
    const p = pending.current;
    const same = p && p['widget'] === current ? p : {};
    pending.current = { widget: current, ...same, ...patch, show: { ...((same as { show?: Record<string, boolean> }).show ?? {}), ...(patch.show ?? {}) } };
    if (timer.current !== null) return;
    timer.current = setTimeout(async () => {
      timer.current = null;
      const send = pending.current; pending.current = null;
      if (!send) return;
      const saved = await L.overlaySet(send);
      if (saved && pending.current === null && !(document.activeElement as HTMLElement | null)?.matches?.('input[type=range]')) setAll(saved);
    }, 80);
  }, [L, current]);

  const captureKey = async (key: string, id: string): Promise<void> => {
    setCapture({ key: id, text: WAITING });
    const r = await L.captureKey(key);
    setCapture(r?.error ? { key: id, text: r.error } : null);
    redraw((n) => n + 1);
  };
  const keyText = (id: string, key: string): string => (capture?.key === id ? capture.text : L.keyLabel(key));
  const bm = L.bigMapDisplayGet?.() ?? null;
  const bmOptions = bm ? [{ id: 'auto', label: 'Tự động, màn hình đang chơi game' }, ...bm.choices] : [];
  const w = all.widgets[current];

  const top = (
    <>
      <div className="ov-top">
        <span className="ov-switch"><Checkbox id="ov-enabled" checked={all.enabled} label="Bật overlay"
          onChange={(v) => { void L.overlaySet({ enabled: v }).then((s) => { if (s) setAll(s); }); }} /></span>
        <span className="v-chip good" id="ov-app">✓ Trong launcher</span>
        <span className="v-chip" id="ov-web" hidden>○ Chỉ xem thử</span>
        <button type="button" className="btn btn-ghost" id="ov-drag" onClick={() => { L.overlayEdit(!editing); setEditing(!editing); }}>
          {editing ? `✓ Xong chỉnh (${L.keyLabel('edit')})` : `✥ Chỉnh trên màn hình (${L.keyLabel('edit')})`}</button>
        <button type="button" className="btn btn-ghost" id="ov-preview" onClick={() => L.overlayPreview()}>Xem thử 6 giây</button>
        <button type="button" className="btn btn-ghost" id="ov-key" onClick={() => { void captureKey('overlay', 'ov-key'); }}>Bật/tắt: <kbd id="ov-key-name">{keyText('ov-key', 'overlay')}</kbd></button>
        <button type="button" className="btn btn-ghost" id="ov-edit-key" onClick={() => { void captureKey('edit', 'ov-edit-key'); }}>Chỉnh sửa: <kbd id="ov-edit-key-name">{keyText('ov-edit-key', 'edit')}</kbd></button>
        <button type="button" className="btn btn-ghost" id="ov-bigmap-key" hidden={!L.bigMapClose} onClick={() => { void captureKey('bigmap', 'ov-bigmap-key'); }}>Bản đồ lớn: <kbd id="ov-bigmap-key-name">{L.bigMapClose ? keyText('ov-bigmap-key', 'bigmap') : 'M'}</kbd></button>
      </div>
      <p className="v-note" id="ov-bigmap-display-wrap" hidden={!bm} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b>🗺️ Bản đồ lớn hiện ở</b>
        <span style={{ minWidth: 300 }}>
          {bm && <Select id="ov-bigmap-display" aria-label="Bản đồ lớn hiện ở" value={bmOptions.some((o) => o.id === bm.value) ? bm.value : 'auto'}
            options={bmOptions.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => { L.bigMapDisplaySet?.(v); redraw((n) => n + 1); }} />}
        </span>
        <span>Tự động: màn hình đang có chuột lúc bấm phím, khi chơi là màn hình của game.</span>
      </p>
      <p className="v-note" id="ov-compat-wrap" hidden={!compat}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
          <Checkbox id="ov-compat" checked={compatOn} onChange={(v) => { setCompatOn(v); L.overlayCompatSet?.(v); }} label="🛠 Sửa viền đen quanh overlay" /></span>
        {' '}(bật nếu các khung overlay có <b>nền / viền đen</b> thay vì trong suốt, một số card đồ hoạ, Windows bật HDR).
        Launcher sẽ <b>khởi động lại</b> (voice ngắt vài giây); xem 3D skin có thể chậm hơn.
      </p>
    </>
  );
  const gmBlock = (
    <>
      <div className="ov-gm" hidden={!gm}>
        <div><b>🎮 Chế độ chơi game</b>: thu launcher xuống khay, trang không vẽ gì; overlay chỉ giữ:</div>
        <div className="ov-checks" id="ov-gm-keep">
          {gm && WIDGETS.map(([id, label]) => (
            <Checkbox key={id} checked={Boolean(gm.keep[id])} label={label}
              onChange={(v) => { L.gameModeKeep?.({ [id]: v }); setGm({ ...gm, keep: { ...gm.keep, [id]: v } }); }} />
          ))}
        </div>
        <p className="v-note" style={{ marginTop: 4 }}>Bật bằng nút 🎮 trên đầu trang, trong khay hệ thống, hoặc tự bật khi bấm ▶ Chơi The Isle. Voice vẫn chạy.</p>
      </div>
    </>
  );
  const stage = (
    <>
      <div className="v-subhead">Bố cục trên màn hình</div>
      <Stage L={L} all={all} current={current} onPick={setCurrent} onPlaced={() => { const g = L.overlayGet?.(); if (g?.settings) setAll(g.settings); }} />
      <p className="v-note" id="ov-stage-note">Kéo một khung để di chuyển · rê chuột vào mép hoặc góc khung rồi kéo để phóng to / thu nhỏ · thả ở đâu cũng được, kể cả màn hình khác. Overlay thật di chuyển theo ngay.</p>
    </>
  );
  const tabs = (
    <div className="ov-tabs" role="tablist" id="ov-tabs">
        {WIDGETS.map(([id, label]) => (
          <button key={id} type="button" role="tab" data-tab={id} aria-selected={id === current} onClick={() => setCurrent(id)}>
            <span className={`st${all.widgets[id].enabled ? ' on' : ''}`} title={all.widgets[id].enabled ? 'đang bật' : 'đang tắt'} />{label}</button>
        ))}
    </div>
  );
  const panel = (
      <div id="ov-panel">
        <div className="ov-panel-head">
          <span className="ov-switch"><Checkbox checked={w.enabled} label={`Hiện khung ${WIDGETS.find(([id]) => id === current)?.[1] ?? ''}`} onChange={(v) => change({ enabled: v })} /></span>
          <button type="button" className="btn btn-ghost" data-act="reset" onClick={() => { void L.overlaySet({ widget: current, reset: true }).then((s) => { if (s) setAll(s); }); }}>Khôi phục mặc định khung này</button>
        </div>
        <p className="v-note" style={{ marginTop: 0 }}>{NOTE[current]}</p>
        <div className="ov-grid">
          <div className="ov-block">
            <Num label="Kích thước (hoặc kéo mép khung ở trên)" k="scale" min={50} max={250} step={5} unit="%" value={w.scale} change={change} />
            <Num label="Độ đậm nền" k="bg" min={0} max={100} step={5} unit="%" value={w.bg} change={change} />
            <Num label="Độ rõ toàn khung" k="opacity" min={30} max={100} step={5} unit="%" value={w.opacity} change={change} />
          </div>
          <div className="ov-block">
            {current === 'voice' && <>
              <div className="v-subhead">Kiểu hiển thị</div><Seg k="style" value={w.style} options={[['full', 'Đầy đủ'], ['compact', 'Gọn'], ['minimal', 'Tối giản']]} change={change} />
              <div className="v-subhead">Khi không ai nói</div><Seg k="autoHide" value={w.autoHide} options={[['idle', 'Ẩn khung'], ['never', 'Luôn hiện']]} change={change} />
              <Num label="Hiện tối đa (người)" k="maxSpeakers" min={1} max={10} step={1} unit="" value={w.maxSpeakers ?? 3} change={change} />
            </>}
            {current === 'map' && <>
              <div className="v-subhead">Tầm nhìn quanh dino</div><Seg k="radius" value={w.radius} options={[[150, '150 m'], [300, '300 m'], [500, '500 m'], [1000, '1 km'], [2000, '2 km']]} change={change} />
              <div className="v-subhead">Hình dạng</div><Seg k="shape" value={w.shape} options={[['circle', 'Tròn'], ['square', 'Vuông']]} change={change} />
              <div className="v-subhead">Hướng bản đồ</div><Seg k="rotate" value={w.rotate} options={[['north', 'Bắc luôn ở trên'], ['heading', 'Xoay theo hướng dino']]} change={change} />
            </>}
            {current === 'dino' && <><div className="v-subhead">Cách hiện</div><Seg k="layout" value={w.layout} options={[['bars', 'Thanh + %'], ['numbers', 'Chỉ số %']]} change={change} /></>}
            {current === 'quests' && <span className="ov-switch" style={{ marginTop: 10 }}><Checkbox checked={Boolean(w.hideDone)} label="Ẩn nhiệm vụ đã xong" onChange={(v) => change({ hideDone: v })} /></span>}
          </div>
        </div>
        <div className="v-subhead" style={{ marginTop: 14 }}>Hiện những gì</div>
        {current === 'map' && L.overlayMiniFrame
          // Launcher 1.0.34+: the mini map is drawn from the map itself (map.js).
          ? <p className="muted" style={{ margin: '6px 0 0' }}>Mini map hiện đúng các lớp đang bật trên bản đồ (tab Bản đồ, hoặc bản đồ lớn trong game, phím <kbd>{L.keyLabel('bigmap')}</kbd>): bật / tắt lớp ở đó, cùng điểm đến và vệt đường.</p>
          : <div className="ov-checks">{SHOW[current].map(([k, label]) => (
            <Checkbox key={k} checked={Boolean(w.show[k])} label={label} onChange={(v) => change({ show: { [k]: v } })} />
          ))}</div>}
      </div>
  );
  // The launcher's look (app/launcher/): game mode and the widgets on the left; the layout and the picked widget's
  // settings on the right, so neither side is left empty (owner, 2026-10-07). The web's: one column, as before.
  return launcherUi() ? (
    <Card app top={top}>
      <div className="ov-lx">
        <div className="ov-lx-l">{gmBlock}{tabs}</div>
        <div className="ov-lx-r"><div className="ov-stage-box">{stage}</div>{panel}</div>
      </div>
    </Card>
  ) : (
    <Card app top={top}>
      {gmBlock}
      {stage}
      {tabs}
      {panel}
    </Card>
  );
}

/** A slider with its value (the overlay follows while it moves). */
function Num({ label, k, min, max, step, unit, value, change }: {
  label: string; k: keyof WidgetSettings; min: number; max: number; step: number; unit: string; value: number; change: (p: Partial<WidgetSettings>) => void;
}) {
  return <label className="v-field">{label} <output>{value}{unit}</output>
    <Slider min={min} max={max} step={step} value={value} aria-label={label} onChange={(v) => change({ [k]: v } as Partial<WidgetSettings>)} /></label>;
}
/** Buttons side by side, one pressed. */
function Seg({ k, value, options, change }: { k: keyof WidgetSettings; value: unknown; options: ReadonlyArray<readonly [string | number, string]>; change: (p: Partial<WidgetSettings>) => void }) {
  return <div className="v-seg" role="group">{options.map(([v, label]) => (
    <button key={String(v)} type="button" data-choice={k} data-value={v} aria-pressed={String(v) === String(value)} onClick={() => change({ [k]: v } as Partial<WidgetSettings>)}>{label}</button>
  ))}</div>;
}

/** The layout editor: your screens in small, a box per widget shown; drag to move, an edge or a corner to resize. */
function Stage({ L, all, current, onPick, onPlaced }: { L: OverlayApi; all: Settings; current: Widget; onPick: (w: Widget) => void; onPlaced: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [lay, setLay] = useState<Layout | null>(null);
  const [view, setView] = useState<{ minX: number; minY: number; k: number; w: number; h: number } | null>(null);
  const gesture = useRef<{ id: Widget; box: HTMLElement; dir: string | null; sx: number; sy: number; x: number; y: number; w: number; h: number; scale: number; out: { x: number; y: number; scale: number } | null } | null>(null);
  const frame = useRef(0);
  const measure = useCallback((): void => {
    if (gesture.current) return;
    const l = L.overlayLayout();
    setLay(l);
    const stage = el.current;
    if (!l || !l.displays.length || !stage) { setView(null); return; }
    const xs = l.displays.flatMap((d) => [d.bounds.x, d.bounds.x + d.bounds.width]);
    const ys = l.displays.flatMap((d) => [d.bounds.y, d.bounds.y + d.bounds.height]);
    const minX = Math.min(...xs); const minY = Math.min(...ys);
    const vw = Math.max(...xs) - minX; const vh = Math.max(...ys) - minY;
    // As wide as the card allows, at most 340 px tall.
    const width = Math.min(stage.parentElement?.clientWidth || 800, 900, 340 * vw / vh);
    setView({ minX, minY, k: width / vw, w: width, h: width * vh / vw });
  }, [L]);
  // Drawn again with the settings (a widget on / off, its size), the window's size, and when the page is shown.
  useLayoutEffect(() => { measure(); }, [measure, all]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
    if (ro && el.current?.parentElement) ro.observe(el.current.parentElement);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [measure]);
  const px = (v: number): string => `${v * (view?.k ?? 0)}px`;
  const on = lay ? WIDGETS.filter(([id]) => all.enabled && lay.widgets[id].enabled) : [];

  const down = (e: React.PointerEvent): void => {
    const box = (e.target as HTMLElement).closest('[data-box]') as HTMLElement | null;
    if (!box || !lay) return;
    e.preventDefault();
    const id = box.dataset['box'] as Widget;
    if (id !== current) onPick(id);
    const b = lay.widgets[id].bounds;
    gesture.current = { id, box, dir: (e.target as HTMLElement).dataset['dir'] || null, sx: e.clientX, sy: e.clientY, x: b.x, y: b.y, w: b.width, h: b.height, scale: lay.widgets[id].scale, out: null };
    box.classList.add('drag');
    box.setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent): void => {
    const g = gesture.current;
    if (!g || !view || !lay) return;
    const dx = (e.clientX - g.sx) / view.k; const dy = (e.clientY - g.sy) / view.k;
    let x = g.x; let y = g.y; let scale = g.scale; let w = g.w; let h = g.h;
    if (g.dir === null) {
      x = g.x + dx; y = g.y + dy;
      // Snap to screen edges (12 px on the real screen).
      for (const d of lay.displays) {
        const B = d.bounds;
        for (const edge of [B.x, B.x + B.width - w]) if (Math.abs(x - edge) < 12) x = edge;
        for (const edge of [B.y, B.y + B.height - h]) if (Math.abs(y - edge) < 12) y = edge;
      }
    } else {
      const kx = g.dir.includes('e') ? (g.w + dx) / g.w : g.dir.includes('w') ? (g.w - dx) / g.w : null;
      const ky = g.dir.includes('s') ? (g.h + dy) / g.h : g.dir.includes('n') ? (g.h - dy) / g.h : null;
      let k = kx ?? ky ?? 1;
      if (kx !== null && ky !== null) k = Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky;
      scale = Math.max(50, Math.min(250, Math.round(g.scale * k)));
      const f = scale / g.scale;
      w = g.w * f; h = g.h * f;
      if (g.dir.includes('w')) x = g.x + g.w - w;
      if (g.dir.includes('n')) y = g.y + g.h - h;
    }
    Object.assign(g.box.style, { left: `${(x - view.minX) * view.k}px`, top: `${(y - view.minY) * view.k}px`, width: `${w * view.k}px`, height: `${h * view.k}px` });
    const small = g.box.querySelector('small');
    if (small) small.textContent = `${scale}%`;
    g.out = { x: Math.round(x), y: Math.round(y), scale };
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; const gg = gesture.current; if (gg?.out) L.overlayPlace(gg.id, gg.out); });
  };
  const end = (): void => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    g.box.classList.remove('drag');
    if (g.out) L.overlayPlace(g.id, g.out);
    // Where it really landed (kept on a screen), and the saved settings.
    setTimeout(() => { onPlaced(); measure(); }, 120);
  };
  return (
    <div className="ov-stage-wrap">
      <div className="ov-stage" id="ov-stage" ref={el} style={view ? { width: `${view.w}px`, height: `${view.h}px` } : undefined}
        onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        {lay && view && <>
          {lay.displays.map((d, i) => (
            <div key={d.id} className="ov-screen" style={{ left: px(d.bounds.x - view.minX), top: px(d.bounds.y - view.minY), width: px(d.bounds.width), height: px(d.bounds.height) }}>
              <span>Màn hình {i + 1}{d.id === 'primary' ? ' (chính)' : ''}</span></div>
          ))}
          {on.map(([id]) => {
            const b = lay.widgets[id].bounds;
            return (
              <div key={`${id}-${b.x}-${b.y}-${b.width}`} className={`ov-box${id === current ? ' sel' : ''}`} data-box={id}
                style={{ left: px(b.x - view.minX), top: px(b.y - view.minY), width: px(b.width), height: px(b.height) }}>
                {DIRS.map((d) => <i key={d} className={`h ${d}`} data-dir={d} />)}
                <span>{LABEL[id]}</span><small>{lay.widgets[id].scale}%</small></div>
            );
          })}
          {on.length === 0 && <div className="ov-empty">{all.enabled ? 'Bật một khung ở các tab bên dưới để đặt nó lên màn hình.' : 'Overlay đang tắt.'}</div>}
        </>}
      </div>
    </div>
  );
}
