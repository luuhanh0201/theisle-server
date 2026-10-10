import { useQuery } from '@tanstack/react-query';
import { getJson, type ServerStatusFull } from '@isle/api';
import { BlockPage } from '../../app/BlockPage';
import { GameConfig } from '../../features/server/config/GameConfig';
import { DataPage } from '../../features/server/data/DataPage';
import { SpeciesCaps } from '../../features/server/caps/SpeciesCaps';
import { ServerDdos, ServerOps, ServerRcon, ServerSchedule } from '../../features/server/ops/ServerOps';
import { STATUS_URL } from '../../features/server/ops/PowerCard';

/** Server: power (Vận hành), the restart schedule (Lịch & sự kiện), DDoS, RCON, the Game.ini (Cấu hình game), the species limit (Giới hạn loài), backups (Dữ liệu). */
export function ServerPage({ sub }: { sub: string }) {
  // The line under the title names the unit and the VPS's time zone once known (as the panel before React).
  const st = useQuery({ queryKey: [STATUS_URL], queryFn: () => getJson<ServerStatusFull>(STATUS_URL), refetchInterval: 2000 }).data;
  return <BlockPage tab="server" sub={sub} title="Server"
    intro={st ? `${st.unitName} · múi giờ VPS ${st.timeZone}` : 'Bật, tắt, khởi động lại, thiết lập và cấu hình game server.'}
    pages={{ ops: ServerOps, schedule: ServerSchedule, ddos: ServerDdos, rcon: ServerRcon, cfg: GameConfig, caps: SpeciesCaps, data: DataPage }} />;
}
