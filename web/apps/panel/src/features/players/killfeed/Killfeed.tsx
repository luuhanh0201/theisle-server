import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '@isle/api';
import { Card, CardBody, CardHead } from '@isle/ui';
import { Feed } from '../../../components/feed/Feed';
import type { FeedEvent } from '../../../components/feed/describe';
import { ListTools, Pager, Pill, pageOf } from '../../../components/list/List';
import { dinoName } from '../../../lib/format';

const LIMIT = 20;
/** The kills the search keeps: killer, victim or either species. */
export function killMatch(e: FeedEvent, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return [e.killerName ?? e.killer ?? '', e.victimName ?? e.victim ?? '', e.name ?? '', dinoName(e.killerSpecies), dinoName(e.victimSpecies ?? e.species)]
    .some((v) => String(v).toLowerCase().includes(n));
}

/** Người chơi → Killfeed: the last 200 deaths, searched, 20 a page. */
export function Killfeed() {
  const q = useQuery({ queryKey: ['/api/killfeed'], queryFn: () => getJson<{ events: FeedEvent[] }>('/api/killfeed?limit=200'), refetchInterval: 2000 });
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const all = q.data?.events ?? [];
  const rows = all.filter((e) => killMatch(e, text));
  const shown = pageOf(rows, page, LIMIT);
  return (
    <Card>
      <CardHead title="Killfeed" sub={`Tổng cộng ${all.length} sự kiện`}><Pill>{rows.length} sự kiện</Pill></CardHead>
      <CardBody>
        <ListTools q={text} onQ={(v) => { setText(v); setPage(1); }} placeholder="Tìm theo tên kẻ giết, nạn nhân hoặc loài…" />
        <Feed tall events={shown.rows} empty={q.isLoading ? 'Đang tải…' : text ? 'Không tìm thấy sự kiện hạ gục nào' : 'Chưa có ai chết'} />
        <Pager total={rows.length} page={shown.page} limit={LIMIT} unit="sự kiện" onPage={setPage} />
      </CardBody>
    </Card>
  );
}
