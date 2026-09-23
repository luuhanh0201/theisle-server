# theisle-server

Config, mods and operations tooling for a **The Isle: Evrima** dedicated server
running on a Linux VPS under Wine, with UE4SS + Lua mods.

This repo is the source of truth. The VPS is a deploy target — anything edited
directly on the server is overwritten on the next deploy.

**Cài đặt từ đầu (tiếng Việt):** [docs/HUONG-DAN-CAI-DAT.md](docs/HUONG-DAN-CAI-DAT.md)
— từ VPS Ubuntu trống, SteamCMD, tới server + mod + admin panel.

## Layout

```
docs/      how the stack works, VPS paths, Lua safety rules, deploy, garage
config/    Game.ini / Engine.ini / GameUserSettings.ini (templated)
ue4ss/     UE4SS settings + the list of enabled mods
mods/      Lua mods (_shared holds common helpers)
bridge/    Node service: tails the event stream, serves the admin panel
scripts/   start / deploy / logs / install
```

## How the pieces talk

UE4SS Lua has no usable sockets, so the game side and the web side share files:

```
mods/StatsLogger  ──►  Saved/events.ndjson  ──►  bridge  ──►  web panel
```

Append-only NDJSON, polled once a second. Either side can crash and restart
without losing events — the file is the handoff.

## Setup (local)

```bash
cp .env.example .env
$EDITOR .env          # fill in RCON_PASSWORD, ADMIN_STEAM_IDS, DEPLOY_HOST, ...
```

`.env` is gitignored and must never be committed.

## Deploy

```bash
./scripts/deploy.sh            # render templates, sync, restart
./scripts/deploy.sh --dry-run  # show what would change, touch nothing
./scripts/deploy.sh --no-restart
```

A deploy restarts the game server, which disconnects every player. Announce it
first. Full flow, including verification, is in `docs/deploy.md`.

## Rollback

```bash
git revert <commit>      # or: git checkout <last-good-tag>
./scripts/deploy.sh
```

Each deploy keeps a timestamped backup of the previous config on the VPS — see
`docs/deploy.md` for the exact path and how to restore it.

## Features

| | Where | Notes |
|---|---|---|
| Park / retrieve a dino | `mods/DinoGarage` | `!store`, `!redeem`, `!garage` — see `docs/garage.md` |
| Put a dino into a garage | panel / `POST /api/garage/...` | needs `ADMIN_TOKEN` |
| Damage and kill log | `mods/StatsLogger` | only player-on-player direct hits are visible to Lua |
| kick / ban / unban | not here | already in the server's own admin panel |

## Admin panel

Just to look at it, with generated data and no game server:

```bash
./bridge/demo.sh                 # http://127.0.0.1:8080
PORT=8181 ./bridge/demo.sh       # if 8080 is taken
```

It generates a live event stream and two stored dinos into a temp directory,
removed on exit. The admin token is `demo-token`.

Against the real server:

```bash
cd bridge && npm install && npm run build && npm start
```

It binds to localhost. **Put it behind a reverse proxy with authentication** —
it serves player data, chat and live positions, and has no auth of its own.

Tabs: overview (players + filterable event feed), killfeed, leaderboards
(kills, K/D, damage, playtime, longest life, largest prey per species), live
map (raw game coordinates, no map image yet), chat, garage. Click any player
for their full stats and personal log.

What StatsLogger records, in `events.ndjson`: session start/end, spawn, death
(killer, species, growth, position, life length, last hit), damage (both sides,
species, position), chat, growth milestones, and growth jumps too fast to be
natural (redeem, admin, or cheat). `snapshots.ndjson` holds vitals and position
for every online player every 5 s.

What the panel can and cannot show is a property of the game, not of this code:
only player-on-player direct attacks produce a damage event, and deaths are
inferred from a 5-second vitals poll. See `docs/reference/EVRIMA_KillFeed_Design.md`.

## Tests

```bash
./tests/run.sh          # syntax + functional tests, no game needed
cd bridge && npm test   # typecheck + store tests
```

`tests/` runs the mods against a mock UE4SS (`tests/harness.lua`). It drives a
full store/redeem cycle and asserts the restore order, so a reordering that
would silently reset a player's vitals fails here instead of on the server.
`deploy.sh` runs it before syncing.

## Day-to-day

```bash
./scripts/logs.sh            # tail UE4SS.log and TheIsle.log
./scripts/logs.sh ue4ss      # just UE4SS.log
./scripts/start.sh           # start the server (run on the VPS)
```

## Fresh VPS

`scripts/install.sh` provisions a brand-new machine (Wine, SteamCMD, the game
server, UE4SS, the systemd unit). It is intended to run **once**. Read
`docs/architecture.md` first.

## Working with AI agents

`AGENTS.md` holds the operating rules; `CLAUDE.md` just imports it. Keep both in
sync with reality — an agent that trusts a stale path will break the server.

## Attribution

`docs/reference/` contains documents from the **evrima-dev-knowledge** project,
redistributed under **CC BY 4.0**. See `docs/reference/README.md`.
