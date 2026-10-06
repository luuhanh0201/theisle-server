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
| 6. Skin Studio | **done** (below) |
| 7. Voice 3D | **done** (below) |
| 8. Túi đồ | **done** (below) |
| 9. Cửa hàng | **done** (below) |
| 10. Overlay HUD | **done** (below; every page of section 1 is now in React) |
| 2. Across pages | **done** (below: Ctrl+K, the tour) |
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
- Next (after 6-10 and 2, done the same day): 3 other pages, 4 the switch.
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

**10. Overlay HUD: done 2026-10-06.** Two parts. The page: `pages/overlay/OverlayPage.tsx`, `features/overlay/Overlay.tsx`
(overlay-settings.js in React, same ids `ov-*`): in a browser only the card saying it is a preview; in the launcher the
widget tabs and their settings (style, size, background, opacity, shown parts, reset), the whole overlay on / off, preview,
edit on screen, the layout (each box dragged or resized, `overlayPlace`), the keys (a refused capture says why), game
mode's kept widgets, the big map's screen and the black-edge fix; changes grouped and sent 80 ms after the last one, as
before. The service, for the whole visit (`lib/overlay.ts`, `startOverlay(queryClient)` in main.tsx; app.js's
pushOverlayGame / sendMiniFrame): on each /api/me it hands the overlay your dino, the AI, the zones, the heat, escaped
inmates, your friends and the map's target; draws the mini map widget from the map (map.js paintMini, through
`lib/mapService.ts`, which now keeps the last data it loaded: `mapData()`) and sends it as a webp picture while the
widget is on; feeds the big map (key M) while it is open; polls AI / zones / heat / friends when the map page is not
shown. Nothing in a browser. Checks: `test/overlay.test.tsx` (3), e2e `portal-overlay.mjs` (4 flows, 28 checks:
`overlay-stub.mjs` stands in for the launcher's overlay calls, recorded in `window.__ov`; every step and every call
compared with the old page; what is handed over each second and to the big map; the mini map got pictures; a browser),
screenshots old / new at 380 and 1366: the same but the animated status dot.

**9. Cửa hàng: done 2026-10-06.** `pages/shop/ShopPage.tsx`, `features/shop/{Shop.tsx, Shop.module.css}`: read when the page is
shown, then every 30 s while it is (not while buying or the box is open), the balance, tabs by kind (the bag's), a card per
listing (why it cannot be bought now, how many left today, the number box 1-10 at 120 px as before), the confirm box (total,
what is left after, today's limit), the buy, the toast, the bag and balance read again. One difference, a fix: after a buy
the line "✅ Đã mua …" stays (before React the shop's reload hid it at once). `seed-bag.mjs` also puts eight listings on sale
(one off) and gives Live Tester 2000 Hổ phách; `local-portal.sh` makes Live Tester an SVip (the shop is SVip-first: Rex sees
it locked). Checks: `test/shop.test.tsx` (5), e2e `portal-shop.mjs` (6 flows: amounts as N, a buy of 2 lowering the balance
and today's limit by the same on both sites; Rex locked; a guest), screenshots old / new: the same to under a pixel.

**8. Túi đồ: done 2026-10-06.** `pages/bag/BagPage.tsx`, `features/bag/{Bag, BagDialog, parts}.tsx`, `bag.ts` (groups, what can be
used now, what does not fit, the tabs, the dino item's slot choices, the hòm's strip). The cards, tabs, search, the use box
(care items, prime, a mutation / ticket / clear into a slot), a dino box opened with its roll, the dino item into the garage,
a hòm's gacha roll, a skin worn: the same texts, ids (`bag-*`, `#bag-dlg`), requests and answers as app.js. The dialog is
shown when a use asks for it (showModal once, as before) and a late "close" event of the box before never drops a new one.
One difference, a fix: a refusal inside the use box stays there (before React the box redrew over it at once).
`e2e/seed-bag.mjs` (run by local-portal.sh) makes one item of each kind through the bridge's admin API and gives them to
Live Tester (5 copies) and Rex (1); `live-feed.mjs` answers a use per kind (odd refused, even done, the copy then taken by
the bridge). Checks: `test/bag.test.tsx` (9), e2e `portal-bag.mjs` (6 flows, 34 checks: the in-game steps compared with the
old page, counts as N since each run uses some; Rex; a guest sent home; each in-game run waits for a fresh minute, the
portal takes 12 writes a player a minute), screenshots old / new at 380 and 1366: the same but the rare cards' shine.

**7. Voice 3D: done 2026-10-06.** voice.js ported to `lib/voice.ts`, an engine for the whole visit (`startVoice()` in
main.tsx: the keys, the launcher's push-to-talk and range key, `window.isleVoice`, /api/me for the login card): the room
stays joined on every page, the menu dot (`lib/voiceDot.ts`) and the launcher's overlay (`overlayState`) follow it. The
same LiveKit client (/vendor, loaded on the first join), RNNoise (/vendor/noise-suppressor), settings key `isle-voice`,
texts and rules (who may hear us, volume and side per speaker, out of game = muted). `features/voice/Voice.tsx` draws
`useVoice()` with the old ids (`v-*`); the meter bar is written from `onLevel` (20 a second) without redrawing the page.
`pages/voice/VoicePage.tsx`. Checks: `test/voice.test.tsx` (6, LiveKit and Web Audio faked), e2e `portal-voice.mjs`
(7 flows: `voice-stub.mjs` stands in for LiveKit and /api/voice* on both sites: join, chips, notes, range by button and
by the ` key, micro modes, the talk key, noise filter, threshold, volume, speakers near, muted, name mode, out of game,
signed in elsewhere, leave, a refused join, `isleVoice.status()`; still joined on Gara; in the launcher: its talk key,
range key, a refused key capture, the overlay's state; a guest), screenshots old / new (logged in, before joining): 380 px
the same, 1366 px 262 pixels (the animated logo and dots).

**6. Skin Studio: done 2026-10-06.** `pages/skin/SkinPage.tsx`, `features/skin/{SkinStudio.tsx, useSkinViewer.ts, skin.ts}`.
The editor as before React (same ids and classes: `.se-*` from skin-editor.js, whose `injectCss` is now exported for it):
regions (colour box + hex), palettes, pattern / theme / variation, sex, Lấy màu (through `Dino3D.fromGame`), Áp dụng
(POST /api/skin, `waitCommand`), the XG1 code out / in, skins saved in this browser (`xg.skins.v1`), in lab the effects,
"keep" and the kept colours' chips (✕ = `{ forget }`). The 3D preview is driven from React (`useSkinViewer`: made once
the models load, follows the dino played now, a new species or sex shown at once, else the first species): the page has
no `#skin-species`, so skin3d.js's own editor part never binds to React's markup. Two differences, both fixes: with no
model on the server the menu says "-" and the note says so (the old one kept "Đang tải…"), and the effects grid is
dimmed by its tick box whatever set it (the old one stayed dimmed when a code turned the effects on).
`live-feed.mjs` now gives Live Tester a skin and answers a skin command (odd tries refused, even ones written, the dino's
own colours back 6 s later); `local-portal.sh` writes an empty `portal/public/dino3d/registry.json` when there is none
(the 404's JSON was read as the model list and the old page's renderGame threw every second once Skin was opened).
Checks: `test/skin.test.tsx` (14, the viewer mocked), e2e `portal-skin.mjs` (68: in game, Rex, a guest, lab; every step
compared with the old page), screenshots old / new at 380 and 1366: the same but the species menu and the note.

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

**Done 2026-10-06.** `app/CommandPalette.tsx` (app.js PALETTE_DATA, 40 entries: pages, species, chat commands, places; Ctrl
or ⌘+K opens and closes it, a search by title / text / group, ↓ ↑ wrap, Enter, Esc, ESC, a click outside; a chat command
copied with its toast, a species opens Skin Studio with its toast, a place the map, the tour) and `app/Tour.tsx` (TOUR_STEPS,
5 steps: the step's page opened when the step is shown, its target lit, the step beside it or in the middle on a phone; →
← Enter Esc, the dots, ✕ Bỏ qua; done: `isle_portal_tour_done` and the toast; opened by itself a second after a first
visit; the header's 💡 Hướng dẫn and the palette open it), both mounted in `app/Shell.tsx`. Differences, all kept: a step's
page is in the address (#gara...), before React the address did not change; Enter on the palette's tour entry opens step
1 (before React the same key also reached the tour, which went on to step 2); out of the launcher the last step lights the
header (before React a 12 px box in the corner: the hidden overlay entry, which in React is only there in the launcher,
`#nav-overlay` as before). Enter right after an arrow takes the entry the arrow chose. The overlay service listens to game mode
through `lib/launcher.ts` (`gameMode().listen`): one launcher listener for the page, as app.js. Checks:
`test/across.test.tsx` (5), e2e `portal-across.mjs` (6 flows, 41 checks: every palette and tour step compared with the
old page; a page opened during a step stays; seen already: not opened).

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
