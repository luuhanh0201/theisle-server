# Moving the player site (portal) to React: the plan

The same move as the admin panel (`web/MIGRATION.md`, done 2026-10-06): a change of technology only.
Every page does what it does now in `portal/public/` (index.html 5,477 lines, app.js 3,532, plus
map.js, voice.js, skin-editor.js, skin3d.js, overlay-settings.js, bigmap.*, mutations.*, tai.*),
same texts, same calls to the portal server (`portal/src/server.ts`), same launcher behaviour
(`window.isleLauncher`, `html.in-launcher`). The portal server (TypeScript) does not move; only its
pages do. One session at a time; `git pull` and read this file first; push after each block.

Mark each step done here, with its files and its e2e flow, in the commit that does it.

## Status (2026-10-06)

| Step | State |
|---|---|
| 0. Foundations | **done** (below) |
| 1. Trang chủ | **done** (below) |
| 2. Dino Live | **done** (below) |
| 3. Gara | **done** (below) |
| 4. Bản đồ + Kết bạn | **done** (below; the whole-site regression run was stopped by the owner, see "Paused") |
| 5. Xếp hạng | **done** (below) |
| 6-10. Pages | not started: each shows a link to the same page on the site before React (`pages/LegacyPage.tsx`) |
| 2. Across pages | not started (the header's Hướng dẫn shows a toast until the tour moves) |
| 3. Other pages | not started |
| 4. Switch | not started: the site before React is still `/` |

### How to work on it

- Build: `cd web && npm test && npm run build` (builds the panel and the site; `npm run build:portal` the site only).
- A local site on fake data: `sh web/e2e/local-portal.sh /tmp/<new empty dir> > /tmp/isle-portal.out` (the local bridge
  on 8091 + the portal on 8092, logged in as Rex Tester; needs `npm run build` in bridge/ and portal/). React at
  `http://127.0.0.1:8092/next/`, the site before React at `/`. Stop: `for p in $(pgrep -f "^node dist/index.js"); do kill $p; done`.
- E2e (from web/): `CHROME=/opt/pw-browsers/chromium PANEL_URL=http://127.0.0.1:8092 COOKIE_NAME=isle_session
  PANEL_COOKIE=<printed> node e2e/run.mjs e2e/flows/portal-<x>.mjs`. A flow may set `init` (a script before the page's
  own: a stub `window.isleLauncher`, see `portal-frame.mjs`) and `width` (a phone). Each flow gets a fresh page.
- Screenshots: `SITE=portal PANEL_URL=http://127.0.0.1:8092 PANEL_COOKIE=<printed> node scripts/shots.mjs <out> <tab>`;
  `OLD=1` the site before React, `LAUNCHER=1` as inside the launcher (dark only, 380 and 1366 px; the tour marked seen).
- Moving a page: build it under `apps/portal/src/pages/<tab>/` (+ `features/` as the panel), add it to `MOVED` in
  `pages/index.tsx`, an e2e flow `e2e/flows/portal-<tab>.mjs` comparing with the old page, screenshots old / new.

### Paused (2026-10-06, owner's request) and where to pick up

- Done: 0 foundations, 1 Trang chủ, 2 Dino Live, 3 Gara, 4 Bản đồ + Kết bạn, 5 Xếp hạng. Web unit tests: 135 (46 of them
  the portal's, `apps/portal/src/test/`), all passing at the last commit.
- Each block's own e2e flow passed when it was done. After block 4 the full re-run of every portal flow (frame, home,
  game, gara, ranking, map) was stopped before it ran: run it first when picking up (the commands under "How to work on
  it"; LIVE_COOKIE for game / gara / ranking / map, PANEL_COOKIE for frame / home, both REX_COOKIE=<PANEL_COOKIE> and
  LIVE_COOKIE set in the env for the map flow). The live AI added for the map could change a count another flow checks.
- Next: 6 Skin Studio (mind the notes below on skin3d.js and what renderGame did for it), then 7 Voice 3D, 8 Túi đồ,
  9 Cửa hàng, 10 Overlay HUD (move the AI / heat / friends polling and the mini map into app-level services built on
  `lib/mapService.ts`), 2 across pages (Ctrl+K, the tour, its first-visit opening), 3 other pages, 4 the switch.
- Still open with the owner: html.in-launcher (below).
- Stop the local servers: `for p in $(pgrep -f "^node dist/index.js") $(pgrep -f "^isle-e2e-feed"); do kill $p; done`
  (never `pkill -f` with a pattern: it matches the shell running it).

### Owner's decision pending: html.in-launcher

The site before React set `html.in-launcher` from an inline `<head>` script, which the portal's CSP (`script-src 'self'`)
has always refused (since 2026-10-03, the script's first day). So inside the launcher the live site shows Trang chủ as on
the web (server status, features, rules) and never the launcher hub (`#launcher-hub`, shown only under html.in-launcher);
the download links are hidden by app.js (`.web-only`). The React site keeps that (`main.tsx MARK_IN_LAUNCHER = false`).
Setting it true would show the hub and hide the status / features / rules / promo inside the launcher (portal.css), as the
markup intended: the owner decides. The flows check the current behaviour (`portal-home.mjs`, `portal-frame.mjs`).

### Notes for the next blocks

- Same look: `styles/portal.css` is the old `<style>` as it was (global class names); write the old markup's classes in JSX.
  `styles/tokens.css` gives `@isle/ui` (Select, NumberInput, Slider…) the portal's colours: use those, never native controls.
- Pages once opened stay mounted (hidden), as the old site kept every section: state survives a page change.
- `useMe()` (lib/queries.ts) is /api/me every second, drawn every 5 s in the launcher's background and not at all in game
  mode (app.js part 5); `useMeQuery()` is the raw query for what must run every second anyway.
- Things app.js does for every page, whatever is shown, that must become app-level services (not inside a page):
  `pushOverlayGame` (launcher overlay, each second), the mini map frames (`sendMiniFrame`), the big map's AI / zones / heat,
  `voice.js` (the room stays joined across pages; `lib/voiceDot.ts` already carries the menu dot), `overlay-settings.js`.
- The tour opens by itself on a first visit (`isle_portal_tour_done` in localStorage): keep that (block 2).
- In game on fake data: `local-portal.sh` also starts `e2e/live-feed.mjs` ("Live Tester", a snapshot and live.json every
  3 s) and prints `LIVE_COOKIE`; a flow run with it sees a player in game. A flow can switch the login with an `init`
  setting `document.cookie` (see `portal-game.mjs`: REX_COOKIE, a guest); put those flows last.
- `e2e/flows/compare.mjs`: `save(key, parts)` on the old page, `same(key, parts)` on the new one, part by part (shown
  text, or `sel@attr`); use it for every page.
- What app.js renderGame did for the Skin page, still to move with Skin Studio: `window.skin3d.follow` (the preview shows
  the dino played now), the active colour swatches (`skin-active-swatches-box`), the kept colours (`renderKept`).
- skin3d.js, once imported (lib/dino3d.ts), binds its skin editor to `#skin-species` if present at that moment: the Skin
  block must mind that (load it after its markup, or drive the viewer itself as the panel does).
- No inline script anywhere (the portal's CSP): `index.html` has none, the build none (checked by portal/test).

## 0. Foundations (before any page): done 2026-10-06

Files: `web/apps/portal/{index.html, vite.config.ts}`, `src/main.tsx` (html.in-launcher, app-idle, lab, the view beacon),
`src/app/{App, Shell, router, toast, actions, old}`, `src/app/shell/{Sidebar, Header, ThumbBar, drawer, icons}`,
`src/lib/{http, launcher, lab, queries, releases, voiceDot}`, `src/styles/{portal.css, tokens.css}`, `src/pages/{index,
LegacyPage}`, `packages/api/src/portal.ts` (PlayerMe, PortalServer…); `portal/src/server.ts` serves `/next/` (+ `/next` →
`/next/`, hashed assets cached for good); `scripts/deploy.sh` builds web for a portal deploy too. Checks:
`apps/portal/src/test/foundations.test.tsx` (11), `portal/test/portal.test.mjs` (/next/), e2e `portal-frame.mjs` (56 checks:
the menu = the old one's entries, badges, server name, collapse remembered, lab, ?login_error, launcher stub: no download,
overlay page, version + update phases, game mode; phone drawer and bottom bar; a guest), screenshots old / new at 380 and
1366, web and launcher: the frame looks the same.


1. **The app**: `web/apps/portal` (React 19 + Vite + TS, TanStack Query, CSS Modules), sharing
   `@isle/ui` and `@isle/api` with the panel. Built into `portal/public/next/` (gitignored), served by
   the portal server at `/next/` beside the current site (`/`); `scripts/deploy.sh` builds it with the portal.
2. **The look**: the portal's own colours (dark only; its tokens `--bg-card`, `--emerald`…) as a token
   file for `@isle/ui`, so the shared controls look like `ui-select.js` / `ui-inputs.js` do on the site.
3. **The frame**: sidebar with its 10 entries (Trang chủ, Dino Live, Bản đồ, Gara, Xếp hạng, Skin,
   Túi đồ, Cửa hàng, Voice 3D, Overlay; Túi đồ / Cửa hàng / Overlay shown only when allowed, as now),
   collapse / mobile menu / bottom menu, the header (launcher update, game mode, Hướng dẫn, Discord,
   Tải launcher, login / logout), the error line (`?login_error`), the global toast, lab mode
   (`?lab=1`, remembered), the pages as `#addresses`.
4. **Launcher rules**: a typed wrapper of `window.isleLauncher` (version, updateGet / Check / Install,
   onUpdate, gameModeGet / Set, onGameMode, overlayGet / Game, onOverlayChanged, playGame);
   `html.in-launcher`; nothing about downloading the launcher inside it (class `web-only`, AGENTS.md
   "Launcher"); game mode: the page does not draw in the background.
5. **Data**: the portal API types in `@isle/api` (/api/me, /api/server, /api/garage, /api/skin,
   /api/checkin, /api/quests/claim, /api/starter/claim, /api/shop(/buy), /api/items/*, /api/voice*,
   /api/tele, /api/friends*, /api/ai, /api/heatmap, /api/ai-zones, /api/leaderboard, /api/track/*), the
   refresh loop (app.js part 5) as queries.
6. **Checks**: a local portal on fake data (portal + `web/e2e/local-bridge.sh`, a signed session cookie,
   a stub `window.isleLauncher` for the launcher-only parts), e2e flows per page, screenshots of the old
   and new page at 380 and 1366 px, in the browser and as the launcher (`html.in-launcher`).

## 1. The pages (one block each, in this order)

**4. Bản đồ + Kết bạn: done 2026-10-06.** The map engine stays `portal/public/map.js` (shared with the launcher's big map,
bigmap.js), imported as `@portal/map` (aliases.ts, typed by `packages/types/map.d.ts`) and bundled into the React build.
`lib/mapService.ts` keeps the one map of the visit (made for a logged-in player, as app.js renderMap; its AI / zones /
heat loaders; the friends' spots), for the Overlay block's mini map and big map too. `features/map/{MapCard, Friends}.tsx`,
`pages/map/MapPage.tsx`: AI every 2 s, zones and heat every minute while the page is shown; Kết bạn (search, ask,
accept, decline, cancel, remove with a second click in 4 s, Xem centres the map), its lists every 2 s on the page.
`live-feed.mjs` writes 3 AI and a fish in live.json; `local-portal.sh` copies the map data (bridge/public/map) into the
gitignored portal/public/map. Checks: `test/map.test.tsx` (5, map.js mocked), e2e `portal-map.mjs` (8 flows, all OK:
old vs new for Live Tester, Rex and a guest: status, chips, message, note, friends card, menu badge, and the picture
drawn (24 x 16 grey, mean difference < 12); Live Tester asks Rex, Rex accepts, Live Tester ends it).

**5. Xếp hạng: done 2026-10-06** (before Bản đồ, the bigger block). `pages/ranking/RankingPage.tsx`,
`features/ranking/Ranking.tsx`, `lib/queries.ts useLeaderboard` (every 15 s). Checks: `test/ranking.test.tsx` (4), e2e
`portal-ranking.mjs` (every tab on both sites as Live Tester, Rex and a guest: the same text, item classes and decorations).

**3. Gara: done 2026-10-06.** `pages/gara/GaraPage.tsx`, `features/gara/{Commands, Garage, Slot, garage}.tsx|ts`,
`components/SkinStrip.tsx`, `lib/dino.ts` (slotTier, when). `e2e/live-feed.mjs` now plays DinoGarage too: it reads the
bridge's inbox.json and answers store / redeem as the mod (odd stores fail "moved", even ones land in a new slot). Two
differences, both where the old page misbehaved: the demo cards ("Xem hiệu ứng thẻ") show real dates (the old ones fed
milliseconds as seconds: year 58000), and without 3D models a card shows no empty 3D box. Checks: `test/gara.test.tsx`
(8), e2e `portal-gara.mjs` (the same steps on both sites, each result compared: a store that fails in game, one that
lands, its Lấy ra with the reply translated, the diet tabs, the search, the demo cards; Copy; Rex's 2 slots; a guest).
The runner lists page errors of the old site (`old: true` flows) without counting them (skin3d.js throws there when
the 3D models are missing).

**2. Dino Live: done 2026-10-06.** `pages/game/GamePage.tsx`, `features/game/{DinoHero, Tele, PrimeCard, Stats}.tsx`,
`components/TierFx.tsx` (the tier decorations + F badge, for Gara too), `lib/{commands (waitCommand, ERROR_VI), dino3d}`;
types `PrimeBoard`, `TeleView`, `PrisonView`, `CommandResult`. Two things differ from before React, both fixes: the vitals
show as soon as a dino spawns (the old grid kept "Chưa có chỉ số" until a reload when the page was opened without a dino),
and the lab 3D box stays hidden when no model loads (the old one stayed empty and logged an error). Kept as it was: a prime
board alone (no elder stack) leaves the card's plain tier (getHeroCardTier read `.prime.prime`). Checks:
`test/game.test.tsx` (10), e2e `portal-game.mjs` (95: old vs new in game, not in game, a guest; tele typing, a wrong code
and your own code refused as before React, a code taken / copied / dropped; lab), screenshots old / new: the same but the
running play time.

**1. Trang chủ: done 2026-10-06.** `pages/home/HomePage.tsx`, `features/home/{Rewards, LauncherHub, ServerStatus,
LauncherPromo, Guide}.tsx`, `lib/{dino, amber}`, `components/RelBadge`; types `Checkin`, `Quest(s)` in `@isle/api`.
`local-portal.sh` seeds Trang chủ's data (features open, Hổ phách NEW, the shop SVip-first, check-in after 1 minute, a
done and an undone quest, the starter gift, the launcher's version.json). Checks: `test/home.test.tsx` (8), e2e
`portal-home.mjs` (50: the old page read into localStorage, the new must show the same text part by part, web and launcher;
check-in / quest / starter claims with their toasts and the balance; the balance opens the shop; Luật scrolls and lights
the rules; a guest), screenshots old / new (web, launcher; 380, 1366): the same to 5-7 pixels (animated dots).

| # | Page | Now in | What it holds |
|---|---|---|---|
| 1 | Trang chủ | index.html `#page-home`; app.js "Trang chủ" (~3399) | rewards bar (starter gift, Hổ phách), daily check-in, daily / weekly quests (claim), the launcher hub (quick access, the dino now with vitals and prime, voice / overlay state, server telemetry, update, game mode), server status and slots, login button, launcher promo (web only), server rules ("Luật & Dinh Dưỡng") |
| 2 | Dino Live (Game) | `#page-game`; app.js parts 2 and 4; "Tele con non" (~3277) | the dino played now: vitals, growth, prime tasks, mutations, 3D (lab), tele con non |
| 3 | Gara | `#page-gara`; app.js ~979-1371 | the player's slots, store / redeem from the web, the garage levels |
| 4 | Bản đồ | `#page-map`; map.js (925); app.js "Kết bạn" | own dino and accepted friends, layers, AI heatmap / zones, Kết bạn (search, add, accept), open the big map |
| 5 | Xếp hạng | `#page-ranking` | the leaderboards |
| 6 | Skin Studio | `#page-skin`; app.js part 3; skin-editor.js; skin3d.js | colours per region, pattern / theme / variation, palettes, the 3D preview, save; effects / glow / kept colours in lab |
| 7 | Voice 3D | `#page-voice`; voice.js (728, LiveKit) | login gate, the proximity room, range, microphone, push-to-talk keys, who speaks near you |
| 8 | Túi đồ | `#page-bag`; app.js ~1907-2512 | the bag, the use box, dino boxes (species roll or pick), hòm (gacha roll), mutation items, tickets |
| 9 | Cửa hàng | `#page-shop`; app.js "Cửa hàng" | listings, buy dialog, daily limits |
| 10 | Overlay HUD | `#page-overlay`; overlay-settings.js (323) | launcher only: which widgets, where, their settings |

## 2. Across pages

- Command palette (Ctrl+K, `#cmd-palette-modal`).
- The onboarding tour (app.js ~2851-3125: steps, spotlight, skip, the AI map highlight).

## 3. The other pages

- `bigmap.html` / `bigmap.js`: the launcher's big map window (key M; `launcher/src/bigmap.js` feeds it).
- `mutations.html` / `mutations.js`: the public mutation guide.
- `tai.html` / `tai.js`: the launcher download page (web only; inside the launcher it goes home).
- `launcher-done.html`: the end of the launcher's Steam login (`/launcher-done.html?error=…`).
- `voice.html`: old address, the launcher turns it into `#voice` (launcher/src/main.js).

## 4. The switch

- The portal server serves the React build at `/`, the current site kept at `/old` for a while (as the
  panel: relative paths keep working without a trailing slash), a fallback when the build is missing.
- The launcher keeps working unchanged: it loads `${BASE}/`, `bigmap.html`, intercepts `/voice.html`;
  check each against the new pages before the switch.
- Later, with the owner: remove the old files.

## Not in this plan

The launcher's own local pages (`launcher/src/gate.html`, `splash.html`, `overlay.html` widgets) ship
inside the launcher, not from the portal: a separate decision.
