import type { Readiness } from '@isle/api';
import { Card, CardBody, CardHead } from '@isle/ui';
import { clock } from '../../../lib/format';
import { ago } from '../../../lib/time';
import s from './Ops.module.css';

const ICON = { ok: '✓', wait: '…', fail: '✕' } as const;

/** "Sẵn sàng trên game": every condition for the server to be listed in game and joinable (bridge/src/readiness.ts). */
export function ReadinessCard({ r }: { r: Readiness | undefined }) {
  return (
    <Card>
      <CardHead title="Sẵn sàng trên game" sub={r ? `kiểm tra lúc ${clock(r.checkedAt)}` : undefined} />
      <CardBody>
        {r && (
          <>
            <div className={`${s.verdict} ${s[r.verdict] ?? ''}`}><span className={s.led} />{r.summary}</div>
            <ul className={s.rdList}>
              {r.checks.map((c) => (
                <li key={c.id} className={s[c.state]}>
                  <span className={s.ic}>{ICON[c.state]}</span>
                  <div><b>{c.label}</b><small>{c.detail}{c.at ? ` · từ ${clock(c.at)} (${ago(c.at)})` : ''}</small></div>
                </li>
              ))}
            </ul>
            <div className={s.hint} style={{ marginTop: 10 }}>{r.lastJoin
              ? <>Người chơi vào gần nhất: <b>{r.lastJoin.name ?? '?'}</b> lúc {clock(r.lastJoin.t)} ({ago(r.lastJoin.t)}), bằng chứng chắc chắn server đã hiện và vào được.</>
              : 'Chưa có người chơi nào vào kể từ khi bridge chạy.'}</div>
          </>
        )}
        <div className={s.hint} style={{ marginTop: 6 }}>Danh sách server trong game do máy chủ của Warp Hosting (<span className={s.mono}>api.warphosting.com.au</span>) cung cấp
          và chỉ trả cho game client có vé Steam, panel không đọc được danh sách đó. Thay vào đó panel kiểm tra mọi điều kiện để server được liệt kê và vào được:
          tiến trình, mod, map, đăng nhập EOS, các cổng, và máy chủ danh sách còn hoạt động. Đủ hết = server hiện trong game (sau khi khởi động có thể mất 2-5 phút
          để danh sách cập nhật). Người chơi vào được là bằng chứng chắc chắn nhất.</div>
      </CardBody>
    </Card>
  );
}
