import type { PlayerMe, PrimeBoard } from '@isle/api';
import { pct } from '../../lib/dino';

function Board({ pb }: { pb: PrimeBoard }) {
  const verdict = pb.isPrime ? <span className="tag">Đã là Prime Elder</span>
    : pb.eligible ? <span className="tag">Game: Đủ điều kiện Prime</span>
      : <span className="tag kill">Game: Chưa đủ điều kiện</span>;
  const g = typeof pb.growth === 'number' ? pb.growth : null;
  return (
    <>
      <div className="prime-summary">
        <div><b>{pb.met} / 10 điều kiện đạt</b> <span className="muted">(cần {pb.needed ?? 5}, vài loài được tặng sẵn điều kiện 10)</span></div>
        <div>{verdict}</div>
      </div>
      {g !== null && (
        <>
          <div className="prime-deadline-track" title={`Growth ${pct(g)} / Mốc ${pct(pb.deadline)}`}>
            <div className="prime-deadline-fill" style={{ width: `${Math.min(100, g * 100).toFixed(1)}%` }} />
            <i className="prime-marker" style={{ left: `${pb.deadline * 100}%` }} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            {pb.locked ? `Growth ${pct(g)}: Đã qua mốc ${pct(pb.deadline)}: Kết quả Prime đã chốt.`
              : `Growth ${pct(g)}: Còn tới mốc ${pct(pb.deadline)} để hoàn thành tối thiểu 5 nhiệm vụ.`}
          </div>
        </>
      )}
      <ul className="quest-list">
        {pb.conditions.map((c, i) => (
          <li key={c.n ?? i} className={`quest-item ${c.met ? 'met' : ''}`}>
            <span className="quest-check">{c.met === null ? '?' : c.met ? '✓' : i + 1}</span>
            <div><b>{c.label}</b>{c.passive && <> <span className="muted" style={{ fontSize: 11.5 }}>(thụ động: mặc định đạt nếu không vi phạm)</span></>}</div>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: 11.5, margin: '12px 0 0' }}>Trạng thái ✓ được ghi nhận trực tiếp từ game engine (EligiblePrimeElderData).</p>
    </>
  );
}

/** Nhiệm Vụ Prime Elder: the 10 conditions of the dino played now (app.js renderPrimeBoard). */
export function PrimeCard({ me }: { me: PlayerMe | null | undefined }) {
  const d = me?.dino && me.online ? me.dino : null;
  return (
    <div className="card" id="game-prime-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">👑 Nhiệm Vụ Prime Elder</h3>
          <span className="card-subtitle">Tiến hóa lên hình thái trưởng thành tối thượng</span>
        </div>
        <div id="game-prime-verdict" />
      </div>
      <div id="game-prime-content">
        {!me ? <p className="muted" style={{ fontSize: 13 }}>Chưa có dữ liệu nhiệm vụ. Hãy sinh tồn và phát triển dino.</p>
          : !d ? <p className="muted" style={{ fontSize: 13 }}>Dino chưa spawn trên bản đồ.</p>
            : d.prime ? <Board pb={d.prime} />
              : <p className="muted" style={{ fontSize: 13 }}>Dino của bạn chưa mở khóa hệ thống nhiệm vụ Prime Elder.</p>}
      </div>
    </div>
  );
}
