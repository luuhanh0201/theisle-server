# The Isle Evrima server — agent guide

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
  (e.g. Antigravity) still never run deploy, git or ssh — they propose them.
- Before writing Lua that calls game functions, read `docs/lua-safety-rules.md`.

## Lua mod rules (summary — full list in docs/lua-safety-rules.md)
- Hooks only queue work; engine work runs on the game thread via H.defer /
  H.onGameThread (ExecuteInGameThread), never directly in ExecuteWithDelay or
  LoopAsync callbacks (those are the async thread).
- Never cache controller/pawn across ticks; store SteamID, re-resolve via GetControllerBySteamId.
- Always check pawn:GetAddress() ~= 0 before use.
- Never call RequestRespawn / UpdateChat / UTISaveManager functions (crash).
- FName fields: write FName("x"), never a Lua string.
- Re-apply vitals after any SetGrowth.

## UI (panel, portal, launcher pages)
- Never the browser's own select box, number spinner or date / time picker:
  every page loads the shared controls, before its own code —
  `<script src="/ui-select.js"></script>` and `<script src="/ui-inputs.js"></script>`
  (files in `portal/public/`; the bridge serves them to the panel). They
  turn every `<select>`, `input[type=number|date|time|datetime-local]` into
  the system's own (the native element stays hidden as the value). Write
  plain `<select>` / `<input>`; never a one-off dropdown or picker.
  `data-plain` opts one element out (only with a reason in a comment).
- CSS around them: the number box is `span.nf` (a `> input` selector no longer
  matches), the date box `button.dt-btn`, the select `button.cs-btn`.
- The skin colour editor is shared too (`portal/public/skin-editor.js`).
- Mutation icons: `<img data-mut-icon="Name">` (filled by `portal/public/mut-icons.js`
  from one bundle); never one `<img src=".../<slug>.svg">` each — many at once
  trip the proxy (503). After adding an icon: `node scripts/build-mutation-icons.mjs`.

## Launcher
- Inside Xóm Gáy Launcher (`window.isleLauncher`, `html.in-launcher`) nothing about
  downloading the launcher shows: no download page, link, button, badge or promo.
  Every such element carries class `web-only` (hidden in the launcher); `/tai.html`
  opened there goes back home (`tai.js`). A new download link without `web-only`
  is a bug.

## Test server
- `scripts/test-server.sh` (on the VPS: /home/isle/bin/test-server.sh, run as
  `isle`): a copy of the live server at /home/isle/test, ports 7787 / 10001 / 8889.
- The test server is always opened WITHOUT a password (bServerPassword=false).
- Labs (SpeciesLab, StatLab…) are enabled only in the test copy's mods.txt.

## Every fix or new feature: check the old flows still work
Before calling a fix or a feature done:
1. List every caller of what you changed (grep the function, field, event,
   file name, API route, log line or setting) across mods/, bridge/, portal/,
   launcher/ — not only the file you edited.
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
  Binaries/Win64 — no ue4ss/ subfolder. Stable v3.0.1 fails its scan
  ("PS scan timed out") and loads no mods.
- Wine: WineHQ stable 11.0 on the VPS (no `wine64` command; start.sh uses `wine`).