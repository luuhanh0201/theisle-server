# Moving the panel to React: where it stands

The progress log of the move (AGENTS.md "Panel in React"). The goal is a change of technology
only: every page does what it did in the panel before React (`bridge/public/index.html`), same
texts, same saves, same rules. A new session reads this first, picks the next step below, and
updates this file in the same commit as the pages it moves.

**Status (2026-10-06): done.** Every block is in React and `/` serves it; the panel before React
stays at `/old` for a while (step 5 below). New work on the panel goes into `web/` only.

**One session at a time.** On 2026-10-06 two sessions moved the same blocks and both pushed to
main: the code got mixed and main stopped building (113 type errors). It was repaired by keeping
one version (the one `Routes.tsx` used, with the e2e flows). Before starting: `git pull`, read
this file, and push after each block.

## Done (served at /next/)

| Block | Sub-pages in React | Block page | e2e flow |
|---|---|---|---|
| Tính năng mod | Lệnh chat, Ptera gắp, Tele con non, Voice gần, Thông báo (all) | `pages/mods/ModsPage.tsx` | `e2e/flows/mods.mjs` (28 checks) |
| Thế giới | Tổng quan, Thực vật, Cá (all) | `pages/world/WorldPage.tsx` | `e2e/flows/world.mjs` (20) |
| Gara | Dino & tạo dino, Cài đặt gara (all) | `pages/garage/GaragePage.tsx` | `e2e/flows/garage.mjs` (20) |
| Thành viên | Admin, Phân quyền, Whitelist, VIP, SVip (all) | `pages/members/MembersPage.tsx` | `e2e/flows/members.mjs` (17) |
| Quản trị | Truy cập panel, Nhật ký admin, Discord (all) | `pages/admin/AdminPage.tsx` | `e2e/flows/admin.mjs` (13) |
| Server | Vận hành, Cấu hình game, Dữ liệu (all) | `pages/server/ServerPage.tsx` | `e2e/flows/server.mjs` (27) |
| Người chơi | Danh sách, Killfeed, Xếp hạng, Chat, Ban, Nhà tù, and the player page `#player/<id>` (all) | `pages/players/PlayersPage.tsx`, `features/players/player/PlayerPage.tsx` | `e2e/flows/players.mjs` (59) |
| Vật phẩm | Skin dino, Mutation, Phiếu & hộp (all) | `pages/items/ItemsPage.tsx` | `e2e/flows/items.mjs` (26) |
| Bản đồ | the one page: the live map (layers, search, hover, path of a life) and its tabs Vùng AI, Thả AI, Làm mới, Dino nhỏ, Người chơi | `features/map/MapPage.tsx` | `e2e/flows/map.mjs` (28) |
| Tổng quan | the one page: KPIs, alerts, Hiệu năng server (tiles, 4 charts, table), Sức chứa, Diễn biến with filters, Thao tác nhanh | `pages/overview/OverviewPage.tsx` | `e2e/flows/overview.mjs` (11) |
| Truy cập | the one page: tiles, six line charts, ranges, hover box | `pages/traffic/TrafficPage.tsx` | `e2e/flows/traffic.mjs` (8) |
| Nhiệm vụ | the one page: Điểm danh, Hổ phách, Cửa hàng, Sổ giao dịch, Nhiệm vụ ngày / tuần | `pages/quests/QuestsPage.tsx` | `e2e/flows/quests.mjs` (14) |

Routing: `app/Routes.tsx` sends a tab to its block page; a sub-page may carry a part after a colon
(`#server/cfg:spawn`): `pickSub` keeps it, `BlockPage` shows the sub-page before the colon and the
page reads the rest from `useHashRoute()`; each block page is a `app/BlockPage.tsx`
with `pages={{ <sub>: Component }}`. A sub-page not listed there shows a link to the old panel
(`LegacyPage`). The old pages in `bridge/public/index.html` stay: the panel at `/` is still the one
admins use, until every block is moved and `/` switches to the React build.

## Not moved yet (next steps, in this order)

1. ~~**Server**~~ done: Vận hành (`features/server/ops/`), Cấu hình game (`features/server/config/`,
   `#server/cfg:<group>`, "Lưu & khởi động lại" = `form.save({ extra: { restart } })`), Dữ liệu
   (`features/server/data/`: backup now / settings / download / delete, export, restore from a
   backup or a file, wipe with "XOA DU LIEU" typed; restore and wipe only when the game is stopped,
   then the bridge restarts and the page reloads). The e2e flow never presses start / stop /
   restart, restore or wipe (local bridge: `SYSTEMCTL=true`, `BACKUP_DIR` in its folder). Once, the
   first run after a build had one step fail and three runs after it passed: if a server step
   fails, run it again before hunting.
2. ~~**Người chơi**~~ done (`features/players/`). Ban: no RCON on the local bridge, so the e2e flow
   checks the refusal, then edit / unban on the fake `PlayerBans.json` (the bridge drops commas from
   ban reasons, as always). The player page `#player/<id>` (`features/players/player/`: hero + kill,
   vitals, Thao tác admin, Thành tích, Nhật ký, garage cards with delete, Các đời dino with filters,
   restore to the garage) is routed in `app/Routes.tsx` by `usePlayerId()` (router.ts), outside the
   blocks, its address kept; the sidebar lights Người chơi there. Its "Đường đi" link opens the React
   map (`#map/path/<id>/<spawnedAt>`).
3. ~~**Vật phẩm**~~ done (`features/items/`): one editor hook for the three pages
   (`useItemEditor`: selected item, draft kept while away, "Bỏ thay đổi chưa lưu?" before another,
   POST / PUT then reselect, retire / issue again), `ItemParts.tsx` (list row with rarity frame,
   Người sở hữu with grant / revoke). Skin: the colour editor is React (`skins/SkinEditor.tsx`) over
   the portal's `skin-editor.js` data and maths (`@portal/skin-editor` alias, types in
   `packages/types/skin-editor.d.ts`), the colour box is `@isle/ui` `ColorInput` (never the OS
   dialog); the 3D is the portal's `/skin3d.js`, loaded at run time, one shared viewer
   (`skins/Viewer3D.tsx`); without the model registry (local copy) it says so. Admins hold a copy
   of every item (items.ts fillBags): the e2e flow looks at the test player's rows only.
4. ~~**Nhiệm vụ**~~ done (`features/quests/Quests.tsx`: three settings forms with `useSettingsForm`
   (`putUrl` for the check-in), the amber +/- and the ledger as live lists). ~~**Truy cập**~~ done
   (`features/traffic/`, charts from `components/chart/LineChart.tsx`, shared with Tổng quan). ~~**Tổng quan**~~
   done (`features/overview/`: Overview.tsx, Perf.tsx). ~~**Bản đồ**~~ done (`features/map/`): the old engine
   moved as it was: `store.ts` (the old `lm` / `az` / `gd` objects, mutated in place; `changed()` redraws the
   canvas and re-renders the panels through `useMapState()`), `draw.ts` (drawMap, same order and look),
   `hit.tsx` (hitTest + the hover box), `zones.ts` (zone geometry, as bridge/src/zone-shape.ts), `load.ts`
   (map image / water once; /api/map 2 s, /api/map/live 1 s, flora 60 s, ai-zones and zone-guard 2 s),
   `MapView.tsx` (canvas, tools, search, hint bar, pointer / wheel / keys), `ZonesPane.tsx`, `Panes.tsx`.
   `#map/path/<id>/<spawnedAt>` is kept by Routes (not rewritten to `#map`). Dino nhỏ's per-species
   maximum is a select (5..100 %, "mặc định") instead of a blank-able number box: same values saved.
5. ~~`/` serves the React build~~ done (2026-10-06, bridge/src/server.ts): `/` and `/next/` open the React
   panel (and fall back to the old one when `public/next/` is missing); the panel before React is at
   `/old` (no slash, so its relative `img/`, `map/` still resolve; `/old/` redirects there), behind the same
   login. Each panel links to the other on the same `#page` ("Về panel cũ" / "Về panel mới"; e2e
   `panels.mjs`). The e2e flows now open `/#…`. Still to decide with the owner, later: when to delete
   `/old` and `bridge/public/index.html` (nothing in React depends on them).

A list page redraws every 2 s but never while the admin is busy (popup open, typing, dialog,
text selected: the old panel's `busyUI`); see how Gara → Dino and Nhật ký admin do it.

## Shared pieces

- `@isle/ui` (`web/packages/ui/src/index.ts`): Button, Card, Checkbox / CheckGrid, Dialog, Field,
  GroupLabel, Hint / Mono, Icon, NumberInput, PageHead, Select, SectionTitle, Slider, SuggestInput,
  SubTabs, Switch, Table, TextArea, TextInput, Toast. Never the browser's own controls.
- `useSettingsForm<R, T = R>(url, { label, href, select?, toBody?, saved?, putUrl? })`
  (`features/settings-form/useSettingsForm.ts`): R is the GET's answer, T what the form edits;
  `select` picks T out of R (a status or catalog beside the settings), `latest` is the last GET
  whole (live numbers, status lines), `toBody` turns the draft into the PUT's body, `saved` is the
  toast after a save (a text, or a function of the PUT's answer). After a save the GET is read
  again. Comparison ignores key order. Edits survive leaving the page (unsaved bar). `form.base` is
  what the draft was loaded from; `form.save({ extra, saved })` sends more with the body and
  another toast (Lưu & khởi động lại). `putUrl`: the PUT has its own address (Nhà tù: GET
  `/api/prison`, PUT `/api/prison/settings`).
- A text kept as a draft outside useSettingsForm (Ban → Mẫu lý do): `setDraft(key, { label, href,
  value, save })` from `features/settings-form/drafts.ts`, as `features/players/bans/Bans.tsx` does.
- `@isle/ui` **FileInput** (a file chooser in the panel's colours) and **Table** (`cards`: rows
  become cards on a phone, cells named by `data-label`; or the plain `components/table/Table.module.css`).
- `@isle/ui` **ColorInput** (swatch + picker: saturation square, hue bar, hex, Xong; Esc puts the
  first colour back): the React twin of `ui-inputs.js`'s colour picker.
- `@isle/ui` **DateTimeInput** (`kind` time / date / datetime, the native input's value text): the
  React twin of `ui-inputs.js`'s date / time picker.
- `test/fakeBridge.tsx`: `fakeBridge(url, get, put)` for a settings page, `fakeApi({ 'GET /api/x': …,
  'POST /api/y': (body) => … })` for a page of many routes (with the confirm dialog).
- `node web/scripts/shots.mjs` also shoots a running local bridge (`PANEL_URL` + `PANEL_COOKIE`);
  with `OLD=1` too it shoots the old panel at `/` (files `old-<tab>-<sub>-…png`) for the comparison.
- `components/list/List.tsx`: `ListTools` (search + filters), `Seg`, `SortTh`, `Pager` ("Hiển thị a-b /
  n … · trang x/y"), `pageOf`, `Pill`, and `List.module.css` `.table` (the old `.table-wrap table`:
  numbers right, first column left), `.rowLink`, `.notice`, `.hideSm`.
- `components/feed/`: `Feed` (the game's log as columns, every event type of the old `describe()`),
  `KillScene` (a death's 📍: map, people within 200 m, the fight). `lib/map.ts`: the island map
  (gateway.json + image) and its projection, for the scene now and Bản đồ later.
- `components/chart/LineChart.tsx`: `LineChart` (the old .perf-chart: round top, grid, x labels, dashed
  reference, broken lines on gaps, legend, crosshair; measured width via `useWidth`), `ChartTip`, `Tile` /
  `Tiles`, `niceCeil`.
- `lib/players.ts`: `prDur`, `lastSeenText`, `pingTone`, `copyText`.
- `app/confirm.tsx`: the confirm dialog (never the browser's confirm()).
- Mutations: `features/mutations/` (reference, notes, catalog), the picker and tooltip in
  `features/garage/creator/`.

## How a move is checked

1. `cd web && npm test && npm run build` (typecheck included).
2. The block's e2e flow on a local bridge, never the live one (the flows save):
   ```
   (cd bridge && npm run build) && (cd web && npm run build)
   sh web/e2e/local-bridge.sh /tmp/isle-e2e        # prints PANEL_COOKIE=..., fake data only
   cd web && CHROME=/opt/pw-browsers/chromium PANEL_URL=http://127.0.0.1:8091 PANEL_COOKIE=... node e2e/run.mjs e2e/flows/<tab>.mjs
   ```
   (On a machine with Google Chrome, leave `CHROME` out. In a cloud session do not set `TMPDIR`
   to a long path: Chromium then fails to start.) The fake data uses the game's class names
   (`BP_Tyrannosaurus_C`): a flow that needs more data, add it to `local-bridge.sh`. The flows
   change the data (a ban removed, a player jailed): run them on a NEW empty folder each time.
   Each flow passes alone on a new bridge (checked 2026-10-06, all 13): overview waits for the
   first perf sample (the bridge measures every 10 s), quests makes an item to sell when there is none.
3. Screenshots at 380 and 1366 px, light and dark: `node web/scripts/shots.mjs <out> <tab/sub>...`
   (answers `/api/*` from `web/scripts/shots-fixtures.mjs`), compared with the old page.
