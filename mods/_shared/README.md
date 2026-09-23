# _shared

Common Lua helpers used by every mod. **Not a mod** — it is never listed in
`ue4ss/mods.txt` and has no `Scripts/main.lua`.

UE4SS already has `Mods/shared/` on its Lua `package.path`, but **it owns that
directory** — it ships `Types.lua` and `UEHelpers/UEHelpers.lua` there, and
`BPModLoaderMod` depends on them. So `deploy.sh` copies this directory to
`$BIN_DIR/ue4ss/Mods/shared/isle/` and syncs it **without `--delete`**.

It is `_shared/` in the repo (sorts first, the underscore marks it as "not a
mod") and required as `shared.isle`:

```lua
local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")
```

UE4SS's own helpers stay available alongside ours:

```lua
local UEHelpers = require("UEHelpers")   -- GetWorld, GetPlayerController, ...
```

Prefer `UEHelpers` for anything it already covers; wrap it in our guards rather
than reimplementing it.

Rules:

- Anything that touches the engine and is needed by more than one mod belongs
  here, wrapped and guarded once.
- Helpers must never raise. They return `nil`/`false` on failure and log.
- Changing a helper affects every mod — re-read `docs/lua-safety-rules.md` and
  redeploy all mods together.

| File | Contents |
|---|---|
| `helpers.lua` | object validation, player lookup, safe notify, logging, deferral |
| `json.lua` | minimal JSON encode/decode for persisted state |
