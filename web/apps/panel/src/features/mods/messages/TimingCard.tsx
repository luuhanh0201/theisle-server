import { useEffect, useState } from 'react';
import type { MessagesSettings, PeriodicMessage } from '@isle/api';
import { Button, Card, CardBody, CardHead, Hint, NumberInput, Switch, TextInput } from '@isle/ui';
import { fmtMark, parseMarks } from './texts';
import styles from './Messages.module.css';

const MAX_PERIODIC = 10;

/** "Tần suất": the restart countdown's marks, the corpse wipe, the periodic announcements. */
export function TimingCard({ draft, update }: { draft: MessagesSettings; update: (fn: (d: MessagesSettings) => MessagesSettings) => void }) {
  // The marks as typed (kept while unreadable); back in step when the draft changes elsewhere.
  const [marks, setMarks] = useState(() => draft.countdownMarks.map(fmtMark).join(', '));
  useEffect(() => {
    setMarks((t) => (JSON.stringify(parseMarks(t)) === JSON.stringify(draft.countdownMarks) ? t : draft.countdownMarks.map(fmtMark).join(', ')));
  }, [draft.countdownMarks]);
  const bad = parseMarks(marks) === null;

  const setPeriodic = (i: number, p: Partial<PeriodicMessage>): void =>
    update((d) => ({ ...d, periodic: d.periodic.map((x, j) => (j === i ? { ...x, ...p } : x)) }));

  return (
    <Card>
      <CardHead title="Tần suất" sub="chỉ gửi khi có người đang chơi" />
      <CardBody stack>
        <div className={styles.line}>
          <label htmlFor="msg-marks">Mốc đếm ngược khi khởi động lại / tắt server</label>
          <TextInput id="msg-marks" className={styles.marks} value={marks} placeholder="15p, 10p, 5p, 3p, 2p, 1p, 30s, 10s"
            aria-invalid={bad} onChange={(e) => {
              setMarks(e.target.value);
              const m = parseMarks(e.target.value);
              if (m !== null) update((d) => ({ ...d, countdownMarks: m }));
            }} />
          <Hint className={styles.full}>{bad ? <span className={styles.bad}>Không đọc được. Ví dụ: 15p, 5p, 1p, 30s. </span> : null}
            Phút (p) hoặc giây (s), cách nhau bằng dấu phẩy. Server báo ở mỗi mốc còn lại; thời gian đếm ngược tổng chọn lúc bấm khởi động lại (tab Server).</Hint>
        </div>
        <div className={styles.line}>
          <label htmlFor="msg-cw-every">Tự dọn xác mỗi (phút)</label>
          <span className={styles.num}><NumberInput id="msg-cw-every" value={draft.corpseWipe.everyMin} min={0} max={1440} step={5}
            onChange={(v) => update((d) => ({ ...d, corpseWipe: { ...d.corpseWipe, everyMin: v } }))} /></span>
          <label htmlFor="msg-cw-warn" className={styles.inline}>báo trước (giây)</label>
          <span className={styles.num}><NumberInput id="msg-cw-warn" value={draft.corpseWipe.warnSec} min={0} max={600} step={10}
            onChange={(v) => update((d) => ({ ...d, corpseWipe: { ...d.corpseWipe, warnSec: v } }))} /></span>
          <Hint className={styles.full}>0 = tắt. Dùng lệnh RCON dọn xác của game; khi bấm "Dọn xác" bằng tay ở tab Server cũng báo "Đã dọn xác".</Hint>
        </div>
        <div>
          <div className={styles.groupLabel}>Thông báo định kỳ</div>
          <ul className={styles.periodic}>
            {draft.periodic.length === 0 && <li><Hint>Chưa có thông báo định kỳ nào.</Hint></li>}
            {draft.periodic.map((p, i) => (
              <li key={p.id ?? `new-${i}`}>
                <Switch checked={p.enabled} onChange={(v) => setPeriodic(i, { enabled: v })} label={<span className={styles.sr}>Bật thông báo {i + 1}</span>} />
                <TextInput className={styles.ptext} value={p.text} maxLength={300} aria-label={`Nội dung thông báo ${i + 1}`}
                  placeholder="Nội dung, ví dụ: Discord của server: …" onChange={(e) => setPeriodic(i, { text: e.target.value })} />
                <span className={styles.every}>
                  <Hint>mỗi</Hint>
                  <span className={styles.num}><NumberInput value={p.everyMin} min={5} max={1440} step={5} aria-label={`Mỗi bao nhiêu phút, thông báo ${i + 1}`}
                    onChange={(v) => setPeriodic(i, { everyMin: v })} /></span>
                  <Hint>phút</Hint>
                  <Button variant="ghost" small className={styles.del}
                    onClick={() => update((d) => ({ ...d, periodic: d.periodic.filter((_, j) => j !== i) }))}>Xoá</Button>
                </span>
              </li>
            ))}
          </ul>
          <Button variant="soft" small className={styles.add} disabled={draft.periodic.length >= MAX_PERIODIC}
            onClick={() => update((d) => ({ ...d, periodic: [...d.periodic, { text: '', everyMin: 30, enabled: true }] }))}>
            + Thêm thông báo định kỳ
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
