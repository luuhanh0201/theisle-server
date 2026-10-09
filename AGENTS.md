# The Isle Evrima server, agent guide

## What this repo is
Config + UE4SS Lua mods for a The Isle Evrima dedicated server.
Server = Windows build running under Wine on Ubuntu VPS, UE4SS experimental.
Game binaries are NOT in this repo (installed via SteamCMD).

## Hard rules
- Never touch or delete anything under `**/Saved/` (player data).
- Never write real secrets; use placeholders in `config/*.template`, values live in VPS `.env`.
- Claude Code may ssh to the VPS for read-only checks (logs, data, status).
  Deploys, restarts and anything that changes the live server: only when the
  user asks for it, never a restart while players are online. Other agents
  (e.g. Antigravity) still never run deploy, git or ssh, they propose them.
- Before writing Lua that calls game functions, read `docs/lua-safety-rules.md`.

## Lua mod rules (summary, full list in docs/lua-safety-rules.md)
- Hooks only queue work; engine work runs on the game thread via H.defer /
  H.onGameThread (ExecuteInGameThread), never directly in ExecuteWithDelay or
  LoopAsync callbacks (those are the async thread).
- Never cache controller/pawn across ticks; store SteamID, re-resolve via GetControllerBySteamId.
- Always check pawn:GetAddress() ~= 0 before use.
- Never call RequestRespawn / UpdateChat / UTISaveManager functions (crash).
- FName fields: write FName("x"), never a Lua string.
- Re-apply vitals after any SetGrowth.
- Growth changes (owner's rule after the 2026-10-05 vomit): whatever grows or
  shrinks a dino (admin growth, growth bag, Phiếu Prime, garage restore, a
  gift, any new item or command), EVERY stat must follow the new growth at
  once: maxima as the game has them for that growth, current values as the
  same share of the max (never above it), and the originals
  (OriginalMaxHunger…) the same. Never set any growth by hand: call
  `Restore.regrowKeep` (garage/restore.lua). The stomach is always
  `Stomach.RATIO[species] x max health` (garage/stomach.lua), never read from
  the dino. A new growth path needs: a test in tests/test_admin.lua or
  tests/test_dinogarage.lua (stomach = share x max health, food <= stomach,
  then the next growth tick) and a GrowthLab run on the test server.
  Details: docs/lua-safety-rules.md, rule 11.

## Writing (every text: UI, game messages, panel, launcher, docs, comments, replies)
- Never use the em dash (the long dash, U+2014). Write a comma, a colon,
  parentheses or a new sentence instead; "-" for an empty value. Owner's
  rule, 2026-10-05. Check before committing: `git grep -nP '\x{2014}'`
  must print nothing.
- Never break a line unnaturally or awkwardly: within the same title, heading,
  badge or coherent label phrase, keep it on a single line (e.g. `white-space: nowrap`
  or `text-wrap: balance` where appropriate; avoid `<br>` inside titles). Owner's
  rule, 2026-10-05.

## UI (panel, portal, launcher pages)
- Titles and headings: a title must stay on one line, never an awkward or
  unreasonable line break midway through a title or header phrase (use
  `white-space: nowrap`, with `text-wrap: balance` on very narrow screens).
- Never the browser's own select box, number spinner, date / time picker,
  checkbox, slider or colour picker, on the player site, the launcher's pages
  and the panel alike: the pages are React (web/) and use the shared controls of
  `@isle/ui` (`web/packages/ui`): `Select`, `NumberInput`, `DateTimeInput`,
  `Checkbox` / `CheckGrid`, `Switch` (on / off), `Slider`, `ColorInput` (never
  the OS colour dialog), `SuggestInput` (a suggestion list). Never a one-off
  dropdown, picker or slider, never a plain `<select>` / `<input type=number…>`.
- Their CSS is CSS Modules (hashed class names): style them through their own
  props / module, not global selectors; a slider's fill is the CSS variable
  `--pct`. Their popups open in the `<dialog>` that is open, else in `<body>`
  (`popupHost`). `portal/public/ui-select.js` / `ui-inputs.js` (the controls of
  the sites before React, same look) are still served by the portal and the
  bridge, but no page loads them any more.
- Panel refresh: a list page asks again every 2 s (TanStack Query
  `refetchInterval`); React redraws only what changed, so a popup open, typing,
  a dialog or selected text is never lost; a settings page never overwrites the
  admin's form and only shows the "Có thay đổi mới" bar when its data changes on
  the server (`useSettingsForm`, below).
- The skin colour editor is shared too (`portal/public/skin-editor.js`).
- Mutation icons: `<img data-mut-icon="Name">` (filled by `portal/public/mut-icons.js`
  from one bundle); never one `<img src=".../<slug>.svg">` each, many at once
  trip the proxy (503). After adding an icon: `node scripts/build-mutation-icons.mjs`.

## Panel in React (web/): the admin panel (every page moved, 2026-10-06)
- `web/` (React 19 + Vite + TypeScript, TanStack Query, CSS Modules), one `npm install` there.
  Built into `bridge/public/next/` (gitignored; `deploy.sh` builds it with the bridge), served at
  `/` (and `/next/`). The panel before React was removed on 2026-10-07 (git tag `old-sites-20261007`);
  `/old` goes to `/` on the same `#tab/sub`.
- Progress and the next steps: `web/MIGRATION.md` (read it first, update it with each page moved).
  One session at a time moves pages: two sessions pushing the same blocks to main mix their code
  (2026-10-06). Before starting, `git pull` and read MIGRATION.md; push after each block.
- Layout: `web/packages/ui` (shared controls: Button, Card, Field, NumberInput, Select, Switch,
  TextArea, SubTabs, Dialog, Toast… never the browser's own controls), `web/packages/api` (getJson / adminFetch, the
  bridge's answer types: keep them in step with bridge/src), `web/apps/panel/src/{app,pages,features}`:
  `app/` the frame (nav.ts pages + permissions, router.ts, session.tsx token), `pages/<tab>/` puts
  a block's sub-pages together, `features/<area>/<thing>/` one feature (component, hook, CSS, test).
- A settings page: `useSettingsForm<R, T = R>(url, { label, href, select?, toBody?, saved? })` +
  `<SettingsPage>` (loads once, "Có thay đổi mới" bar, unsaved drafts kept across pages, Lưu with
  the login's token, toast `saved`). A GET with more than the form edits (status, catalog):
  `select` the editable part, read the rest from `latest`.
- A new page: in its `pages/<tab>` and `nav.ts`; an address with no page shows `MissingPage`.
- Check: `cd web && npm test && npm run build`; the block's e2e flow (`web/e2e/flows/<tab>.mjs`,
  on a local bridge: `web/e2e/local-bridge.sh`); screenshots at 380 and 1366 px, light and dark
  (`node web/scripts/shots.mjs`).

## Player site in React (web/apps/portal)
- Plan, progress and how to test: `web/PORTAL-MIGRATION.md` (read it first, update it with each block;
  one session at a time, `git pull` first, push after each block). Built into `portal/public/next/`
  (gitignored), served by the portal at `/` (and `/next/`); same `#page` addresses. The site before React
  (`portal/public/index.html`, `app.js`, `voice.js`, `overlay-settings.js`) was removed on 2026-10-07
  (git tag `old-sites-20261007`); the e2e flows still compare with it: `web/e2e/local-portal.sh` takes it
  out of the tag and serves it at `/` on the local portal only (`PORTAL_OLD_SITE_DIR`, never on the server).
  The pages of their own (`tai.html`, `mutations.html`, `bigmap.html`, `launcher-done.html`) are React too
  (`web/apps/portal/<page>.html`, served at the same addresses); their old files are in the same tag.
  `voice.html` stays a plain page (it sends to `/#voice`).
- Inside the launcher the site has its own look (`web/apps/portal/src/app/launcher/`, owner's design
  2026-10-07): the same pages, ids and calls, only the frame and Trang chủ drawn differently; the player can go
  back to the web look (`isle_ui`). A change to a page must work in both looks: `portal-launcher.mjs` and
  `portal-launcher-parity.mjs` run it in the launcher's look.
- Same look: the old stylesheet as it was (`src/styles/portal.css`, global class names) and the old
  markup's classes in JSX; `@isle/ui` controls in the portal's colours (`src/styles/tokens.css`).
- No inline script (the portal's CSP). Launcher rules unchanged: no download element inside it.

## Launcher
- Inside Xóm Gáy Launcher (`window.isleLauncher`, `inLauncher()` in
  `web/apps/portal/src/lib/launcher.ts`) nothing about downloading the launcher
  shows: no download page, link, button, badge or promo. Such an element is not
  drawn when `inLauncher()` and also carries class `web-only` (portal.css hides it
  under `html.in-launcher`, a class main.tsx leaves off for now: `MARK_IN_LAUNCHER`);
  `/tai.html` opened there goes back home (`tai.main.tsx`). A new download link
  drawn in the launcher is a bug.

## Test server
- `scripts/test-server.sh` (on the VPS: /home/isle/bin/test-server.sh, run as
  `isle`): a copy of the live server at /home/isle/test, ports 7787 / 10001 / 8889.
- The test server is always opened WITHOUT a password (bServerPassword=false).
- Labs (SpeciesLab, StatLab…) are enabled only in the test copy's mods.txt.

## Every fix or new feature: check the old flows still work
Before calling a fix or a feature done:
1. List every caller of what you changed (grep the function, field, event,
   file name, API route, log line or setting) across mods/, bridge/, portal/,
   web/, launcher/, not only the file you edited.
2. For each flow that goes through it (e.g. a garage change: player store,
   player redeem, admin-made slot, prime slot, prime fixes, unlock heal), say
   whether its behaviour changes, and why that is fine.
3. Keep the existing tests passing without weakening them; add a test for the
   bug or feature next to the tests of the flows it touches.
4. Report the flows you checked, and any you could not check (e.g. needs the
   live server), in the final summary.

## How to verify a change
User runs `scripts/logs.sh ue4ss` and pastes output. Look for
`Error loading script` / `Failed to execute main script`.
On a new server or UE4SS build, run IsleProbe first: `scripts/logs.sh probe`
prints its PROBE SUMMARY (docs/first-run.md).

## Known facts about this server
- Game version, known class names (BP_PlayerController_C, BP_Dilophosaurus_C...)
- Working hooks: ServerAcknowledgePossession, NotifyOnNewObject(PlayerController)
- Engine: Unreal Engine 5.6 (UE4SS log: "Found EngineVersion: 5.6", 2026-09-23).
- UE4SS: experimental build (scripts/install-ue4ss.sh), unpacked FLAT in
  Binaries/Win64, no ue4ss/ subfolder. Stable v3.0.1 fails its scan
  ("PS scan timed out") and loads no mods.
- Wine: a Wine 11.0 built with ntsync, the server's only one: `/home/isle/wine-ntsync` (scripts/build-wine-ntsync.sh;
  WineHQ's Ubuntu 24.04 package had no ntsync and was removed 2026-10-07). The VPS runs the HWE kernel 7.x
  (`/dev/ntsync`, group isle; the 6.8 kernels removed). start.sh runs it (WINE_BIN overrides it for a test). Measured
  the same load: game CPU 101 % -> 87 %, the lowest FPS 22 -> 30; with 1-2 players about 5 % less CPU. A new Wine:
  build it again with that script.