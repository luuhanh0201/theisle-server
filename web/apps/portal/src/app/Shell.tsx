import { useEffect, useState } from 'react';
import { useMe, useServer } from '../lib/queries';
import { CommandPalette } from './CommandPalette';
import { Tour, useTour } from './Tour';
import { Page } from '../pages';
import { goTo, useTab, type Tab } from './router';
import { DrawerProvider } from './shell/drawer';
import { Header } from './shell/Header';
import { Sidebar } from './shell/Sidebar';
import { ThumbBar } from './shell/ThumbBar';

/** "Đăng nhập không thành công: …" from the Steam login's return (?login_error), then the address cleaned. */
function readLoginError(): string | null {
  const e = new URLSearchParams(location.search).get('login_error');
  if (!e) return null;
  history.replaceState(null, '', location.pathname);
  return `Đăng nhập không thành công: ${e}`;
}

/** The frame of every page: the menu, the header, the page, the phone's bottom bar. */
export function Shell() {
  const me = useMe();
  const srv = useServer();
  const tab = useTab();
  const [error] = useState(readLoginError);
  const tour = useTour();

  // The tab's title is the server's name once known (Game.ini).
  useEffect(() => { if (srv?.name) document.title = srv.name; }, [srv?.name]);
  // The bag not open to them (or logged out): back home (app.js renderBag).
  useEffect(() => {
    if (me !== undefined && tab === 'bag' && !me?.bag) goTo('home');
  }, [tab, me]);
  // A page once opened stays (hidden), as the site before React kept every page: what was typed,
  // picked or zoomed is still there on coming back.
  const [seen, setSeen] = useState<Tab[]>([tab]);
  useEffect(() => { setSeen((s) => (s.includes(tab) ? s : [...s, tab])); }, [tab]);

  return (
    <DrawerProvider>
      <div className="app-layout" id="app-layout">
        <Sidebar me={me} />
        <div className="main-viewport">
          <Header me={me} onTour={tour.start} />
          <main className="page-container">
            <div id="error" className="err" hidden={error === null}>{error}</div>
            {(seen.includes(tab) ? seen : [...seen, tab]).map((t) => (
              <section key={t} id={`page-${t}`} className="page-content" hidden={t !== tab}>
                <Page tab={t} />
              </section>
            ))}
          </main>
        </div>
        <ThumbBar />
      </div>
      <CommandPalette onTour={tour.start} />
      <Tour step={tour.step} setStep={tour.setStep} />
    </DrawerProvider>
  );
}
