# The Isle Evrima server — agent guide

## What this repo is
Config + UE4SS Lua mods for a The Isle Evrima dedicated server.
Server = Windows build running under Wine on Ubuntu VPS, UE4SS experimental.
Game binaries are NOT in this repo (installed via SteamCMD).

## Hard rules
- Never touch or delete anything under `**/Saved/` (player data).
- Never write real secrets; use placeholders in `config/*.template`, values live in VPS `.env`.
- Never run deploy, git, or ssh commands — propose them, the user runs them.
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