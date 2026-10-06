import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { Button, Checkbox, NumberInput, Switch, TextInput, useToast } from '@isle/ui';
import { useConfirm } from '../../app/confirm';
import { useSession } from '../../app/session';
import { ago } from '../../lib/time';
import { az, changed, flyTo, markAz, selectAiZone, selectedZone, shapeZone, startPolyDraw, finishPolyDraw, useMapState } from './store';
import { aiZoneShape, reachM, type AiZone } from './zones';
import s from './Map.module.css';

const SHAPES: ReadonlyArray<readonly [AiZone['shape'], string]> = [['circle', 'Tròn'], ['ellipse', 'Bầu dục'], ['polygon', 'Đa giác']];

/** Vùng AI (mod AIZones, bridge/src/ai-zones.ts): the switch, the server cap, the zones and the selected one's form. */
export function ZonesPane() {
  useMapState();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { withToken } = useSession();
  // The game's own AI around players (bridge/src/ai-ambient.ts): read over RCON, so every 30 s.
  const ambient = useQuery({ queryKey: ['/api/ai-ambient'], queryFn: () => getJson<{ live: boolean | null; ini: boolean | null }>('/api/ai-ambient'), refetchInterval: 30_000 }).data;
  const d = az.draft;
  const data = az.data;
  if (!d || !data) return <div className={s.pane}><span className={s.hint2}>Đang tải…</span></div>;
  const zn = selectedZone();
  const st = az.status;
  const ig = new Set(d.ignoreOccupants ?? []);
  const word = (v: boolean | null | undefined): string => (v === null || v === undefined ? 'không rõ' : v ? 'bật' : 'tắt');
  const ambientOn = ambient ? (ambient.live ?? ambient.ini) === true : false;
  const set = (fn: (z: AiZone) => void, resetPoints = false): void => {
    if (!zn) return;
    fn(zn);
    if (resetPoints) delete az.points[zn.id];
    markAz();
  };
  const toggleAmbient = (on: boolean): void => confirm({
    title: on ? 'Bật AI game tự sinh?' : 'Tắt AI game tự sinh?',
    body: on ? 'Game lại tự sinh thỏ, gà, heo… quanh người chơi (ngoài AI của các vùng).'
      : 'Game ngừng tự sinh AI quanh người chơi; chỉ còn AI của các vùng. Con đang có sẵn vẫn còn đến khi bị ăn hoặc "Làm mới AI".',
    okLabel: on ? 'Bật' : 'Tắt', danger: !on,
    run: async (token) => {
      const a = await adminFetch<{ live: boolean | null }>('/api/ai-ambient', 'PUT', token, { on });
      toast(a.live === null ? 'Đã lưu vào Game.ini (RCON không trả lời, áp dụng ở lần restart).' : `AI game tự sinh: ${a.live ? 'bật' : 'tắt'}.`);
      await qc.invalidateQueries({ queryKey: ['/api/ai-ambient'] });
    },
  });
  const save = (): void => {
    void withToken('lưu vùng AI', async (token) => {
      await adminFetch('/api/ai-zones', 'PUT', token, az.draft);
      az.dirty = false;
      toast('Đã lưu vùng AI, mod đọc lại trong vòng 10 giây.');
      await qc.invalidateQueries({ queryKey: ['/api/ai-zones'] });
      changed();
    });
  };
  const pts = zn ? az.points[zn.id] : undefined;
  const shape = zn?.shape ?? 'circle';
  const num = (label: string, key: keyof AiZone, min: number, max: number, step = 1, resetPoints = false) => zn && (
    <label>{label}<NumberInput aria-label={label} min={min} max={max} step={step} value={Number(zn[key] ?? 0)} onChange={(v) => set((z) => { (z as unknown as Record<string, number>)[key] = Math.round(v); }, resetPoints)} /></label>
  );
  return (
    <div className={s.pane}>
      <Switch id="az-enabled" checked={d.enabled} onChange={(v) => { d.enabled = v; markAz(); }} label={<b>Bật vùng AI</b>} />
      <Switch id="az-ambient" checked={ambientOn} onChange={toggleAmbient} label="AI game tự sinh quanh người chơi" />
      <div className={s.row}><label htmlFor="az-global">Tổng AI toàn server tối đa</label>
        <span style={{ width: 130 }}><NumberInput id="az-global" min={0} max={5000} step={10} value={d.globalMax} onChange={(v) => { d.globalMax = Math.max(0, Math.round(v)); markAz(); }} /></span></div>
      <div className={s.hint2}>
        {!st ? 'Mod AIZones chưa báo trạng thái (chưa cài, hoặc server chưa chạy lại).'
          : st.stale ? `Mod AIZones không báo từ ${ago(st.t)}, server tắt hoặc mod lỗi.`
            : <>AI đang sống trên server: <b>{st.total ?? '?'}</b> / {st.cap ?? d.globalMax} (cả AI game tự sinh). Chạm mức này thì vùng ngừng sinh, người chơi phải săn bớt.</>}
        <br />Điểm đứng đã biết trên đảo: {data.groundPoints} ô 25 m.
        {az.dirty && <><br /><b className={s.warnTxt}>Có thay đổi chưa lưu.</b></>}
      </div>
      <details className={s.howto}><summary>Cách dùng</summary>
        <p>Bấm <b>+ Vùng mới</b> rồi bấm lên bản đồ để đặt tâm. Chọn kiểu <b>Tròn</b>, <b>Bầu dục</b> (bãi biển, bờ sông) hoặc
          <b> Đa giác</b> (tự vẽ, bấm từng điểm). Kéo bên trong để dời vùng, kéo núm để đổi kích thước.</p>
        <p>Vùng luôn được bù đủ <b>tối thiểu</b>; có người trong vùng thì mỗi lượt sinh thêm tới <b>tối đa</b>, không vượt tổng AI
          toàn server. AI thuộc vùng có viền cam trên bản đồ.</p>
        <p>{ambient && `Đang: ${word(ambient.live)} · sau restart: ${word(ambient.ini)}. `}Tắt "AI game tự sinh" để trên đảo chỉ còn loài của các vùng; con có sẵn dọn bằng
          tab <b>Làm mới</b> → "Chỉ AI không thuộc loài của vùng". Có hiệu lực ngay, giữ sau restart.</p>
      </details>
      <details className={s.sec}><summary>Loài không kích vùng <span className={s.n}>{ig.size ? `(${[...ig].join(', ')})` : '(không)'}</span></summary>
        <div className={s.hint2} style={{ margin: '4px 0 6px' }}>Người chơi loài được tick đi vào vùng thì vùng <b>không</b> sinh thêm AI (vd. cá sấu dưới hồ không
          làm vùng heo/hươu trên bờ sinh thêm). Vùng vẫn luôn giữ đủ số tối thiểu.</div>
        <div className={s.species}>{(data.playables ?? []).map((sp) => (
          <Checkbox key={sp} checked={ig.has(sp)} label={sp} onChange={(v) => { const n = new Set(d.ignoreOccupants); if (v) n.add(sp); else n.delete(sp); d.ignoreOccupants = [...n]; markAz(); }} />
        ))}</div>
      </details>
      <div className={s.listHead}><span className={s.groupLbl}>Các vùng</span>
        <Button variant="soft" small onClick={() => { az.placing = az.placing === 'new' ? null : 'new'; changed(); }}>{az.placing === 'new' ? 'Huỷ' : '+ Vùng mới'}</Button></div>
      <ul className={s.zones}>
        {d.zones.length === 0 && <li className={s.hint2} style={{ cursor: 'default' }}>Chưa có vùng nào.</li>}
        {d.zones.map((z) => {
          const zs = st?.zones?.[z.id];
          const n = zs && typeof zs.count === 'number' ? `${zs.count}/${zs.limit ?? z.max}${zs.occupied ? ' · có người' : ''}` : `${z.min}–${z.max}`;
          return (
            <li key={z.id} className={`${z.id === az.sel ? s.on : ''}${z.enabled ? '' : ` ${s.off}`}`} onClick={() => { selectAiZone(z.id); flyTo(aiZoneShape(z).at, 3); }}>
              <span className={s.dot} style={{ background: z.prison ? '#a855f7' : '#fb923c' }} />{z.prison ? `🔒 ${z.name}` : z.name}<span className={s.n}>{z.prison ? 'nhà tù' : n}</span>
            </li>
          );
        })}
      </ul>
      {zn && (
        <div className={s.edit}>
          <div className={`${s.row} ${s.rowWide}`}><TextInput maxLength={40} aria-label="Tên vùng" placeholder="Tên vùng" value={zn.name} onChange={(e) => set((z) => { z.name = e.target.value; })} />
            <span style={{ flex: 'none' }}><Switch checked={zn.enabled} onChange={(v) => set((z) => { z.enabled = v; })} label="Bật" /></span></div>
          <div className={s.seg} role="radiogroup" aria-label="Hình dạng vùng">
            {SHAPES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={shape === k} className={shape === k ? s.on : undefined} onClick={() => shapeZone(zn, k)}>{l}</button>)}
          </div>
          {shape !== 'polygon' && (
            <div className={s.grid}>
              {num(shape === 'ellipse' ? 'Bán kính dọc (m)' : 'Bán kính (m)', 'radiusM', 50, 5000, 50, true)}
              {shape === 'ellipse' && num('Bán kính ngang (m)', 'radius2M', 50, 5000, 50, true)}
              {shape === 'ellipse' && num('Góc xoay (°)', 'angleDeg', -180, 180, 5, true)}
            </div>
          )}
          {shape === 'polygon' && (
            <div className={s.row}><span className={s.hint2}>{az.drawing ? `Đang vẽ: ${az.drawing.pts.length} điểm` : `${zn.poly?.length ?? 0} điểm · rộng ~${reachM(zn) * 2} m`}</span>
              <Button variant="soft" small onClick={() => (az.drawing ? finishPolyDraw() : startPolyDraw(zn))}>{az.drawing ? 'Xong' : 'Vẽ lại'}</Button></div>
          )}
          <details className={s.sec} open><summary>Loại AI</summary>
            <div className={s.species}>
              {([['animal', 'Thú'], ['dino', 'Khủng long']] as const).map(([kind, label]) => (
                <div key={kind} style={{ display: 'contents' }}>
                  <div className={s.k}>{label}</div>
                  {data.species.filter((x) => x.kind === kind).map((x) => (
                    <Checkbox key={x.key} checked={zn.species.includes(x.key)} label={x.label}
                      onChange={(v) => set((z) => { const on = new Set(z.species); if (v) on.add(x.key); else on.delete(x.key); z.species = [...on]; })} />
                  ))}
                </div>
              ))}
            </div>
          </details>
          <details className={s.sec} open><summary>Số lượng</summary>
            <div className={s.grid}>
              {num('Tối thiểu (luôn có)', 'min', 0, 200)}
              {num('Tối đa (khi có người)', 'max', 0, 200)}
              {num('Mỗi lượt sinh từ', 'perTurnMin', 1, 5)}
              {num('…đến (con)', 'perTurnMax', 1, 5)}
              {num('Mỗi lượt cách (giây)', 'everySec', 10, 3600, 10)}
            </div>
          </details>
          <Switch checked={zn.water === true} onChange={(v) => set((z) => { z.water = v; })} label={<span>Vùng nước <span className={s.n}>, ven hồ/sông: cá sấu (và loài "không kích vùng") cũng kích vùng này</span></span>} />
          <Switch checked={zn.smallOnly === true} onChange={(v) => set((z) => { z.smallOnly = v; })} label={<span>Chỉ dino nhỏ <span className={s.n}>, dino lớn bị cảnh báo rồi ong đốt (luật ở tab <b>Dino nhỏ</b>)</span></span>} />
          <Switch checked={zn.prison === true} onChange={(v) => set((z) => {
            // One prison only: ticking it here unticks it elsewhere.
            z.prison = v;
            if (v) for (const o of d.zones) if (o !== z) o.prison = false;
          })} label={<span>🔒 Nhà tù <span className={s.n}>, không sinh AI; tù nhân được thả ở các điểm mặt đất trong vùng (chỉ 1 vùng; cài đặt ở <a href="#players/prison">Người chơi → Nhà tù</a>)</span></span>} />
          <details className={s.sec}><summary>Nâng cao</summary>
            <div className={s.grid}>
              {num('AI cách nhau tối thiểu (m)', 'spacingM', 0, 300, 5)}
              <label>Growth thấp nhất (%)<NumberInput aria-label="Growth thấp nhất (%)" min={10} max={100} step={5} value={Math.round(zn.growthMin * 100)} onChange={(v) => set((z) => { z.growthMin = Math.round(v) / 100; })} /></label>
              <label>Growth cao nhất (%)<NumberInput aria-label="Growth cao nhất (%)" min={10} max={100} step={5} value={Math.round(zn.growthMax * 100)} onChange={(v) => set((z) => { z.growthMax = Math.round(v) / 100; })} /></label>
            </div>
          </details>
          <div className={s.hint2}>{pts === undefined ? 'Điểm spawn: tính khi lưu.'
            : pts === 0 ? '⚠ Chưa có điểm spawn: chưa người chơi hay AI nào từng đứng trong vùng này. Vùng sẽ bắt đầu sinh khi có người đi qua (điểm cập nhật 10 phút/lần).'
              : `Điểm spawn: ${pts} chỗ người chơi / AI đã từng đứng trong vùng (AI chỉ được đặt ở đó, không bao giờ dưới đất hay giữa không trung).`}</div>
          <div className={s.row} style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Button variant="ghost" small onClick={() => { az.placing = az.placing && az.placing !== 'new' ? null : az.sel; changed(); }}>{az.placing && az.placing !== 'new' ? 'Huỷ đặt tâm' : 'Đặt lại tâm'}</Button>
            <Button variant="ghost" small className={s.ghostKill} onClick={() => { d.zones = d.zones.filter((z) => z.id !== az.sel); az.sel = null; markAz(); }}>Xoá vùng</Button>
          </div>
        </div>
      )}
      <Button onClick={save}>Lưu vùng AI</Button>
    </div>
  );
}
