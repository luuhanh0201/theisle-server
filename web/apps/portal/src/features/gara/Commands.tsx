import { useRef } from 'react';
import { useToast } from '../../app/toast';

const COMMANDS: ReadonlyArray<readonly [string, string, string]> = [
  ['!unstuck', 'Cứu hộ kẹt địa hình', 'Dịch chuyển về mặt đất an toàn gần nhất khi rơi vào khe đá (chờ 10p).'],
  ['!slay', 'Tự giải thoát', 'Tự sát an toàn để quay lại màn hình chọn loài mới (chờ 5p).'],
  ['!status', 'Kiểm tra chỉ số', 'In thông số máu, đói, khát, tọa độ hiện tại vào chat.'],
  ['!prime', 'Kiểm tra điều kiện Elder', 'Xem số nhiệm vụ Prime đã hoàn thành trong đời sống.'],
];

/** One Copy button: "Đã chép!" in green for 1.5 s, the toast (a prompt where the clipboard is refused). */
function CopyBtn({ text }: { text: string }) {
  const toast = useToast();
  const btn = useRef<HTMLButtonElement>(null);
  const copy = async (): Promise<void> => {
    const b = btn.current;
    try {
      await navigator.clipboard.writeText(text);
      if (!b) return;
      const original = b.textContent;
      b.textContent = 'Đã chép!';
      b.style.color = '#34d399';
      toast(`Đã sao chép: ${text}`);
      window.setTimeout(() => { b.textContent = original; b.style.color = ''; }, 1500);
    } catch {
      window.prompt('Nhấn Ctrl+C để sao chép lệnh:', text);
    }
  };
  return <button ref={btn} type="button" className="btn btn-copy" data-copy={text} onClick={() => void copy()}>Copy</button>;
}

/** The players' chat commands, a Copy each. */
export function Commands() {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div>
          <h3 className="card-title">⚡ Các Lệnh Chat Trực Tuyến</h3>
          <span className="card-subtitle">Bấm Copy và dán thẳng vào ô chat ingame</span>
        </div>
      </div>
      <div className="commands-row">
        {COMMANDS.map(([code, title, text]) => (
          <div key={code} className="command-card">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className="command-code">{code}</span>
                <b style={{ fontSize: 13 }}>{title}</b>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>{text}</p>
            </div>
            <CopyBtn text={code} />
          </div>
        ))}
      </div>
    </div>
  );
}
