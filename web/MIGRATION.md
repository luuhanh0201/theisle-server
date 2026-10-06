# Moving the panel to React: where it stands

The progress log of the move (AGENTS.md "Panel in React"). A new session reads this first,
picks the next step below, and updates this file in the same commit as the pages it moves.

## Done

| Block | Sub-page | React file | Bridge route | Moved |
|---|---|---|---|---|
| Tính năng mod | Lệnh chat | `features/mods/commands/CommandsSettings.tsx` | `/api/commands-settings` | 2026-10-06 |
| Tính năng mod | Ptera gắp | `features/mods/ptera/PteraSettings.tsx` | `/api/ptera-carry` | phase 1 |
| Tính năng mod | Tele con non | `features/mods/tele/TeleSettings.tsx` | `/api/tele-settings` | phase 1 |
| Tính năng mod | Voice gần | `features/mods/voice/VoiceSettings.tsx` | `/api/voice-settings` | 2026-10-06 |
| Tính năng mod | Thông báo | `features/mods/messages/MessagesSettings.tsx` | `/api/messages` | 2026-10-06 |
| Thế giới | Thực vật | `features/world/flora/FloraSettings.tsx` | `/api/flora-settings` | 2026-10-06 |
| Thế giới | Cá | `features/world/fish/FishSettings.tsx` | `/api/fish-settings` | 2026-10-06 |
| Gara | Cài đặt gara | `features/garage/settings/GarageSettings.tsx` | `/api/garage-settings` | 2026-10-06 |

Which pages a block has in React: `pages/<tab>/index.ts`, all listed in `app/blocks.ts`. The frame
of every block (heading, sub-tabs, a `LegacyPage` link for a page not moved) is `app/Block.tsx`, so
moving a page = its feature folder + one line in `pages/<tab>/index.ts` (+ `app/blocks.ts` for a
new block). The whole **Tính năng mod** block is in React.
Its old pages in `bridge/public/index.html` stay: the panel at `/` is still the one admins use,
until every block is moved and `/` switches to the React build.

## Next steps (in this order)

1. ~~Thế giới → Thực vật, Cá~~ done. Thế giới → Tổng quan is a live page: step 4.
2. ~~Gara → Cài đặt gara~~ done.
3. **Quản trị → Truy cập panel, Discord**, **Thành viên → SVip / Phân quyền**, **Server → Cấu hình
   game**: settings pages too (see FORM_PAGES in `bridge/public/index.html` for each GET and what
   it leaves out of the comparison).
4. **List pages** (Người chơi, Ban, Nhà tù, Gara → Dino, Vật phẩm…): first build the shared list
   refresh in React (redraw every 2 s, paused while the admin is busy: a popup open, typing, a
   dialog, text selected; the old panel's `busyUI`), then move them block by block.
5. When every block is in React: `/` serves the React build, the old `index.html` goes.

## Shared pieces added along the way

- `@isle/ui`: Button, Card, Dialog, Field, Hint / Mono, Icon, NumberInput, PageHead, SectionTitle,
  **Select** (the system select, keys: arrows / Enter / Esc), SubTabs, Switch, **TextArea** (grows
  with its text), TextInput, Toast.
- `@isle/ui` **Checkbox / CheckGrid**: tick boxes of a set (fish species), tiles like `.check-grid`.
- `useSettingsForm<T, R>(url, { label, href, select?, fromSave?, onSaved? })`: `select` picks the
  editable part when the GET carries more (status, catalog); `raw` is the whole GET; `fromSave`
  reads the PUT's answer when it has another shape (default `select`); `onSaved(answer)` for a
  toast; `update(fn)` edits nested parts (a list item, one text). Comparison ignores key order.
  After a save the GET is fetched again (no "Có thay đổi mới" for 15 s: it is the admin's own).
- Tests of a page: `apps/panel/src/test/fakeBridge.tsx` fakes `/api/me` and one route.

## How each move is checked

`cd web && npm test && npm run build`, then screenshots at 380 and 1366 px, light and dark,
without the live bridge: `node web/scripts/shots.mjs <out dir> world/fish mods/messages ...`
(serves `bridge/public`, answers `/api/*` from `web/scripts/shots-fixtures.mjs`: add the GET
routes of each page you move there; prints `SIDEWAYS SCROLL` when a page scrolls sideways).
