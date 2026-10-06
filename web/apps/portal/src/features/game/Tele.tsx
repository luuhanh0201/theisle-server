import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { useToast } from '../../app/toast';
import { RelBadge } from '../../components/RelBadge';
import { ERROR_VI, waitCommand } from '../../lib/commands';
import { ME } from '../../lib/queries';

/** How a tele countdown ended (garage/tele.lua tele_result reasons). */
export const TELE_FINAL_VI: Record<string, string> = {
  moved: 'bạn đã rời khỏi bán kính 5 m', damage_dealt: 'bạn đã gây sát thương', damage_taken: 'bạn đã chịu sát thương',
  left: 'bạn đã thoát game hoặc dino đã chết', not_same_dino: 'không còn là con dino lúc bắt đầu',
  target_gone: 'người đưa mã đã thoát game hoặc dino đã chết', target_air: 'người đưa mã đang bay, bơi hoặc rơi',
  target_growth: 'dino của người đưa mã đã lớn quá mức cho phép', growth: 'dino của bạn đã lớn quá mức cho phép',
  prison: 'một trong hai đang ở tù', failed: 'không dịch chuyển được',
};
const growthPct = (g: number | null | undefined): number | null => (typeof g === 'number' ? Math.floor(g * 100 + 1e-6) : null);
const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;
/** A code as typed: capitals, digits, spaces and dashes only. */
export const cleanCode = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9 -]/g, '');

async function teleCall(body: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const r = await fetch('/api/tele', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> | null };
}

/**
 * Tele con non (bridge tele.ts, DinoGarage garage/tele.lua): A takes a code, B types it, B's dino is moved
 * next to A's after a short stand-still. Both small (me.tele: the limits), B not in a fight just before.
 */
export function Tele({ me }: { me: PlayerMe | null | undefined }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<{ kind: '' | 'ok' | 'bad'; node: ReactNode } | null>(null);
  const [, tick] = useState(0);
  // The code's time left counts down every second.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const t = me?.tele ?? null;
  if (!me || !t) return <div className="card" id="game-tele-card" hidden />;
  const refresh = (): Promise<unknown> => qc.refetchQueries({ queryKey: [ME] }).catch(() => undefined);

  const same = t.maxGrowthPct === t.targetMaxGrowthPct;
  const sub = `${same ? `Cả hai dino từ ${t.maxGrowthPct}%` : `Người tới từ ${t.maxGrowthPct}%, người đưa mã từ ${t.targetMaxGrowthPct}%`} trở xuống · đứng yên ${t.countdownS} giây, không giao tranh trong ${t.combatS} giây trước đó`;
  const locked = t.locked ?? '';
  const g = me.dino ? growthPct(me.dino.growth) : null;
  const inGame = Boolean(me.dino);

  // Giving a code: where the other one lands.
  const code = t.code;
  const left = code ? Math.max(0, code.expiresAt - Math.floor(Date.now() / 1000)) : 0;
  const giveWhy = locked ? 'Đang thử nghiệm, chưa dùng được.' : !inGame ? 'Vào game và điều khiển dino để lấy mã.'
    : g !== null && g > t.targetMaxGrowthPct ? `Dino của bạn ${g}%: chỉ dino từ ${t.targetMaxGrowthPct}% trở xuống mới lấy mã được.` : '';
  const codeMeta = giveWhy && !code ? giveWhy
    : code?.inUse ? 'Có người đang dùng mã này, chờ vài giây…'
      : code && left > 0 ? `Hết hạn sau ${mmss(left)} · dùng được 1 lần. Đưa mã cho người cần tới chỗ bạn.`
        : `Mã dùng được ${t.codeMinutes} phút, 1 lần. Lấy mã rồi đưa cho người cần tới chỗ bạn.`;

  // Using a code: going there.
  const tooBig = g !== null && g > t.maxGrowthPct;
  const goWhy = locked ? '' : !inGame ? 'Vào game và điều khiển dino để dịch chuyển.'
    : tooBig ? `Dino của bạn ${g}%: chỉ dino từ ${t.maxGrowthPct}% trở xuống mới tele được.`
      : t.cooldownLeft > 0 ? `Tele đang hồi: chờ ${t.cooldownLeft} giây.` : '';
  const goDisabled = Boolean(locked) || Boolean(goWhy) || busy;

  const getCode = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await teleCall({ action: 'code' });
      toast(r.status === 200 ? `✅ Mã tele: ${String(r.body?.['code'])}` : `❌ ${String(r.body?.['error'] ?? 'Không lấy được mã.')}`);
    } catch { toast('❌ Mất kết nối. Thử lại.'); } finally { await refresh(); setBusy(false); }
  };
  const drop = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try { await teleCall({ action: 'drop' }); } catch { /* the next refresh shows it */ } finally { await refresh(); setBusy(false); }
  };
  const copy = async (): Promise<void> => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code.code); toast(`📋 Đã sao chép mã ${code.code}`); } catch { toast(`Mã: ${code.code}`); }
  };
  const go = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const c = input.trim();
    if (busy || goDisabled || !c) return;
    setBusy(true);
    setStatus({ kind: '', node: 'Đang gửi…' });
    try {
      const r = await teleCall({ action: 'use', code: c });
      if (r.status === 429) { setStatus({ kind: 'bad', node: 'Chậm lại chút: mỗi vài giây chỉ một lệnh.' }); return; }
      const id = r.body?.['id'];
      if (r.status !== 202 || typeof id !== 'number') { setStatus({ kind: 'bad', node: `❌ ${String(r.body?.['error'] ?? 'Không tele được.')}` }); return; }
      const toName = typeof r.body?.['to'] === 'string' ? r.body['to'] as string : '';
      const to = toName ? <> tới <b>{toName}</b></> : null;
      setStatus({ kind: '', node: <>Đã gửi{to}, chờ game xử lý…</> });
      const start = await waitCommand(id, 20, (b) => b.status === 'done');
      if (start === null) { setStatus({ kind: 'bad', node: 'Chưa thấy game trả lời. Thử lại sau ít phút.' }); return; }
      const msgs = (start.messages ?? []).length > 0 ? <ul>{(start.messages ?? []).map((m, i) => <li key={i}>{m}</li>)}</ul> : null;
      if (!start.ok) {
        const err = start.error ? ERROR_VI[start.error] ?? start.error : '';
        setStatus({ kind: 'bad', node: <>❌ {err || 'Game từ chối.'}{msgs}</> });
        return;
      }
      setStatus({ kind: '', node: <>⏳ Đứng yên{to}…{msgs}</> });
      const cd = typeof r.body?.['countdownS'] === 'number' ? r.body['countdownS'] as number : 5;
      const end = await waitCommand(id, cd + 20, (b) => b.final != null);
      if (end === null || !end.final) { setStatus({ kind: 'bad', node: 'Chưa thấy kết quả. Xem lại vị trí trong game.' }); return; }
      if (end.final.ok) { setStatus({ kind: 'ok', node: <>✅ Đã dịch chuyển{to}.</> }); setInput(''); }
      else setStatus({ kind: 'bad', node: `❌ Tele thất bại: ${TELE_FINAL_VI[end.final.reason ?? ''] ?? end.final.reason ?? 'không rõ lý do'}. Mã vẫn dùng được nếu chưa hết hạn.` });
    } catch {
      setStatus({ kind: 'bad', node: '❌ Mất kết nối. Thử lại.' });
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  return (
    <div className="card" id="game-tele-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">🌀 Tele con non <span id="tele-rel"><RelBadge b={me.releases?.['tele']} /></span></h3>
          <span className="card-subtitle" id="tele-sub">{sub}</span>
        </div>
      </div>
      <div className="tele-grid">
        <div className="tele-box">
          <div className="tele-h">Gọi người khác tới chỗ bạn</div>
          <div className="tele-code" id="tele-code" hidden={!code || left <= 0}><b id="tele-code-text">{code?.code}</b><button type="button" className="btn-copy" id="tele-copy" onClick={() => void copy()}>Sao chép</button></div>
          <div className="tele-meta muted" id="tele-code-meta">{codeMeta}</div>
          <div className="tele-row">
            <button type="button" className="btn btn-emerald" id="tele-get" disabled={Boolean(giveWhy) || busy || code?.inUse === true} onClick={() => void getCode()}>{code && left > 0 ? 'Đổi mã' : 'Lấy mã'}</button>
            <button type="button" className="btn btn-ghost" id="tele-drop" hidden={!code || left <= 0 || code.inUse} onClick={() => void drop()}>Huỷ mã</button>
          </div>
        </div>
        <div className="tele-box">
          <div className="tele-h">Tới chỗ người đưa mã</div>
          <form className="tele-row" id="tele-form" autoComplete="off" onSubmit={(e) => void go(e)}>
            <input className="tele-input" id="tele-input" type="text" maxLength={8} placeholder="Mã 6 ký tự" spellCheck={false} aria-label="Mã tele"
              value={input} disabled={Boolean(locked) || tooBig || !inGame} onChange={(e) => setInput(cleanCode(e.target.value))} />
            <button type="submit" className="btn btn-emerald" id="tele-go" disabled={goDisabled}>Dịch chuyển</button>
          </form>
          <div className="tele-meta muted" id="tele-go-meta">{goWhy || `Nhập mã người kia đưa, đứng yên ${t.countdownS} giây. Hồi ${t.cooldownS} giây sau mỗi lần.`}</div>
        </div>
      </div>
      <div className={`garage-status${status?.kind ? ` ${status.kind}` : ''}`} id="tele-status" hidden={!status} role="status">{status?.node}</div>
      <div className="tele-note" id="tele-locked" hidden={!locked}>{locked ? `🧪 ${locked}` : ''}</div>
    </div>
  );
}
