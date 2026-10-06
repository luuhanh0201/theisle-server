import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type PlayerRow } from '@isle/api';
import { Button, Card, CardBody, CardHead, Checkbox, GroupLabel, Icon, NumberInput, Slider, SuggestInput, Switch, TextInput, useToast } from '@isle/ui';
import { StoredDinoCard } from '../../../components/dino/StoredDinoCard';
import { PRIME_TASKS } from '../../../components/dino/Prime';
import { dinoName, hue, pct, shortId } from '../../../lib/format';
import { ago } from '../../../lib/time';
import { useConfirm } from '../../../app/confirm';
import { useSession } from '../../../app/session';
import { GEN_LABEL } from '../../mutations/reference';
import { useMutationData } from '../../mutations/useMutationData';
import { ExpectedCard, GrowthStats, type SpeciesStats } from './Expected';
import { MutationPicker } from './MutationPicker';
import { DEFAULT_PRIME, MUT_NAME_RE, PRIME_MIN, SLOT_LABEL, codeOf, fillPrime, freeSlotName, impliedStacks, keepOffered, mutationChoices, primeCount, toggleTask } from './logic';
import c from './Creator.module.css';


const PRESETS: ReadonlyArray<[number, string]> = [[10, 'Sơ sinh'], [25, 'Juvenile'], [50, 'Sub-adult'], [75, 'Sub-adult'], [100, 'Trưởng thành']];
const STEAM_RE = /^\d{17}$/;

interface SlotMeta { classPath: string; growth?: number; capturedAt?: number }

/** A value that follows `v` after `ms` without a change (the stats request while the slider moves). */
function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** A player to fill in from elsewhere (#garage/<SteamID>, a player's page): taken once by the creator. */
let pendingPlayer: string | null = null;
export function prefillCreator(steamId: string): void { pendingPlayer = steamId; }

/**
 * Gara → Tạo dino vào gara: a dino made into a player's garage, for them to take out on the web.
 * Five steps (player and slot, species, growth / stomach / prime, mutations, confirm) and a live
 * preview: the maxima it will have, and the slot as it will be stored.
 */
export function DinoCreator() {
  const toast = useToast();
  const confirm = useConfirm();
  const { me, tokenNow } = useSession();
  const qc = useQueryClient();
  const { data: mutData, catalog, refetch: refetchMut } = useMutationData();
  const players = useQuery({ queryKey: ['/api/players'], queryFn: () => getJson<{ players: PlayerRow[] }>('/api/players'), refetchInterval: 5000 }).data?.players ?? [];
  const writes = useQuery({ queryKey: ['/api/health'], queryFn: () => getJson<{ writesEnabled: boolean }>('/api/health') }).data?.writesEnabled !== false;

  const [steamId, setSteamId] = useState(() => { const p = pendingPlayer; pendingPlayer = null; return p ?? ''; });
  const [slot, setSlot] = useState('admin');
  const [species, setSpecies] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [manualClass, setManualClass] = useState('');
  const [growth, setGrowth] = useState(100);
  const [stomach, setStomach] = useState(true);
  const [nutrient, setNutrient] = useState(50);
  const [prime, setPrime] = useState(false);
  const [stacks, setStacks] = useState(0);
  const [tasks, setTasks] = useState(DEFAULT_PRIME);
  const [taskSrc, setTaskSrc] = useState('');
  const [allow, setAllow] = useState(false);
  const [mutations, setMutations] = useState<Record<string, string>>({});
  const [overwriteOk, setOverwriteOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { if (steamId) document.getElementById('creator-card')?.scrollIntoView({ behavior: 'smooth' }); }, []);   // a prefilled player: show the form

  const entry = catalog.find((x) => x.species === species) ?? null;
  const classPath = manual ? manualClass.trim() : entry?.classPath ?? '';
  const shortSpecies = classPath ? classPath.split('.').pop() ?? null : null;
  const primeOn = prime && growth >= PRIME_MIN;

  // A choice no longer offered (species changed, "allow unconfirmed" off) falls back to empty.
  useEffect(() => {
    const { own, others } = mutationChoices(catalog, shortSpecies, allow);
    setMutations((m) => { const k = keepOffered(m, new Set([...own, ...others])); return Object.keys(k).length === Object.keys(m).length ? m : k; });
  }, [catalog, shortSpecies, allow]);
  useEffect(() => { if (growth < PRIME_MIN) setPrime(false); }, [growth]);

  // The target player's garage: the slots there, and the red box when the chosen name is taken.
  const validId = STEAM_RE.test(steamId.trim());
  const existing = useQuery({
    queryKey: ['/api/garage', steamId.trim()], enabled: validId,
    queryFn: () => getJson<{ slots: Record<string, SlotMeta> }>(`/api/garage/${steamId.trim()}`), refetchInterval: 5000,
  }).data?.slots ?? null;
  const hit = existing && validId ? existing[slot.trim()] : undefined;
  useEffect(() => { setOverwriteOk(false); }, [steamId, slot]);

  // The player's prime tasks for this species, from their dino of it with the most (/api/prime-last).
  const [primeKey, setPrimeKey] = useState('');
  const loadLastPrime = async (force = false): Promise<void> => {
    const id = steamId.trim();
    const key = `${id}|${classPath}`;
    if (!STEAM_RE.test(id) || !classPath || (!force && key === primeKey)) return;
    setPrimeKey(key);
    setTaskSrc('đang tìm…');
    try {
      const { last } = await getJson<{ last: { t: number; growth: number | null; conditions: Record<string, boolean> } | null }>(
        `/api/prime-last?steamId=${id}&species=${encodeURIComponent(classPath.split('.').pop() ?? '')}`);
      let code = last ? codeOf(last.conditions) : DEFAULT_PRIME;
      let src = last ? `theo lần nhiều nhiệm vụ nhất của loài này (${new Date(last.t * 1000).toLocaleString('vi-VN')}${last.growth != null ? `, ${Math.round(last.growth * 100)}%` : ''})`
        : 'chưa thấy dino loài này của người này · mặc định của dino mới';
      if (prime && primeCount(code) < 5) { code = fillPrime(code); src = 'đã tự thêm cho đủ 5 · prime cần ít nhất 5 nhiệm vụ'; }
      setTasks(code); setTaskSrc(src);
    } catch {
      setTaskSrc('không tra được');
    }
  };
  useEffect(() => { void loadLastPrime(); }, [steamId, classPath]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The maxima at this growth, for the slider's line and the preview (asked 150 ms after the last move).
  const statsKey = useDebounced(shortSpecies ? `${shortSpecies}|${growth}` : '', 150);
  const stats = useQuery({
    queryKey: ['/api/species-stats', statsKey], enabled: statsKey !== '',
    queryFn: () => { const [sp, g] = statsKey.split('|'); return getJson<SpeciesStats>(`/api/species-stats?species=${encodeURIComponent(sp!)}&growth=${Number(g) / 100}`); },
    placeholderData: (prev) => prev,
  }).data ?? null;
  const statsNow = stats && stats.species === shortSpecies ? stats : null;

  const known = players.find((p) => p.steamId === steamId.trim());
  const stacksWanted = stacks > 0 ? Math.min(10, stacks) : null;
  const want = impliedStacks(mutations);
  const anyMut = Object.values(mutations).some(Boolean);
  const takenSlots = useMemo(() => new Set(Object.keys(existing ?? {})), [existing]);

  const editNote = (name: string): void => confirm({
    title: `Mô tả mutation ${name.replace(/^MUT_/, '').replace(/_/g, ' ')}`,
    body: <><span className={c.mono}>{name}</span>, hiện khi rê chuột vào <b>!</b>, ưu tiên hơn mô tả theo wiki.
      Để trống để xoá và quay về mô tả theo wiki. Chỉ admin thấy, người chơi không thấy.</>,
    okLabel: 'Lưu mô tả', danger: false,
    text: { label: 'Mô tả (tối đa 500 ký tự)', long: true, value: mutData?.notes[name]?.description ?? '' },
    run: async (token, _r, text) => {
      const { note } = await adminFetch<{ note: unknown }>(`/api/mutations/${encodeURIComponent(name)}`, 'PUT', token, { description: text });
      toast(note ? `Đã lưu mô tả ${name}.` : `Đã xoá mô tả ${name}.`);
      refetchMut();
    },
  });

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const id = steamId.trim(), sl = slot.trim();
    const bad = Object.entries(mutations).find(([, v]) => v && !MUT_NAME_RE.test(v));
    if (!STEAM_RE.test(id)) { setResult({ ok: false, text: 'SteamID64 gồm 17 chữ số.' }); return; }
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(sl)) { setResult({ ok: false, text: 'Tên slot: chữ, số, _ hoặc -, tối đa 32 ký tự.' }); return; }
    if (!classPath || bad) { setResult({ ok: false, text: !classPath ? 'Chọn một loài dino trước.' : `Tên mutation ở ${SLOT_LABEL(bad![0])} không hợp lệ.` }); return; }
    if (primeOn && primeCount(tasks) < 5) { setResult({ ok: false, text: 'Prime cần ít nhất 5/10 nhiệm vụ, game không cho prime nếu thiếu. Tick thêm nhiệm vụ hoặc bỏ Prime.' }); return; }
    const token = await tokenNow('tạo dino vào gara');
    if (token === null) return;
    setBusy(true);
    setResult({ ok: true, text: 'Đang gửi…' });
    try {
      const body = await adminFetch<{ meta?: { replaced?: string } }>(`/api/garage/${encodeURIComponent(id)}/${encodeURIComponent(sl)}`, 'POST', token, {
        classPath, growth: growth / 100, mutations: Object.fromEntries(Object.entries(mutations).filter(([, v]) => v)),
        stomachFull: stomach, nutrientPct: Math.max(0, Math.min(100, Math.round(nutrient))),
        ...(primeOn ? { isPrime: true } : {}), ...(stacksWanted !== null ? { elderStacks: stacksWanted } : {}),
        primeConditions: tasks, allowUnconfirmedMutations: allow, overwrite: hit !== undefined && overwriteOk,
      });
      setOverwriteOk(false);
      setResult({ ok: true, text: `✓ Đã tạo ${dinoName(classPath)} ${growth}%${primeOn ? ' 👑 Prime' : ''} vào ${id} / ${sl}. `
        + 'Người chơi spawn đúng loài này rồi bấm Lấy ra trên trang web (mục Gara).' + (body.meta?.replaced ? ` Con cũ đã sao lưu: deleted/${body.meta.replaced}` : '') });
      await qc.invalidateQueries({ queryKey: ['/api/garage'] });
    } catch (err) {
      setResult({ ok: false, text: `Lỗi: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const now = Math.floor(Date.now() / 1000);
  return (
    <Card id="creator-card">
      <CardHead title="Tạo dino vào gara" sub="Tạo sẵn dino vào gara của người chơi để họ nhận trên web (Gara → Lấy ra)">
        <button type="button" className={c.linkBtn} style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑ Xem danh sách cất</button>
      </CardHead>
      <CardBody>
        <form className={c.creator} autoComplete="off" onSubmit={(e) => void submit(e)}>
          <div>
            <div className={c.step}>
              <div className={c.stepTitle}><span className={c.stepNum}>1</span><span>Người chơi &amp; Tên slot</span><span className={c.stepBadge}>Bắt buộc</span></div>
              <div className={c.fieldsGrid}>
                <div className={c.fieldWrap}>
                  <label htmlFor="f-steam" className={c.label}>SteamID64 người nhận</label>
                  <div className={c.withIcon}><Icon name="user" />
                    <SuggestInput id="f-steam" value={steamId} onChange={setSteamId} placeholder="Gõ tên hoặc dán SteamID64 (17 số)…"
                      suggestions={players.map((p) => ({ value: p.steamId, label: `${p.name ?? ''} · ${dinoName(p.species)}` }))} />
                  </div>
                  <div className={c.hint}>{known ? <>Gửi cho <b>{known.name ?? shortId(known.steamId)}</b>{known.online ? ' · đang online' : ''}</>
                    : validId ? 'Người này chưa từng xuất hiện trong log, vẫn tạo được.' : ''}</div>
                </div>
                <div className={c.fieldWrap}>
                  <label htmlFor="f-slot" className={c.label}>Tên slot trong gara</label>
                  <TextInput id="f-slot" value={slot} maxLength={32} placeholder="Ví dụ: admin, slot1…" onChange={(e) => setSlot(e.target.value)} />
                  <div className={c.hint}>Định danh cho slot này trong gara của người chơi.</div>
                </div>
              </div>
              {existing && validId && (
                <div className={c.slotChips}>
                  {Object.keys(existing).length === 0 ? <span className={c.muted}>Gara người này đang trống.</span> : <>
                    <span className={c.muted}>Gara hiện có ({Object.keys(existing).length}/5):</span>
                    {Object.entries(existing).map(([n, m]) => <span key={n} className={`${c.slotChip}${n === slot.trim() ? ` ${c.hit}` : ''}`}><b>{n}</b> {dinoName(m.classPath)} {pct(m.growth)}</span>)}
                  </>}
                </div>
              )}
              {hit && (
                <div className={c.overwrite}>
                  <div className={c.alertIcon}><Icon name="warn" /></div>
                  <div className={c.alertContent}>
                    <div>Slot <span className={c.mono}>{slot.trim()}</span> đang chứa <b className={c.kill}>{dinoName(hit.classPath)} {pct(hit.growth)}</b>{hit.capturedAt ? ` (cất ${ago(hit.capturedAt)})` : ''}.
                      Tạo dino mới sẽ <b className={c.kill}>thay thế con này</b> trong gara của người chơi.</div>
                    <Checkbox checked={overwriteOk} onChange={setOverwriteOk} label={<span>Tôi hiểu và đồng ý ghi đè slot này (con cũ được sao lưu vào <span className={c.mono}>deleted/</span>)</span>} />
                    <div><button type="button" className={c.linkBtn} onClick={() => setSlot(freeSlotName(slot.trim(), takenSlots))}>Hoặc dùng tên trống: {freeSlotName(slot.trim(), takenSlots)}</button></div>
                  </div>
                </div>
              )}
            </div>

            <div className={c.step}>
              <div className={c.stepTitle}><span className={c.stepNum}>2</span><span>Chọn loài dino</span><span className={c.stepBadge}>Bắt buộc</span></div>
              <div className={c.hint}>Chỉ hiển thị các loài đã được xác nhận hoạt động trên server để đảm bảo người chơi nhận thành công.</div>
              <div className={c.speciesGrid}>
                {catalog.length === 0 ? (
                  <div className={`${c.banner} ${c.toneNeutral}`}><Icon name="warn" /><span>Chưa thấy loài nào. Danh sách tự đầy lên khi người chơi spawn trên server
                    (hoặc từ các dino họ đã cất). Tạm thời có thể nhập classPath thủ công.</span></div>
                ) : catalog.map((x) => {
                  const name = dinoName(x.species);
                  const ready = x.classPath !== null;
                  const seen = x.mutations.active.length + x.mutations.parent.length + x.mutations.elder.length;
                  return (
                    <button key={x.species} type="button" className={`${c.speciesOpt}${x.species === species && !manual ? ` ${c.on}` : ''}`} disabled={!ready}
                      title={ready ? undefined : 'Mới thấy tên loài, chưa biết classPath đầy đủ'} onClick={() => { setSpecies(x.species); setManual(false); }}>
                      <span className={c.speciesGlyph} style={{ background: `hsl(${hue(name)} 60% 45%)` }}>{name[0] ?? '?'}</span>
                      <span>{name}<small>{ready ? `${seen} mutation đã thấy` : 'chưa có classPath'}</small></span>
                    </button>
                  );
                })}
              </div>
              <div><button className={c.linkBtn} type="button" onClick={() => setManual(!manual)}>{manual ? 'Quay lại chọn từ danh sách' : 'Nhập classPath thủ công…'}</button></div>
              {manual && (
                <div>
                  <label htmlFor="f-class" className={c.label}>classPath</label>
                  <TextInput id="f-class" value={manualClass} placeholder="BlueprintGeneratedClass /Game/…/BP_X.BP_X_C" onChange={(e) => setManualClass(e.target.value)} />
                  <div className={`${c.banner} ${c.toneDmg}`} style={{ marginTop: 8 }}><Icon name="warn" />
                    <span>classPath chưa từng thấy trên server. Sai một ký tự là người chơi sẽ nhận lỗi "Wrong species" khi nhận dino.</span></div>
                </div>
              )}
            </div>

            <div className={c.step}>
              <div className={c.stepTitle}><span className={c.stepNum}>3</span><span>Tăng trưởng, Dạ dày &amp; Prime</span></div>
              <div className={c.vitalsPrime}>
                <div className={c.growthCol}>
                  <div className={c.growthPanel}>
                    <div className={c.growthHeader}><span className={c.label}>Mức tăng trưởng (Growth)</span><span className={c.growthVal}>{growth}%</span></div>
                    <Slider value={growth} min={0} max={100} onChange={setGrowth} aria-label="Growth" />
                    <div className={c.presets}>
                      {PRESETS.map(([g, stage]) => (
                        <button key={g} type="button" className={g === growth ? c.on : undefined} title={`${stage} ${g}%`} onClick={() => setGrowth(g)}>
                          <span className={c.chipStage}>{stage}</span><span className={c.chipPct}>{g}%</span></button>
                      ))}
                    </div>
                    <GrowthStats data={statsNow} growth={growth} prime={primeOn} />
                  </div>
                  <div className={c.vitalsCard}>
                    <div className={c.vitalsTitle}>Dinh dưỡng &amp; Dạ dày</div>
                    <div className={c.vitalsList}>
                      <div className={c.vitalsBox} style={{ justifyContent: 'flex-start' }}>
                        <Switch id="f-stomach" checked={stomach} onChange={setStomach} />
                        <label htmlFor="f-stomach" className={c.vitalsText} style={{ cursor: 'pointer' }}>
                          <span className={c.vitalsItemTitle}>Dạ dày đầy (100% thức ăn)</span><span className={c.vitalsDesc}>Lấp đầy thức ăn tối đa của dino khi lấy ra</span></label>
                      </div>
                      <div className={c.vitalsBox}>
                        <div className={c.vitalsText}><label htmlFor="f-nutrient" className={c.vitalsItemTitle}>Mức dinh dưỡng</label><span className={c.vitalsDesc}>Áp dụng theo mức server đã ghi nhận</span></div>
                        <div className={c.nutrientBox}><NumberInput id="f-nutrient" value={nutrient} min={0} max={100} step={5} onChange={setNutrient} /><span className={c.muted}>%</span></div>
                      </div>
                    </div>
                    <div className={c.hint}>Dạ dày được lấp đầy đúng mức tối đa của dino. Mức dinh dưỡng áp dụng khi đã đo được giá trị trên server.</div>
                  </div>
                </div>
                <div className={c.primeCard}>
                  <div className={c.primeHead}>
                    <Switch id="f-prime" checked={primeOn} disabled={growth < PRIME_MIN} label={<span className={c.primeTitle}>👑 Kích hoạt Prime Elder</span>}
                      onChange={(v) => { setPrime(v); if (v && primeCount(tasks) < 5) { setTasks(fillPrime(tasks)); setTaskSrc('đã tự thêm cho đủ 5 · prime cần ít nhất 5 nhiệm vụ'); } }} />
                    <div className={c.elderWrap}><label htmlFor="f-elder-stacks">Elder stacks:</label>
                      <span className={c.elderBox}><NumberInput id="f-elder-stacks" value={stacks} min={0} max={10} onChange={setStacks} /></span></div>
                  </div>
                  <div className={c.hint}>{growth < PRIME_MIN ? `Prime cần growth ≥ ${PRIME_MIN}% · game chỉ gắn prime cho dino đủ điều kiện từ mốc này.`
                    : <>Prime: khi lấy ra, dino được đặt <b>đủ điều kiện Prime Elder</b> (ServerSetPrimeEligible). Elder stacks: bộ đếm dòng dõi (0 = giữ nguyên). Kết quả thật ghi trong UE4SS.log: <span className={c.mono}>prime asked -&gt; eligible=… prime=…</span>.</>}</div>
                  <div className={c.primeTasks}>
                    <div className={c.primeTasksHead}>
                      <div className={c.primeTasksBar}>
                        <div className={c.primeTasksTitle}>Nhiệm vụ prime: <span className={`${c.countChip}${primeCount(tasks) >= 5 ? ` ${c.countOk}` : ''}`}>{primeCount(tasks)}/10{primeCount(tasks) >= 5 ? ' · đủ điều kiện' : ''}</span></div>
                        <Button variant="ghost" small title="Lần có nhiều nhiệm vụ nhất của người này với loài này" onClick={() => void loadLastPrime(true)}>Lấy lại từ lịch sử</Button>
                      </div>
                      <div className={c.primeSrc}>{taskSrc}</div>
                    </div>
                    <div className={c.primeGrid}>
                      {PRIME_TASKS.map((t, i) => (
                        <Checkbox key={t} checked={tasks[i] === '1'} label={`${i + 1}. ${t}`} onChange={(v) => { setTasks(toggleTask(tasks, i + 1, v)); setTaskSrc('đã sửa tay'); }} />
                      ))}
                    </div>
                    <div className={c.hint}>Dino lấy ra sẽ có đúng các nhiệm vụ được tick (đủ 5 là đủ điều kiện prime). Mặc định lấy từ dino gần nhất cùng loài của người chơi.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className={c.step}>
              <div className={c.stepTitle}><span className={c.stepNum}>4</span><span>Đột biến gen (Mutation)</span></div>
              <div className={c.hint}>Mỗi mutation phải đã được game ghi nhận trên chính loài này từ người chơi thật. Rê chuột vào <span className={c.infoBtn} style={{ cursor: 'default' }}>!</span> để xem mô tả. Để "trống" thì slot đó giữ nguyên.</div>
              <Switch checked={allow} onChange={setAllow} label="Cho phép cả mutation chưa xác nhận trên loài này (chỉ mới thấy trên loài khác)" />
              {anyMut && <div className={c.hint}>{want > stacks
                ? <><span style={{ color: 'var(--dmg)' }}>⚠ Đã chọn mutation elder tới cặp {want} (người chơi thật cần trùng sinh {want} lần) nhưng Elder stacks = {stacks}:
                  mọi mutation sẽ chỉ ở mức <b>{GEN_LABEL[Math.min(stacks, 3)]}</b>.</span> <Button variant="soft" small onClick={() => setStacks(want)}>Đặt Elder stacks = {want}</Button></>
                : <>Chỉ số mutation tính theo <b>{GEN_LABEL[Math.min(stacks, 3)]}</b> (Elder stacks = {stacks} lần trùng sinh), áp dụng cho mọi mutation của dino.</>}</div>}
              {(['active'] as const).map((g) => (
                <div key={g} className={c.mutBlock}><div className={c.mutGroupLabel}>Đột biến đang dùng (Active Slots)</div>
                  <MutationPicker group={g} catalog={catalog} data={mutData} species={shortSpecies} allow={allow} stacks={stacks} mutations={mutations}
                    onPick={(sl, n) => setMutations((m) => ({ ...m, [sl]: n }))} onEditNote={editNote} /></div>
              ))}
              <details className={c.mutExtra}>
                <summary>Đột biến từ cha mẹ (Parent) &amp; Elder</summary>
                {([['parent', 'Từ cha mẹ (Parent Slots)'], ['elder', 'Elder Slots']] as const).map(([g, label]) => (
                  <div key={g} className={c.mutBlock}><div className={c.mutGroupLabel}>{label}</div>
                    <MutationPicker group={g} catalog={catalog} data={mutData} species={shortSpecies} allow={allow} stacks={stacks} mutations={mutations}
                      onPick={(sl, n) => setMutations((m) => ({ ...m, [sl]: n }))} onEditNote={editNote} /></div>
                ))}
              </details>
            </div>

            <div className={c.step}>
              <div className={c.stepTitle}><span className={c.stepNum}>5</span><span>Xác nhận &amp; Cấp dino</span></div>
              {!me?.token && <div className={c.hint}>Vào qua SSH tunnel: admin token được hỏi khi bấm tạo.</div>}
              <div className={c.confirmBar}>
                <Button type="submit" variant={hit ? 'dangerSolid' : 'primary'} disabled={busy || !writes || (hit !== undefined && !overwriteOk)}>
                  <Icon name="plus" /><span>{hit ? 'Ghi đè dino' : 'Tạo dino'}</span></Button>
              </div>
              <div className={`${c.result}${result ? (result.ok ? ` ${c.resultOk}` : ` ${c.resultErr}`) : ''}`}>{result?.text ?? ''}</div>
            </div>
          </div>

          <div className={c.preview}>
            <div className={c.previewHead}><GroupLabel>Xem trước Dino sẽ tạo</GroupLabel><span className={c.liveDot} /></div>
            {!classPath ? <Card><CardBody><div className={c.muted} style={{ textAlign: 'center', padding: '28px 0', fontSize: 13 }}>Chọn một loài để xem trước</div></CardBody></Card> : <>
              <ExpectedCard data={statsNow} growth={growth} prime={primeOn} fill={[stomach ? 'dạ dày đầy' : null, `dinh dưỡng ${Math.round(nutrient)}%`].filter(Boolean).join(' · ')} />
              <StoredDinoCard slot={slot.trim() || 'admin'} meta={{ classPath, growth: growth / 100, capturedAt: now }} openMore
                state={{ classPath, growth: growth / 100, isPrime: primeOn || null, elderStacks: stacksWanted, primeConditions: tasks,
                  mutations: Object.fromEntries(Object.entries(mutations).filter(([, v]) => v)), createdBy: 'admin', version: 1 }} />
            </>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
