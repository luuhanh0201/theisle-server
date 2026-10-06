import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adminFetch, type ServerStatusFull } from '@isle/api';
import { Button, Card, CardBody, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { useSession } from '../../../app/session';
import { ago, dur } from '../../../lib/time';
import { CountdownPick } from './CountdownPick';
import { KIND_VN, PHASE_VN, STEP_VN, flowOf, fmtClock } from './labels';
import s from './Ops.module.css';

export const STATUS_URL = '/api/server/status';

/** Server → Vận hành: the phase, the facts, start / restart / stop, and the operation under way. */
export function PowerCard({ status }: { status: ServerStatusFull }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const countdown = useRef(300);
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: [STATUS_URL] }); };
  // Older bridges do not send their clock: fall back to the browser's.
  const offset = Number.isFinite(status.now) ? (status.now as number) - Date.now() : 0;

  const ask = (kind: 'start' | 'stop' | 'restart'): void => {
    if (kind === 'start') {
      void withToken('bật server', async (token) => {
        await adminFetch('/api/server/start', 'POST', token, {});
        toast('Đang bật server…');
        refresh();
      });
      return;
    }
    const stop = kind === 'stop';
    countdown.current = 300;
    confirm({
      title: stop ? 'Tắt server?' : 'Khởi động lại server?',
      body: <>
        {stop ? <>Server sẽ <b>tắt hẳn</b>, không ai vào được cho tới khi bật lại.</> : 'Mọi người chơi sẽ bị ngắt kết nối trong lúc server khởi động lại.'}
        {' '}Nếu có RCON: người chơi được báo đếm ngược và game được <b>lưu</b> trước khi tắt.
        <CountdownPick pick={countdown} id="pw-cd" />
      </>,
      okLabel: stop ? 'Tắt server' : 'Khởi động lại',
      withReason: true,
      run: async (token, reason) => {
        await adminFetch(`/api/server/${kind}`, 'POST', token, { countdownSeconds: countdown.current, reason });
        toast(stop ? 'Đã lên lịch tắt server.' : 'Đã lên lịch khởi động lại.');
        refresh();
      },
    });
  };

  const phase = status.phase;
  const u = status.unit;
  const busy = status.operation !== null;
  return (
    <Card>
      <CardBody>
        <div className={`${s.phase} ${s[phase] ?? ''}`}><span className={s.led} />{PHASE_VN[phase] ?? phase}</div>
        {status.error && <div className={s.warnbox} style={{ marginTop: 10 }}>{status.error}</div>}
        <div className={s.facts}>
          <Fact k="Chạy từ" v={u?.since ? `${dur(Math.floor(Date.now() / 1000) - u.since)} trước` : '-'} />
          <Fact k="Mod nạp lần cuối" v={status.modsLoadedAt ? ago(status.modsLoadedAt) : '-'} />
          <Fact k="systemd" v={u ? `${u.activeState}${u.pid ? ` · PID ${u.pid}` : ''}` : '-'} />
          <Fact k="RCON" v={status.rconEnabled ? <span className={`${s.chip} ${s.on}`}>bật</span> : <span className={`${s.chip} ${s.off}`}>chưa cấu hình</span>} />
        </div>
        <div className={s.powerButtons}>
          <Button variant="soft" disabled={busy || phase === 'running' || phase === 'starting'} onClick={() => ask('start')}>▶ Bật server</Button>
          <Button variant="soft" disabled={busy || phase === 'stopped'} onClick={() => ask('restart')}>↻ Khởi động lại</Button>
          <Button variant="danger" disabled={busy || phase === 'stopped'} onClick={() => ask('stop')}>■ Tắt server</Button>
        </div>
        <Operation status={status} offset={offset} onCancel={() => void withToken('huỷ', async (token) => {
          await adminFetch('/api/server/cancel', 'POST', token, {});
          toast('Đã huỷ.');
          refresh();
        })} />
      </CardBody>
    </Card>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className={s.tile}><div className={s.k}>{k}</div><div className={s.v}>{v}</div></div>;
}

/** The operation under way (its steps, the countdown ticking), or the last one. */
function Operation({ status, offset, onCancel }: { status: ServerStatusFull; offset: number; onCancel: () => void }) {
  const op = status.operation;
  const [, tick] = useState(0);
  useEffect(() => {
    if (op?.step !== 'countdown') return undefined;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [op?.step]);
  if (!op) {
    const last = status.lastOperation;
    if (!last) return null;
    return (
      <div className={s.opBox}>
        <div className={s.hint}>Lần gần nhất: <b>{KIND_VN[last.kind]}</b> · {STEP_VN[last.step] ?? last.step}
          {last.finishedAt ? ` · ${ago(Math.floor(last.finishedAt / 1000))}` : ''}
          {last.message && <div className={last.step === 'failed' ? s.warnbox : s.muted} style={{ marginTop: 6 }}>{last.message}</div>}</div>
      </div>
    );
  }
  const flow = flowOf(op.kind);
  const at = flow.indexOf(op.step);
  return (
    <div className={s.opBox}>
      <div className={s.opTop}>
        <div>
          <div className={s.hint}>{KIND_VN[op.kind]}{op.reason ? ` · ${op.reason}` : ''}
            {op.source !== 'admin' && <> · <span className={`${s.chip} ${s.grow}`}>{op.source === 'schedule' ? 'định kỳ' : 'áp dụng cấu hình'}</span></>}</div>
          <div className={s.big} aria-live="polite">{op.step === 'countdown' ? fmtClock(op.runAt - (Date.now() + offset)) : STEP_VN[op.step]}</div>
        </div>
        {op.step === 'countdown' && <Button variant="soft" onClick={onCancel}>Huỷ</Button>}
      </div>
      <div className={s.steps}>
        {flow.map((st, i) => <span key={st} className={i === at ? s.stepOn : i < at ? s.stepDone : ''}>{i < at ? '✓ ' : ''}{STEP_VN[st]}</span>)}
      </div>
    </div>
  );
}
