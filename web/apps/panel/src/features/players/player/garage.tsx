import { useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@isle/api';
import { useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import d from '../../../components/dino/dino.module.css';

/** Delete a garage slot (into deleted/ on the server), asked first, as the old askDeleteSlot. */
export function useGarageDelete(): (steamId: string, slot: string, label: string) => void {
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  return (steamId, slot, label) => confirm({
    title: 'Xoá dino khỏi gara?', okLabel: 'Xoá khỏi gara',
    body: <>Xoá <b>{label}</b> ở slot <span className={d.mono}>{slot}</span> của <span className={d.mono}>{steamId}</span>. File được chuyển vào
      thư mục <span className={d.mono}>deleted/</span> trên server, nên vẫn khôi phục được nếu xoá nhầm.</>,
    run: async (token) => {
      await adminFetch(`/api/garage/${encodeURIComponent(steamId)}/${encodeURIComponent(slot)}`, 'DELETE', token);
      toast(`Đã xoá ${label} (slot ${slot}) khỏi gara.`);
      void qc.invalidateQueries({ queryKey: [`/api/player/${encodeURIComponent(steamId)}`] });
      void qc.invalidateQueries({ queryKey: ['/api/garage'] });
    },
  });
}
