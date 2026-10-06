import { oldHref } from '../app/old';
import type { Tab } from '../app/router';

/** A page not moved to React yet: a link to it on the site before React, same #address. */
export function LegacyPage({ tab, title }: { tab: Tab; title: string }) {
  return (
    <div className="card" data-legacy={tab}>
      <div className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="card-subtitle">Trang này chưa chuyển sang giao diện mới.</p>
        </div>
      </div>
      <a className="btn btn-emerald" href={oldHref(tab)}>Mở trang {title} ở giao diện cũ</a>
    </div>
  );
}
