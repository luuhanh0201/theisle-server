import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { goTo, useTab, type Tab } from './router';
import { useToast } from './toast';

/** The onboarding tour's steps (app.js TOUR_STEPS): what each says, what it lights up, the page it opens. */
export const TOUR_STEPS: Array<{ badge: string; title: string; target: () => Element | null; tab: Tab; body: ReactNode }> = [
  {
    badge: 'Bước 1 / 5 · Tổng Quan',
    title: '🦖 Chào mừng đến với Xóm Gáy Gateway',
    target: () => document.querySelector('.brand') || document.querySelector('.top-header'),
    tab: 'home',
    body: <>
      <p>Cổng thông tin &amp; Launcher tích hợp chuyên biệt cho The Isle Evrima Xóm Gáy.</p>
      <p>Hệ thống hỗ trợ đầy đủ công cụ sinh tồn: Gara cất dino an toàn, Bản đồ Gateway Live với <b>Radar AI trực tiếp</b>, Voice định hướng và Overlay HUD trong game.</p>
      <p style={{ marginBottom: 0, color: 'var(--text-sub)', fontSize: 12 }}>💡 <i>Bạn có thể bấm <b>✕ Bỏ qua</b> ở góc bất kỳ lúc nào hoặc bấm phím <b>ESC</b> để đóng.</i></p>
    </>,
  },
  {
    badge: 'Bước 2 / 5 · Gara Khủng Long',
    title: '🦕 Gara Khủng Long An Toàn',
    target: () => document.querySelector('.nav-btn[data-nav="gara"]') || document.querySelector('.thumb-btn[data-nav="gara"]') || document.querySelector('[data-lx-nav="gara"]'),
    tab: 'gara',
    body: <>
      <p><b>Bảo lưu 100% chỉ số:</b> Cất dino trước khi rời game để bảo vệ chú khủng long của bạn an toàn khỏi nguy cơ đói khát hay bị tấn công khi offline.</p>
      <p><b>Đa dạng chủng loài:</b> Lưu trữ nhiều con cùng lúc, chuyển đổi linh hoạt mà không sợ mất con cũ.</p>
      <p style={{ marginBottom: 0 }}><b>Mở khoá Slot Prime:</b> Đạt đủ điều kiện tiến hoá để mở thêm slot khủng long cao cấp.</p>
    </>,
  },
  {
    badge: 'Bước 3 / 5 · Bản Đồ Gateway Live',
    title: '🗺️ Bản Đồ Live, Radar AI Trực Tiếp',
    target: () => document.querySelector('.nav-btn[data-nav="map"]') || document.querySelector('.thumb-btn[data-nav="map"]') || document.querySelector('[data-lx-nav="map"]'),
    tab: 'map',
    body: <>
      <div className="tour-ai-callout">
        <span className="tour-ai-tag"><span className="tour-ai-tag-dot" />🌟 ĐẶC BIỆT: HIỂN THỊ AI TRỰC TIẾP</span>
        <span className="tour-ai-desc">Bản đồ quét và hiển thị <b>vị trí chính xác của Heo Rừng (Boar), Hươu (Deer), Khủng long AI và Cá</b> đang sống trên máy chủ được cập nhật trực tiếp mỗi 2 giây! Bạn sẽ không còn lo bị đói hay lạc bầy.</span>
      </div>
      <p style={{ marginTop: 10 }}><b>🧭 Định vị GPS &amp; Hướng nhìn:</b> Theo dõi toạ độ thực tế, góc xoay la bàn và vệt đường di chuyển của dino.</p>
      <p style={{ marginBottom: 0 }}><b>💧 Nguồn nước &amp; Vùng di cư:</b> Đánh dấu nguồn nước sạch, Sanctuary an toàn cho con non và các vùng di cư Mass Migration.</p>
    </>,
  },
  {
    badge: 'Bước 4 / 5 · Voice Không Gian',
    title: '🎙️ Hệ Thống Voice Không Gian',
    target: () => document.querySelector('.nav-btn[data-nav="voice"]') || document.getElementById('lx-voice-chip'),
    tab: 'voice',
    body: <>
      <p><b>Âm thanh định hướng 3D:</b> Nghe giọng nói của đồng đội và các loài khủng long khác theo đúng góc phương vị (trái/phải) và khoảng cách thực tế trong game.</p>
      <p><b>3 Mức tầm giọng linh hoạt:</b>
        <br />• <i>Thì thầm (8m):</i> Trao đổi kín đáo khi săn mồi hoặc trốn kẻ thù.
        <br />• <i>Nói thường (30m):</i> Đàm thoại bầy đàn thông thường.
        <br />• <i>Hét to (90m):</i> Gọi bầy đàn từ xa hoặc cảnh báo nguy hiểm.
      </p>
      <p style={{ marginBottom: 0 }}><b>Phím mặc định:</b> Giữ phím <code>V</code> để nói, nhấn phím <code>~</code> để chuyển đổi tầm giọng.</p>
    </>,
  },
  {
    badge: 'Bước 5 / 5 · Overlay & Chế Độ Chơi Game',
    title: '🎮 Game Overlay HUD & Phím Tắt',
    target: () => document.getElementById('game-mode') || document.getElementById('nav-overlay') || document.querySelector('.top-header'),
    tab: 'home',
    body: <>
      <p><b>HUD nổi trong game:</b> Hiển thị Mini Map (kèm AI xung quanh), thanh Máu/Thể lực/Đói/Nước và mic Voice nổi ngay trên màn hình The Isle.</p>
      <p><b>⌨️ Phím tắt tiện ích:</b>
        <br />• <code>F1</code>: Bật / Tắt nhanh toàn bộ Overlay HUD.
        <br />• <code>F2</code> (hoặc <code>F9</code>): Mở chế độ di chuyển &amp; kéo mép để tuỳ chỉnh vị trí, kích thước từng khung.
      </p>
      <p style={{ marginBottom: 0 }}><b>⚡ Chế độ chơi game:</b> Bấm nút "Chế độ chơi game" trên góc để thu nhỏ Launcher xuống khay hệ thống, tối ưu 100% tài nguyên CPU/RAM cho máy tính!</p>
    </>,
  },
];
export const TOUR_KEY = 'isle_portal_tour_done';

/**
 * The onboarding tour: a step at a time, its page opened, its target lit (a spotlight) with the step beside it;
 * ← / → / Enter / Esc, the dots. It opens by itself a second after a first visit (isle_portal_tour_done not set),
 * and from Hướng dẫn or the palette (`start` from useTour).
 */
export function Tour({ step, setStep }: { step: number | null; setStep: (n: number | null) => void }) {
  const toast = useToast();
  const tab = useTab();
  const spot = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const s = step === null ? null : TOUR_STEPS[step] ?? null;

  const stop = useCallback((completed: boolean): void => {
    setStep(null);
    try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* private window */ }
    if (completed) toast('✓ Bạn đã hoàn thành tour hướng dẫn! Có thể mở lại bất cứ lúc nào ở nút 💡 Hướng dẫn.');
  }, [setStep, toast]);
  const next = useCallback((): void => {
    if (step === null) return;
    if (step < TOUR_STEPS.length - 1) setStep(step + 1); else stop(true);
  }, [step, setStep, stop]);
  const prev = useCallback((): void => { if (step !== null && step > 0) setStep(step - 1); }, [step, setStep]);

  // The step's page, when the step is shown (as app.js renderTourStep): a page opened during a step stays.
  const tabNow = useRef(tab);
  tabNow.current = tab;
  useEffect(() => { if (s && tabNow.current !== s.tab) goTo(s.tab); }, [s]);
  // Its target lit, the step beside it (in the middle when there is none, or on a phone).
  const place = useCallback((): void => {
    const spotlight = spot.current;
    const popover = pop.current;
    if (!s || !spotlight || !popover) return;
    const targetEl = s.target();
    const isMobile = window.innerWidth <= 640;
    if (!targetEl || isMobile) {
      spotlight.style.display = 'none';
      if (!isMobile) {
        const popRect = popover.getBoundingClientRect();
        popover.style.top = `${Math.max(20, (window.innerHeight - (popRect.height || 260)) / 2)}px`;
        popover.style.left = `${Math.max(20, (window.innerWidth - (popRect.width || 440)) / 2)}px`;
        popover.style.transform = 'none';
      }
      return;
    }
    const rect = targetEl.getBoundingClientRect();
    const pad = 6;
    spotlight.style.display = 'block';
    spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
    spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;
    requestAnimationFrame(() => {
      const popRect = popover.getBoundingClientRect();
      let top = rect.bottom + 14;
      let left = rect.left;
      if (top + popRect.height > window.innerHeight - 20) top = Math.max(20, rect.top - popRect.height - 14);
      if (left + popRect.width > window.innerWidth - 20) left = Math.max(20, window.innerWidth - popRect.width - 20);
      left = Math.max(20, left);
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.style.transform = 'none';
    });
  }, [s]);
  useLayoutEffect(() => { place(); }, [place, tab]);
  useEffect(() => {
    if (step === null) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); stop(false); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    document.addEventListener('keydown', key);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('keydown', key); window.removeEventListener('resize', place); };
  }, [step, stop, next, prev, place]);

  const last = step === TOUR_STEPS.length - 1;
  return (
    <div className="tour-backdrop" id="tour-backdrop" hidden={step === null}>
      <div className="tour-spotlight" id="tour-spotlight" ref={spot} />
      <div className="tour-popover" id="tour-popover" ref={pop} role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div className="tour-header">
          <span className="tour-badge" id="tour-step-badge">{s?.badge ?? 'BƯỚC 1 / 5'}</span>
          <button type="button" className="tour-skip-btn" id="tour-skip-btn" aria-label="Bỏ qua hướng dẫn" onClick={() => stop(false)}>
            <span>✕ Bỏ qua</span>
          </button>
        </div>
        <div className="tour-content">
          <h3 className="tour-title" id="tour-title">{s?.title ?? 'Tiêu đề bước'}</h3>
          <div className="tour-body" id="tour-body">{s?.body ?? 'Nội dung bước'}</div>
        </div>
        <div className="tour-footer">
          <div className="tour-dots" id="tour-dots" aria-hidden="true">
            {TOUR_STEPS.map((_, i) => <span key={i} className={`tour-dot${i === step ? ' active' : ''}`} title={`Bước ${i + 1}`} onClick={() => { if (i !== step) setStep(i); }} />)}
          </div>
          <div className="tour-actions">
            <button type="button" className="btn btn-ghost tour-btn-prev" id="tour-btn-prev" disabled={step === 0} onClick={prev}>◀ Quay lại</button>
            <button type="button" className="btn btn-emerald tour-btn-next" id="tour-btn-next" onClick={next}>{last ? '✓ Bắt đầu trải nghiệm' : 'Tiếp theo ▶'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The tour's step (null: closed), opened by itself a second after a first visit. */
export function useTour(): { step: number | null; setStep: (n: number | null) => void; start: () => void } {
  const [step, setStep] = useState<number | null>(null);
  const open = useRef(step);
  open.current = step;
  useEffect(() => {
    let seen = true;
    try { seen = Boolean(localStorage.getItem(TOUR_KEY)); } catch { /* private window: not opened */ }
    if (seen) return undefined;
    const t = setTimeout(() => { if (open.current === null) setStep(0); }, 1000);
    return () => clearTimeout(t);
  }, []);
  return { step, setStep, start: () => setStep(0) };
}
