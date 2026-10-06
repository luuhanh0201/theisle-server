import { goTo, useTab, type Tab } from '../router';
import { useDrawer } from './drawer';
import { Svg, type IconName } from './icons';

const THUMBS: ReadonlyArray<readonly [Tab, IconName, string]> = [
  ['home', 'homeThumb', 'Trang chủ'], ['game', 'game', 'Dino HUD'], ['gara', 'garaThumb', 'Gara'], ['map', 'mapThumb', 'Bản đồ'],
];

/** The phone's bottom bar: four pages and the menu. */
export function ThumbBar() {
  const now = useTab();
  const { setOpen } = useDrawer();
  return (
    <nav className="bottom-thumb-bar">
      {THUMBS.map(([tab, icon, label]) => (
        <button key={tab} type="button" className={`thumb-btn nav-btn${now === tab ? ' active' : ''}`} data-nav={tab} onClick={() => { goTo(tab); setOpen(false); }}>
          <Svg name={icon} size={20} />
          <span>{label}</span>
        </button>
      ))}
      <button type="button" className="thumb-btn" id="bottom-menu-toggle" onClick={() => setOpen(true)}>
        <Svg name="menu" size={20} />
        <span>Menu</span>
      </button>
    </nav>
  );
}
