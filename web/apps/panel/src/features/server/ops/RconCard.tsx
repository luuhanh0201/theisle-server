import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type RconCommands } from '@isle/api';
import { Button, Card, CardBody, SectionTitle, TextInput, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { useSession } from '../../../app/session';
import { STATUS_URL } from './PowerCard';
import s from './Ops.module.css';

/** "RCON trực tiếp": the commands the bridge allows (bridge/src/rcon.ts), each one click; the answer under them. */
export function RconCard({ rconEnabled }: { rconEnabled: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const cmds = useQuery({ queryKey: ['/api/rcon/commands'], queryFn: () => getJson<RconCommands>('/api/rcon/commands'), staleTime: Infinity }).data;
  const [out, setOut] = useState('Kết quả RCON hiện ở đây.');
  const [v, setV] = useState({ announce: '', density: '', aiClasses: '', cls: '', wl: '' });
  const field = (k: keyof typeof v) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value }) });

  const call = async (name: string, args: string | undefined, token: string): Promise<void> => {
    const res = await adminFetch<{ response?: string }>(`/api/rcon/${name}`, 'POST', token, args === undefined ? {} : { args });
    setOut(`> ${name}${args !== undefined ? ` ${args}` : ''}\n${res.response || '(server không trả lời gì, với lệnh này là bình thường)'}`);
  };
  /** One button: its command, the value it sends (a box, which must not be empty), a confirm when it changes something at once. */
  const run = (label: string, name: string, arg?: keyof typeof v, ask?: string): void => {
    const args = arg ? v[arg].trim() : undefined;
    if (arg && !args) { toast('Nhập giá trị trước.', 'err'); return; }
    const done = (): void => { toast(`${label}: xong`); void qc.invalidateQueries({ queryKey: [STATUS_URL] }); };
    if (ask) {
      confirm({ title: ask, body: 'Thao tác có hiệu lực ngay trên server đang chạy.', okLabel: 'Thực hiện', danger: false,
        run: async (token) => { await call(name, args, token); done(); } });
      return;
    }
    void withToken(label, async (token) => { await call(name, args, token); done(); });
  };
  const toggles = Object.entries(cmds?.commands ?? {}).filter(([, c]) => c.toggle);

  return (
    <>
      <SectionTitle icon="⚡" title="RCON trực tiếp" sub="có hiệu lực ngay, không cần khởi động lại, mất khi server khởi động lại" />
      <Card><CardBody>
        {!rconEnabled && <div className={s.banner} style={{ marginBottom: 14 }}>RCON chưa được cấu hình trên bridge (RCON_PASSWORD trống), các thao tác dưới đây sẽ không chạy.</div>}
        <div className={s.rconGrid}>
          <div>
            <h3>Thông báo toàn server</h3>
            <div className={s.row}><TextInput aria-label="Thông báo toàn server" maxLength={200} placeholder="vd: Sự kiện săn Rex lúc 21h!" {...field('announce')} />
              <Button variant="soft" onClick={() => run('Gửi', 'announce', 'announce')}>Gửi</Button></div>
          </div>
          <div>
            <h3>Thao tác nhanh</h3>
            <div className={s.row}><Button variant="soft" onClick={() => run('💾 Lưu game', 'save')}>💾 Lưu game</Button>
              <Button variant="soft" onClick={() => run('🧹 Dọn xác', 'wipeCorpses', undefined, 'Dọn toàn bộ xác trên map?')}>🧹 Dọn xác</Button></div>
            <div className={s.hint} style={{ marginTop: 6 }}>Dọn xác <b>định kỳ</b> (mỗi N phút, có báo trước) và thông báo định kỳ:
              đặt ở <a href="#mods/messages">Tính năng mod → Thông báo → Tần suất</a>.</div>
          </div>
          <div>
            <h3>Bật / tắt</h3>
            <div className={s.hint} style={{ marginBottom: 8 }}>Game không báo trạng thái hiện tại, mỗi lần bấm là <b>đảo</b> trạng thái. Kiểm tra lại bằng "Thông tin server".</div>
            <div className={s.row}>{toggles.map(([name, c]) => (
              <Button key={name} variant="soft" onClick={() => run(`⇄ ${c.label}`, name, undefined, `Đảo trạng thái: ${c.label}?`)}>⇄ {c.label}</Button>
            ))}</div>
          </div>
          <div>
            <h3>AI</h3>
            <div className={s.row}><TextInput aria-label="Mật độ AI" inputMode="decimal" placeholder="mật độ, vd 1" {...field('density')} />
              <Button variant="soft" onClick={() => run('Đặt mật độ', 'adjustAiDensity', 'density')}>Đặt mật độ</Button></div>
            <div className={s.row} style={{ marginTop: 8 }}><TextInput aria-label="Loài AI cần tắt" placeholder="loài AI cần tắt, cách nhau dấu phẩy" {...field('aiClasses')} />
              <Button variant="soft" onClick={() => run('Tắt AI loài', 'disableAiClasses', 'aiClasses')}>Tắt AI loài</Button></div>
          </div>
          <div>
            <h3>Loài được chơi (tạm thời)</h3>
            <div className={s.row}><TextInput aria-label="Loài" placeholder="vd: Carnotaurus" {...field('cls')} />
              <Button variant="soft" onClick={() => run('Cho phép', 'addPlayable', 'cls')}>Cho phép</Button>
              <Button variant="soft" onClick={() => run('Cấm', 'removePlayable', 'cls')}>Cấm</Button></div>
            <div className={s.hint} style={{ marginTop: 6 }}>Mất khi server khởi động lại, muốn giữ lâu dài thì đặt ở <a href="#server/cfg">Cấu hình game → Loài &amp; điểm spawn</a>.</div>
          </div>
          <div>
            <h3>Whitelist</h3>
            <div className={s.row}><TextInput aria-label="SteamID whitelist" placeholder="SteamID64, cách nhau dấu phẩy" {...field('wl')} />
              <Button variant="soft" onClick={() => run('Thêm', 'addWhitelistIds', 'wl')}>Thêm</Button>
              <Button variant="soft" onClick={() => run('Bỏ', 'removeWhitelistIds', 'wl')}>Bỏ</Button></div>
          </div>
        </div>
        <h3 className={s.subhead}>Xem</h3>
        <div className={s.row} style={{ marginBottom: 10 }}>
          <Button variant="soft" onClick={() => run('Thông tin server', 'serverDetails')}>Thông tin server</Button>
          <Button variant="soft" onClick={() => run('Người chơi', 'getPlayerList')}>Người chơi</Button>
          <Button variant="soft" onClick={() => run('Loài được chơi', 'getPlayables')}>Loài được chơi</Button>
          <Button variant="soft" onClick={() => run('Hàng chờ', 'getQueueStatus')}>Hàng chờ</Button>
        </div>
        <pre className={s.out} aria-label="Kết quả RCON">{out}</pre>
      </CardBody></Card>
    </>
  );
}
