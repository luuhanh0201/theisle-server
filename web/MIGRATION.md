# Moving the panel to React: where it stands

The progress log of the move (AGENTS.md "Panel in React"). The goal is a change of technology
only: every page does what it did in the panel before React (`bridge/public/index.html`), same
texts, same saves, same rules. A new session reads this first, picks the next step below, and
updates this file in the same commit as the pages it moves.

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
| Người chơi | Danh sách, Killfeed, Xếp hạng, Chat (Ban, Nhà tù: not yet) | `pages/players/PlayersPage.tsx` | `e2e/flows/players.mjs` (25) |

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
2. **Người chơi** (in progress): ~~Danh sách, Killfeed, Xếp hạng, Chat~~ done (`features/players/`).
   Next: Ban, Nhà tù, then the player page (`#player/<id>`): every player name in React already
   links there (`components/dino/Identity.tsx` PlayerLink), and until that page exists the address
   falls back to Tổng quan.
3. **Vật phẩm**: Skin dino (3D viewer `/skin3d.js`, `portal/public/skin-editor.js`), Mutation,
   Phiếu & hộp.
4. **Nhiệm vụ** (Hổ phách, điểm danh, nhiệm vụ, cửa hàng), **Truy cập** (traffic), **Tổng quan**
   (overview, live), **Bản đồ** (live map).
5. When every block is in React: `/` serves the React build, the old `index.html` goes.

A list page redraws every 2 s but never while the admin is busy (popup open, typing, dialog,
text selected: the old panel's `busyUI`); see how Gara → Dino and Nhật ký admin do it.

## Shared pieces

- `@isle/ui` (`web/packages/ui/src/index.ts`): Button, Card, Checkbox / CheckGrid, Dialog, Field,
  GroupLabel, Hint / Mono, Icon, NumberInput, PageHead, Select, SectionTitle, Slider, SuggestInput,
  SubTabs, Switch, Table, TextArea, TextInput, Toast. Never the browser's own controls.
- `useSettingsForm<R, T = R>(url, { label, href, select?, toBody?, saved? })`
  (`features/settings-form/useSettingsForm.ts`): R is the GET's answer, T what the form edits;
  `select` picks T out of R (a status or catalog beside the settings), `latest` is the last GET
  whole (live numbers, status lines), `toBody` turns the draft into the PUT's body, `saved` is the
  toast after a save (a text, or a function of the PUT's answer). After a save the GET is read
  again. Comparison ignores key order. Edits survive leaving the page (unsaved bar). `form.base` is
  what the draft was loaded from; `form.save({ extra, saved })` sends more with the body and
  another toast (Lưu & khởi động lại).
- `@isle/ui` **FileInput** (a file chooser in the panel's colours) and **Table** (`cards`: rows
  become cards on a phone, cells named by `data-label`; or the plain `components/table/Table.module.css`).
- `@isle/ui` **DateTimeInput** (`kind` time / date / datetime, the native input's value text): the
  React twin of `ui-inputs.js`'s date / time picker.
- `test/fakeBridge.tsx`: `fakeBridge(url, get, put)` for a settings page, `fakeApi({ 'GET /api/x': …,
  'POST /api/y': (body) => … })` for a page of many routes (with the confirm dialog).
- `node web/scripts/shots.mjs` also shoots a running local bridge (`PANEL_URL` + `PANEL_COOKIE`).
- `components/list/List.tsx`: `ListTools` (search + filters), `Seg`, `SortTh`, `Pager` ("Hiển thị a-b /
  n … · trang x/y"), `pageOf`, `Pill`, and `List.module.css` `.table` (the old `.table-wrap table`:
  numbers right, first column left), `.rowLink`, `.notice`, `.hideSm`.
- `components/feed/`: `Feed` (the game's log as columns, every event type of the old `describe()`),
  `KillScene` (a death's 📍: map, people within 200 m, the fight). `lib/map.ts`: the island map
  (gateway.json + image) and its projection, for the scene now and Bản đồ later.
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
   (`BP_Tyrannosaurus_C`): a flow that needs more data, add it to `local-bridge.sh`.
3. Screenshots at 380 and 1366 px, light and dark: `node web/scripts/shots.mjs <out> <tab/sub>...`
   (answers `/api/*` from `web/scripts/shots-fixtures.mjs`), compared with the old page.
