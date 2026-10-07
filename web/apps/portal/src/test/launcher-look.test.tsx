import { openRules } from '../app/actions';
import { groupOf, type LxView } from '../app/launcher/view';
import { UI_KEY, launcherUi } from '../lib/launcher';

afterEach(() => { delete (window as unknown as { isleLauncher?: unknown }).isleLauncher; localStorage.removeItem(UI_KEY); location.hash = ''; });

describe("the launcher's own look", () => {
  it('only inside the launcher, unless the web look was chosen', () => {
    expect(launcherUi()).toBe(false);
    (window as unknown as { isleLauncher: unknown }).isleLauncher = {};
    expect(launcherUi()).toBe(true);
    localStorage.setItem(UI_KEY, 'web');
    expect(launcherUi()).toBe(false);
    localStorage.setItem(UI_KEY, 'launcher');
    expect(launcherUi()).toBe(true);
  });
  it('the three parts: Trang chủ (with Voice 3D), Trò chơi, Overlay HUD', () => {
    expect((['home', 'voice', 'bag', 'gara', 'map', 'game', 'shop', 'skin', 'ranking', 'rules', 'overlay'] as LxView[]).map(groupOf))
      .toEqual(['home', 'home', 'play', 'play', 'play', 'play', 'play', 'play', 'play', 'play', 'overlay']);
  });
  it('Luật & Dinh Dưỡng: its own page in the launcher look, Trang chủ on the web', () => {
    openRules();
    expect(location.hash).toBe('#home');
    (window as unknown as { isleLauncher: unknown }).isleLauncher = {};
    openRules();
    expect(location.hash).toBe('#rules');
  });
});
