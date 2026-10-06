# Moving the player site (portal) to React: the plan

The same move as the admin panel (`web/MIGRATION.md`, done 2026-10-06): a change of technology only.
Every page does what it does now in `portal/public/` (index.html 5,477 lines, app.js 3,532, plus
map.js, voice.js, skin-editor.js, skin3d.js, overlay-settings.js, bigmap.*, mutations.*, tai.*),
same texts, same calls to the portal server (`portal/src/server.ts`), same launcher behaviour
(`window.isleLauncher`, `html.in-launcher`). The portal server (TypeScript) does not move; only its
pages do. One session at a time; `git pull` and read this file first; push after each block.

Nothing is done yet. Mark each step done here, with its files and its e2e flow, in the commit that does it.

## 0. Foundations (before any page)

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
