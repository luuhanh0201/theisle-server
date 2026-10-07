import { useEffect } from 'react';

/** Why the launcher's Steam login did not finish (portal/src/server.ts: /launcher-done.html?error=…). */
const ERRORS: Record<string, [string, string]> = {
  steam: ['Steam không phản hồi', 'Máy chủ chưa xác nhận được lần đăng nhập với Steam (mạng tới Steam chập chờn). Quay lại launcher và bấm "Đăng nhập bằng Steam" lần nữa.'],
  refused: ['Steam không xác nhận lần đăng nhập này', 'Quay lại launcher và đăng nhập lại từ đầu.'],
  'other-address': ['Trình duyệt này không cùng mạng với launcher', 'Đăng nhập phải làm trên cùng máy (cùng mạng) đang mở launcher. Nếu bạn không bấm đăng nhập trong launcher của mình, hãy bỏ qua trang này.'],
};
const EXPIRED: [string, string] = ['Liên kết đăng nhập đã hết hạn', 'Bấm "Đăng nhập Steam" lại trong launcher.'];

/** launcher-done.html in React: what the browser shows after a launcher's Steam login (as launcher-done.js). */
export function LauncherDone({ error }: { error: string | null }) {
  useEffect(() => {
    if (error) return undefined;
    // Hand the player back to the launcher: the OS brings its window to the front (the launcher also comes
    // forward by itself once it has the session).
    const a = setTimeout(() => { location.href = 'xomgay-launcher://login-done'; }, 400);
    // A tab opened by another app can usually not close itself; try anyway.
    const b = setTimeout(() => { window.close(); }, 2500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [error]);
  const [title, text] = (error && ERRORS[error]) || EXPIRED;
  return (
    <div className="card">
      <img src="/img/logo-96.webp" alt="" width="72" height="72" />
      <div id="ok" hidden={Boolean(error)}>
        <span className="badge ok">✓ Đăng nhập thành công</span>
        <h1>Đang chuyển về Xóm Gáy Launcher…</h1>
        <p>Nếu trình duyệt hỏi, chọn <b>Mở Xóm Gáy Launcher</b> (tích "luôn cho phép" để lần sau tự chuyển). Launcher tự vào trong vài giây. Tab này có thể đóng.</p>
        <p style={{ marginTop: 14 }}><a id="back" href="xomgay-launcher://login-done" style={{ color: '#34d399', fontWeight: 700 }}>Mở launcher</a></p>
      </div>
      <div id="bad" hidden={!error}>
        <span className="badge bad">✕ Chưa đăng nhập được launcher</span>
        <h1 id="bad-title">{title}</h1>
        <p id="bad-text">{text}</p>
      </div>
    </div>
  );
}
