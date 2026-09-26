-- AIZones — AI that lives in admin-drawn zones.
--
-- The game spawns its own AI around players (Game.ini AIDensity…); it has no
-- zones. This mod adds them. Each zone (drawn on the admin panel) has its
-- species, a growth range and two limits:
--   * `min`: always there. Whenever the zone has fewer (eaten, killed,
--     wandered off), it is topped up within seconds, player or not.
--   * `max`: once a player is inside, every `every` seconds a random
--     perTurnMin..perTurnMax (1–5) more appear, each at a different spot,
--     until the zone holds `max`.
-- New AI keep `spacing` away from every living AI (the game's too), so a
-- zone stays spread out; with no such spot left it stays below its numbers.
-- Admins can also drop a few AI next to a chosen player, and reset (kill,
-- never destroy) the AI (see Drops and Reset below).
--
-- A zone is a circle, or any outline (an ellipse or a polygon the admin drew,
-- sent as `poly`): who is inside and what counts go by that outline.
--
-- The bridge writes Mods/AIZones/Saved/zones.json: the zones, each species'
-- pawn + AI controller class (pairs verified live by the evrima-dev-knowledge
-- AI Spawn Pair catalog, MIT/CC BY 4.0), and spawn POINTS — places a player
-- or an AI really stood inside the zone, so nothing is spawned under the
-- landscape or at a guessed height. This mod writes status.json back.
--
-- Safety (docs/lua-safety-rules.md + the upstream AI spawn notes):
--   * engine work only on the game thread (H.every); file I/O on the async one
--   * every engine call in pcall; a spawned pawn is checked (GetAddress ~= 0)
--   * replication on (SetReplicates + ForceNetUpdate), NEVER bAlwaysRelevant
--     (a herd in every client's load-in burst crashes clients)
--   * nothing is ever destroyed from Lua (destroying what the game already
--     removed crashes the server): "max" means "stop adding", not "remove"
--   * a server-wide cap on ALL living AI (the game's own and the zones'):
--     at the cap nothing is added, so players have to hunt some down first
--     (corpses do not count); plus a few per zone per turn
--   * spawned pawns are remembered by address only, to count them — never
--     called again after the turn they were made in

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local MOD         = "AIZones"
local ZONES_PATH  = "Mods/AIZones/Saved/zones.json"
local STATUS_PATH = "Mods/AIZones/Saved/status.json"
local TICK_MS     = 5000     -- game-thread turn
local READ_MS     = 10000    -- re-read zones.json (async thread)
local HARD_MAX    = 200      -- whatever the panel says, never more of OUR AI alive than this
local PER_TURN    = 5        -- …never more than this many per zone per turn
local TOPUP       = 5        -- …per zone per tick when below `min`
local TICK_BUDGET = 10       -- …nor more than this many spawns in one tick, all zones
local TRIES       = 3        -- spawn points tried per AI before giving up this turn
local KEEP_OFF_CM = 4000     -- spots this close to a player are used last (no AI popping in your face)
local RETRY_S     = 30       -- a zone whose top-up made nothing waits this long

-- Pawns are spawned through GameplayStatics' deferred spawn with
-- AdjustIfPossibleButAlwaysSpawn, not world:SpawnActor: that one keeps the
-- class default (no spawn if colliding), and the first spawn the game refused
-- for collision crashed the server inside UE4SS.dll (2026-09-26 19:16:51, a
-- goat; pcall cannot catch it). Flag first: the flag is written before the
-- deferred spawn of a run (until one worked) and removed when the call returns,
-- so a crash in it leaves the flag and the next run goes back to world:SpawnActor.
local STATICS_PATH  = "/Script/Engine.Default__GameplayStatics"
local ALWAYS_SPAWN  = 2      -- ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn
local SCALE_MULTIPLY = 1     -- ESpawnActorScaleMethod::MultiplyWithRoot (the Blueprint default)
local DEFERRED_FLAG = "Mods/AIZones/Saved/deferred-spawn.trying"

local config = nil           -- the decoded zones.json (plain Lua data)
local status = nil           -- built on the game thread, written by the async loop
local nextAt = {}            -- zone id -> os.time() of its next turn (while occupied)
local retryAt = {}           -- zone id -> os.time() before which a failed top-up is not retried
local ours = {}              -- address -> true: AI this mod spawned, still seen alive
local zoneStats = {}         -- zone id -> { spawned, failed, lastSpawn, lastError }
local lastScan = 0           -- os.time() of the last AI scan
local SCAN_EVERY_S = 10      -- the AI are counted this often (a zone's turn counts them too)

--------------------------------------------------------------------------
-- Files (async thread only: no engine objects here)
--------------------------------------------------------------------------

local function readConfig()
    local f = io.open(ZONES_PATH, "r")
    if not f then config = nil; return end
    local raw = f:read("*a")
    f:close()
    local ok, data = pcall(json.decode, raw)
    if not ok or type(data) ~= "table" then
        H.logError(MOD .. ": zones.json is not valid JSON — keeping the previous zones")
        return
    end
    config = data
end

local function writeStatus()
    if status == nil then return end
    local ok, text = pcall(json.encode, status)
    if not ok then return end
    local tmp = STATUS_PATH .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then return end
    f:write(text)
    f:close()
    -- Windows (the server runs under Wine) does not rename over an existing file.
    os.remove(STATUS_PATH)
    os.rename(tmp, STATUS_PATH)
end

--------------------------------------------------------------------------
-- Reading the world (game thread)
--------------------------------------------------------------------------

local function addressOf(obj)
    local ok, addr = pcall(function() return obj:GetAddress() end)
    if ok and type(addr) == "number" and addr ~= 0 then return addr end
    return nil
end

local function locationOf(pawn)
    local ok, v = pcall(function() return pawn:K2_GetActorLocation() end)
    if ok and v and type(v.X) == "number" then return { x = v.X, y = v.Y, z = v.Z } end
    return nil
end

local function classNameOf(pawn)
    local ok, name = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    if not ok or name == nil then return nil end
    -- "BlueprintGeneratedClass /Game/…/BP_Boar.BP_Boar_C" or "BP_Boar_C": the last part.
    return tostring(name):match("([%w_]+)$")
end

--- Every AI pawn (nobody plays it) that is alive: { cls, x, y, addr }.
local function scanAi(playerAddrs)
    local ok, pawns = pcall(function() return FindAllOf("Pawn") or {} end)
    if not ok then return nil end
    local list = {}
    for _, pawn in ipairs(pawns) do
        if H.isValid(pawn) then
            local addr = addressOf(pawn)
            if addr and not playerAddrs[addr] then
                local okH, hp = pcall(function() return pawn:GetHealth() end)
                if not (okH and type(hp) == "number" and hp <= 0) then
                    local loc = locationOf(pawn)
                    if loc then list[#list + 1] = { cls = classNameOf(pawn), x = loc.x, y = loc.y, addr = addr } end
                end
            end
        end
    end
    return list
end

local function near(a, x, y, dist)
    local dx, dy = a.x - x, a.y - y
    return dx * dx + dy * dy <= dist * dist
end

--- Inside a zone: within its `radius` (for a circle, the zone; for an ellipse
--- or a polygon, the circle around it) and, when it has one, its outline
--- `poly` ({ {x, y}, … } — the bridge turns an ellipse into one).
local function inZone(z, radius, pt)
    if not near(pt, z.x, z.y, radius) then return false end
    local poly = z.poly
    if type(poly) ~= "table" or #poly < 3 then return true end
    local inside, j = false, #poly
    for i = 1, #poly do
        local xi, yi, xj, yj = poly[i][1], poly[i][2], poly[j][1], poly[j][2]
        if (yi > pt.y) ~= (yj > pt.y) and pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi then inside = not inside end
        j = i
    end
    return inside
end

--------------------------------------------------------------------------
-- Spawning (game thread)
--------------------------------------------------------------------------

local function findClass(path)
    if type(path) ~= "string" or path == "" then return nil end
    local ok, cls = pcall(function() return StaticFindObject(path) end)
    if ok and cls ~= nil and H.isValid(cls) then return cls end
    return nil
end

local function num(v, lo, hi, default)
    local n = tonumber(v)
    if n == nil then return default end
    return math.max(lo, math.min(hi, n))
end

--- The zone's points in a random order, spots near a player last: each AI of
--- a turn takes the next one, so no two land on the same spot. With a
--- `spacing` (cm), a spot closer than that to a living AI (`ai`) or to one
--- taken this turn is skipped, and when none is left there is no spot: the
--- zone stays thinner rather than crowded.
local function spotsFor(zone, players, ai, spacing)
    local far, close = {}, {}
    for _, pt in ipairs(zone.points) do
        local isClose = false
        for _, p in ipairs(players) do
            if near(p, pt[1], pt[2], KEEP_OFF_CM) then isClose = true; break end
        end
        local list = isClose and close or far
        list[#list + 1] = pt
    end
    for _, list in ipairs({ far, close }) do
        for i = #list, 2, -1 do
            local j = math.random(i)
            list[i], list[j] = list[j], list[i]
        end
    end
    for _, pt in ipairs(close) do far[#far + 1] = pt end
    local i = 0
    if spacing <= 0 then
        return function()
            i = i + 1
            return far[(i - 1) % #far + 1]    -- more AI than spots: round again
        end
    end
    local taken = {}
    for _, a in ipairs(ai or {}) do taken[#taken + 1] = { x = a.x, y = a.y } end
    return function()
        while i < #far do
            i = i + 1
            local pt, free = far[i], true
            for _, t in ipairs(taken) do
                if near(t, pt[1], pt[2], spacing) then free = false; break end
            end
            if free then
                taken[#taken + 1] = { x = pt[1], y = pt[2] }
                return pt
            end
        end
        return nil
    end
end

--- One AI of `sp` at the next free spot. Returns true, or false + why.
-- Deferred spawning: nil = not tried yet this run, true = worked, false =
-- off (the flag was left by a crash, or the calls failed).
local deferred = nil
do
    local f = io.open(DEFERRED_FLAG, "r")
    if f then
        f:close()
        deferred = false
        H.logError(MOD .. ": the last run stopped during a deferred spawn — back to world:SpawnActor. Delete " .. DEFERRED_FLAG .. " to try again.")
    end
end

--- The pawn, spawned even where it collides (moved aside when it can), or
-- nil. A second value "broken" when the calls themselves failed.
local function spawnDeferred(world, cls, loc, rot)
    local statics = findClass(STATICS_PATH)
    if statics == nil then return nil, "GameplayStatics not found" end
    local half = math.rad(rot.Yaw) / 2
    local xf = { Rotation = { X = 0, Y = 0, Z = math.sin(half), W = math.cos(half) },
                 Translation = { X = loc.X, Y = loc.Y, Z = loc.Z },
                 Scale3D = { X = 1, Y = 1, Z = 1 } }
    local ok, actor = pcall(function()
        return statics:BeginDeferredActorSpawnFromClass(world, cls, xf, ALWAYS_SPAWN, nil, SCALE_MULTIPLY)
    end)
    if not ok then return nil, "BeginDeferredActorSpawnFromClass: " .. tostring(actor) end
    if actor == nil or addressOf(actor) == nil then return nil end
    local okF, err = pcall(function() statics:FinishSpawningActor(actor, xf, SCALE_MULTIPLY) end)
    if not okF then return nil, "FinishSpawningActor: " .. tostring(err) end
    return actor
end

local function spawnPawn(world, cls, loc, rot)
    if deferred == false then
        local ok, pawn = pcall(function() return world:SpawnActor(cls, loc, rot) end)
        return ok and pawn or nil
    end
    local first = deferred == nil
    if first then
        local f = io.open(DEFERRED_FLAG, "w")
        if f then f:write(tostring(os.time())); f:close() end
    end
    local pawn, broken = spawnDeferred(world, cls, loc, rot)
    if first then os.remove(DEFERRED_FLAG) end
    if broken then
        deferred = false
        H.logError(MOD .. ": deferred spawn failed, back to world:SpawnActor — " .. broken)
        return nil
    end
    if pawn ~= nil and deferred == nil then
        deferred = true
        H.log(MOD .. ": deferred spawn works (always spawns, moved aside if colliding)")
    end
    return pawn
end

local function spawnOne(world, zone, sp, nextSpot)
    local pawnCls = findClass(sp.pawn)
    local ctrlCls = findClass(sp.ctrl)
    if pawnCls == nil or ctrlCls == nil then
        return false, "class not found: " .. tostring(pawnCls == nil and sp.pawn or sp.ctrl)
    end
    for _ = 1, TRIES do
        local pt = nextSpot()
        if pt == nil then return false, "no spot left far enough from other AI", true end
        local loc = { X = pt[1], Y = pt[2], Z = pt[3] + num(sp.lift, 0, 1000, 150) }
        local rot = { Pitch = 0, Yaw = math.random(0, 359), Roll = 0 }
        local pawn = spawnPawn(world, pawnCls, loc, rot)
        -- Nothing made (an empty wrapper): try another point.
        if pawn ~= nil and addressOf(pawn) ~= nil then
            local okC, ctrl = pcall(function() return world:SpawnActor(ctrlCls, loc, rot) end)
            if not (okC and ctrl ~= nil and addressOf(ctrl) ~= nil) then
                -- The pawn exists but has no brain; it cannot be removed (rule 6).
                return false, "controller did not spawn (" .. tostring(sp.key) .. ")"
            end
            pcall(function() ctrl:Possess(pawn) end)
            -- Clients see it by distance, like any other AI. Not bAlwaysRelevant.
            pcall(function() pawn:SetReplicates(true) end)
            pcall(function() pawn:ForceNetUpdate() end)
            if sp.kind == "dino" then
                -- Spawned as a hatchling. Growth after Possess, then vitals
                -- (SetGrowth resets them).
                local gMin = num(zone.growthMin, 0.1, 1, 1)
                local gMax = num(zone.growthMax, gMin, 1, gMin)
                local g = gMin + (gMax - gMin) * math.random()
                pcall(function() pawn:SetGrowth(g) end)
                for _, v in ipairs({ "Health", "Stamina", "Hunger", "Thirst" }) do
                    pcall(function() pawn["Set" .. v](pawn, pawn["GetMax" .. v](pawn)) end)
                end
            end
            ours[addressOf(pawn)] = true
            return true
        end
    end
    return false, "no free spot after " .. TRIES .. " tries (" .. tostring(sp.key) .. ")"
end

--------------------------------------------------------------------------
-- The turn
--------------------------------------------------------------------------

local function tick()
    local cfg = config
    local now = os.time()
    local zones = (cfg and type(cfg.zones) == "table") and cfg.zones or {}
    local st = { t = now, enabled = cfg ~= nil and cfg.enabled == true, alive = 0, zones = {} }

    -- Players: where they are, and one pawn to reach the world from (with
    -- nobody online, the game state's world).
    -- Species that do not make a zone "occupied" (cfg.ignoreOccupants, e.g. a
    -- Deinosuchus in a lake must not fill a land zone); they still count as
    -- players for keeping new AI away from them.
    local ignore = {}
    for _, c in ipairs((cfg and type(cfg.ignoreOccupants) == "table") and cfg.ignoreOccupants or {}) do ignore[tostring(c)] = true end
    local players, playerAddrs, world = {}, {}, nil
    H.forEachPlayer(function(ctrl)
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local addr = addressOf(pawn)
        if addr then playerAddrs[addr] = true end
        local loc = locationOf(pawn)
        if loc then
            if next(ignore) ~= nil and ignore[classNameOf(pawn) or ""] then loc.passive = true end
            players[#players + 1] = loc
        end
        if world == nil then
            local okW, w = pcall(function() return pawn:GetWorld() end)
            if okW and w ~= nil and H.isValid(w) then world = w end
        end
    end)
    if world == nil and st.enabled then
        local okW, w = pcall(function()
            local gs = FindFirstOf("TIGameStateBase")
            if gs == nil or not H.isValid(gs) then return nil end
            return gs:GetWorld()
        end)
        if okW and w ~= nil and H.isValid(w) then world = w end
    end

    -- The zones that can spawn: on, with points and species; occupied when a
    -- player is inside.
    local active = {}
    for _, z in ipairs(zones) do
        local zs = { occupied = false, count = nil }
        st.zones[tostring(z.id)] = zs
        local x, y = tonumber(z.x), tonumber(z.y)
        if st.enabled and z.enabled == true and x and y and type(z.points) == "table" and #z.points > 0
                and type(z.species) == "table" and #z.species > 0 then
            local radius = num(z.radius, 1000, 2000000, 20000)
            for _, p in ipairs(players) do
                -- A water zone (z.water) is filled by anyone, the ignored species too (a crocodile at a lake).
                if (z.water == true or not p.passive) and inZone(z, radius, p) then zs.occupied = true; break end
            end
            active[#active + 1] = z
        end
    end

    -- One scan of the AI serves every zone: every SCAN_EVERY_S (to keep each
    -- zone at its minimum), and whenever an occupied zone's turn is due. A
    -- FindAllOf of every pawn is not free, so not every tick.
    local turnDue = false
    for _, z in ipairs(active) do
        if st.zones[tostring(z.id)].occupied and now >= (nextAt[z.id] or 0) then turnDue = true end
    end
    local ai = nil
    if #active > 0 and (turnDue or now - lastScan >= SCAN_EVERY_S) then
        ai = scanAi(playerAddrs)
        lastScan = now
        if ai then
            local seen = {}
            for _, a in ipairs(ai) do seen[a.addr] = true end
            for addr in pairs(ours) do if not seen[addr] then ours[addr] = nil end end
        end
    end
    local alive = 0
    for _ in pairs(ours) do alive = alive + 1 end
    -- Every living AI on the server counts against the cap, whoever made it.
    local total = ai and #ai or 0
    local cap = math.floor(num(cfg and cfg.globalMax, 0, 5000, 150))
    local budget = TICK_BUDGET

    for _, z in ipairs(ai and active or {}) do
        local zs = st.zones[tostring(z.id)]
        local stats = zoneStats[z.id] or { spawned = 0, failed = 0 }
        zoneStats[z.id] = stats
        -- What is in the zone now: its species, whoever spawned them.
        local classes = {}
        for _, sp in ipairs(z.species) do if sp.cls then classes[sp.cls] = true end end
        local radius = num(z.radius, 1000, 2000000, 20000)
        local count = 0
        for _, a in ipairs(ai) do
            if a.cls and classes[a.cls] and inZone(z, radius, a) then count = count + 1 end
        end
        local max = math.floor(num(z.max, 0, 500, 5))
        -- `idleMax`: the name of `min` in files written before it was renamed.
        local min = math.min(max, math.floor(num(z.min or z.idleMax, 0, 500, 0)))

        -- Below the minimum: top it up now, player or not.
        local want, why = 0, "min"
        if count < min and now >= (retryAt[z.id] or 0) then want = math.min(min - count, TOPUP) end
        -- A player inside and the turn due: a random 1–5 (as set) more, up to max.
        if zs.occupied and now >= (nextAt[z.id] or 0) then
            nextAt[z.id] = now + math.floor(num(z.every, 10, 3600, 60))
            local lo = math.floor(num(z.perTurnMin or z.perTurn, 1, PER_TURN, 1))
            local hi = math.floor(num(z.perTurnMax or z.perTurn, lo, PER_TURN, lo))
            local n = math.random(lo, hi)
            if n > want then want, why = n, "turn" end
        end
        local room = math.min(want, max - count, cap - total, HARD_MAX - alive, budget)
        if room > 0 and world == nil then
            stats.lastError = "no world to spawn in"
            room = 0
        end
        local made = {}
        local nextSpot = room > 0 and spotsFor(z, players, ai, num(z.spacing, 0, 30000, 0)) or nil
        for _ = 1, room do
            local sp = z.species[math.random(#z.species)]
            local ok, err, noSpot = spawnOne(world, z, sp, nextSpot)
            if noSpot then
                -- Spacing leaves no room: thinner than asked, not crowded. Not a failure.
                stats.lastError = err
                break
            elseif ok then
                count, alive, total = count + 1, alive + 1, total + 1
                stats.spawned = stats.spawned + 1
                stats.lastSpawn = now
                made[#made + 1] = tostring(sp.key)
            else
                stats.failed = stats.failed + 1
                stats.lastError = err
                H.logError(MOD .. ": zone '" .. tostring(z.name) .. "': " .. tostring(err))
            end
        end
        budget = budget - #made
        -- A top-up that made nothing (no class, no free spot) is not retried every tick.
        if room > 0 and #made == 0 then retryAt[z.id] = now + RETRY_S end
        if #made > 0 then
            H.log(string.format("%s: zone '%s' +%d (%s, %s) — %d in the zone (min %d, max %d, %s), %d/%d AI on the server",
                MOD, tostring(z.name), #made, table.concat(made, ", "), why == "min" and "keeping the minimum" or "a turn",
                count, min, max, zs.occupied and "a player is in it" or "empty", total, cap))
        end
        zs.count, zs.min, zs.max = count, min, max
        zs.limit = zs.occupied and max or min
        if zs.occupied then zs.nextTurn = math.max(0, (nextAt[z.id] or now) - now) end
    end

    -- Between scans: the last counts, so the panel does not flicker to "?".
    if ai == nil and status and status.zones then
        for _, z in ipairs(active) do
            local zs, prev = st.zones[tostring(z.id)], status.zones[tostring(z.id)]
            if prev then zs.count, zs.min, zs.max, zs.limit = prev.count, prev.min, prev.max, prev.limit end
        end
    end

    for id, stats in pairs(zoneStats) do
        local zs = st.zones[tostring(id)]
        if zs then
            zs.spawned, zs.failed, zs.lastSpawn, zs.lastError = stats.spawned, stats.failed, stats.lastSpawn, stats.lastError
        end
    end
    st.alive, st.cap = alive, cap
    if ai then st.total = total elseif status then st.total = status.total end
    status = st
end

--------------------------------------------------------------------------
-- Drops: "put N of this AI next to that player" from the admin panel
--------------------------------------------------------------------------
-- The bridge (bridge/src/ai-drop.ts) writes drops.json with the spots it
-- picked from the ground points around the player; this runs each id once
-- (the last id is kept in drops.done.json, written BEFORE acting, so a crash
-- or a restart never replays a drop) and writes the outcome back. A drop is
-- an admin's explicit act: it does not wait for the zones' server-wide cap,
-- only HARD_MAX. Game thread (H.every), like DinoGarage's inbox.

local DROPS_PATH   = "Mods/AIZones/Saved/drops.json"
local DONE_PATH    = "Mods/AIZones/Saved/drops.done.json"
local DROP_MS      = 2000
local DROP_NEAR_CM = 1000   -- never closer to the player than this (they may have moved since)
local DROP_APART_CM = 1500  -- dropped AI this far apart from each other
local BESIDE_CM    = 1500   -- asked closer than this: on a circle around the player (ground points are 25 m apart)
local done = nil            -- { lastId, results }, loaded lazily

local function readJsonFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local raw = f:read("*a")
    f:close()
    if raw == nil or raw == "" then return nil end
    local ok, data = pcall(json.decode, raw)
    if ok and type(data) == "table" then return data end
    return nil
end

local function writeDone()
    local ok, text = pcall(json.encode, done)
    if not ok then return end
    local tmp = DONE_PATH .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then H.logError(MOD .. ": cannot write " .. tmp); return end
    f:write(text)
    f:close()
    os.remove(DONE_PATH)
    os.rename(tmp, DONE_PATH)
end

local function finish(id, ok, made, err)
    local results = done.results
    results[#results + 1] = { id = id, ok = ok, made = made, error = err, t = os.time() }
    while #results > 20 do table.remove(results, 1) end
    writeDone()
end

--- One drop, on the game thread. Returns ok, how many were made, why not.
local function runDrop(d)
    local target = nil
    H.forEachPlayer(function(c)
        if target == nil and H.safeSteamId(c) == d.steamId then target = c end
    end)
    local pawn = target and H.livePawnFromCtrl(target)
    if pawn == nil then return false, 0, "the player is offline or has no dino" end
    local at = locationOf(pawn)
    local okW, world = pcall(function() return pawn:GetWorld() end)
    if at == nil or not okW or world == nil or not H.isValid(world) then return false, 0, "no world to spawn in" end
    local sp = type(d.sp) == "table" and d.sp or nil
    if sp == nil or type(d.spots) ~= "table" then return false, 0, "bad drop" end
    -- The bridge's spots, re-sorted around where the player is now: closest
    -- to the asked distance first, none on top of them, a little apart.
    local want = num(d.distanceM, 2, 200, 30) * 100
    local list = {}
    for _, pt in ipairs(d.spots) do
        if type(pt) == "table" and tonumber(pt[1]) and tonumber(pt[2]) and tonumber(pt[3]) then
            local dist = math.sqrt((pt[1] - at.x) ^ 2 + (pt[2] - at.y) ^ 2)
            if dist >= DROP_NEAR_CM then list[#list + 1] = { pt = pt, off = math.abs(dist - want) } end
        end
    end
    table.sort(list, function(a, b) return a.off < b.off end)
    -- Right beside the player: evenly round them at the asked distance, at
    -- their height (the lift puts the AI above the ground; it drops onto it).
    -- The ground spots stay behind as a fallback.
    local count0 = math.floor(num(d.count, 1, 5, 1))
    if want < BESIDE_CM then
        local start = math.random() * 2 * math.pi
        for k = count0, 1, -1 do
            local a = start + (k - 1) * 2 * math.pi / count0
            table.insert(list, 1, { pt = { at.x + math.cos(a) * want, at.y + math.sin(a) * want, at.z }, off = 0, beside = true })
        end
    end
    local used, i = {}, 0
    local function nextSpot()
        while i < #list do
            i = i + 1
            if list[i].beside then return list[i].pt end
            local pt, free = list[i].pt, true
            for _, u in ipairs(used) do
                if near(u, pt[1], pt[2], DROP_APART_CM) then free = false; break end
            end
            if free then used[#used + 1] = { x = pt[1], y = pt[2] }; return pt end
        end
        return nil
    end
    local alive = 0
    for _ in pairs(ours) do alive = alive + 1 end
    local count = math.min(count0, HARD_MAX - alive)
    if count <= 0 then return false, 0, "the mod's own limit (" .. HARD_MAX .. " AI) is reached" end
    local g = num(d.growth, 0.1, 1, 1)
    local asZone = { growthMin = g, growthMax = g }
    local made, why = 0, nil
    for _ = 1, count do
        local ok, err, noSpot = spawnOne(world, asZone, sp, nextSpot)
        if ok then made = made + 1 else why = err end
        if noSpot then break end
    end
    return made > 0, made, why
end

--------------------------------------------------------------------------
-- Reset: "clear the AI" from the admin panel (bridge/src/ai-reset.ts)
--------------------------------------------------------------------------
-- Nothing is ever destroyed from Lua (K2_DestroyActor on an actor the game
-- already removed crashes the server). A reset KILLS the AI instead —
-- SetHealth(0), as !slay does — on pawns found fresh in this very tick,
-- RESET_BATCH per poll; the bridge then clears the corpses with the game's
-- own RCON WipeCorpses, and the game and the zones spawn new ones.
-- Only pawns an AIController drives: a player's dino (online, or left in the
-- world after logging out, with no controller) is never touched.

local RESET_BATCH = 25
local RESET_MAX_S = 30      -- the game keeps spawning: stop after this long
local reset = nil           -- { id, classes (set, or nil = every AI), keep (set of classes spared), started, killed }

local function isAiDriven(pawn)
    local okC, c = pcall(function() return pawn.Controller end)
    if not okC or c == nil or not H.isValid(c) then return false end
    local okN, name = pcall(function() return c:GetClass():GetFName():ToString() end)
    return okN and name ~= nil and tostring(name):find("PlayerController", 1, true) == nil
end

--- Kill up to RESET_BATCH more; returns how many were killed and how many are left.
local function resetStep()
    local okP, pawns = pcall(function() return FindAllOf("Pawn") or {} end)
    if not okP then return 0, 0 end
    local killed, left = 0, 0
    for _, pawn in ipairs(pawns) do
        if H.isValid(pawn) and addressOf(pawn) ~= nil and isAiDriven(pawn) then
            local okH, hp = pcall(function() return pawn:GetHealth() end)
            local cls = classNameOf(pawn)
            local chosen = (reset.classes == nil or (cls ~= nil and reset.classes[cls]))
                and not (reset.keep and cls ~= nil and reset.keep[cls])
            if okH and type(hp) == "number" and hp > 0 and chosen then
                if killed >= RESET_BATCH then
                    left = left + 1
                elseif pcall(function() pawn:SetHealth(0) end) then
                    killed = killed + 1
                end
            end
        end
    end
    return killed, left
end

local function continueReset()
    local killed, left = resetStep()
    reset.killed = reset.killed + killed
    if left == 0 or os.time() - reset.started >= RESET_MAX_S then
        finish(reset.id, true, reset.killed, left > 0 and (left .. " still alive after " .. RESET_MAX_S .. " s") or nil)
        H.log(string.format("%s: reset %d — %d AI killed%s", MOD, reset.id, reset.killed,
            left > 0 and (", " .. left .. " left (the game keeps spawning)") or ""))
        reset = nil
    end
end

local function pollDrops()
    if reset ~= nil then continueReset() end
    local file = readJsonFile(DROPS_PATH)
    if file == nil or type(file.drops) ~= "table" then return end
    if done == nil then
        done = readJsonFile(DONE_PATH) or {}
        done.lastId = tonumber(done.lastId) or 0
        if type(done.results) ~= "table" then done.results = {} end
    end
    local pending = {}
    for _, d in ipairs(file.drops) do
        if type(d) == "table" and tonumber(d.id) and tonumber(d.id) > done.lastId then pending[#pending + 1] = d end
    end
    table.sort(pending, function(a, b) return tonumber(a.id) < tonumber(b.id) end)
    local now = os.time()
    for _, d in ipairs(pending) do
        local id = tonumber(d.id)
        done.lastId = id
        writeDone()                                   -- before acting: never twice
        if tonumber(d.expiresAt) == nil or now > tonumber(d.expiresAt) then
            finish(id, false, 0, "expired")
        elseif d.kind == "reset" then
            if reset ~= nil then
                finish(id, false, 0, "a reset is already running")
            else
                local classes = nil
                if type(d.classes) == "table" and #d.classes > 0 then
                    classes = {}
                    for _, c in ipairs(d.classes) do classes[tostring(c)] = true end
                end
                local keep = nil
                if type(d.keep) == "table" and #d.keep > 0 then
                    keep = {}
                    for _, c in ipairs(d.keep) do keep[tostring(c)] = true end
                end
                reset = { id = id, classes = classes, keep = keep, started = now, killed = 0 }
                H.log(MOD .. ": reset " .. id .. " — killing " .. (classes and "the chosen AI" or "every AI"))
                continueReset()
            end
        else
            local ok, made, why = runDrop(d)
            finish(id, ok, made, (not ok or made < (tonumber(d.count) or 0)) and why or nil)
            local line = string.format("%s: drop %d — %d × %s next to %s%s", MOD, id, made,
                tostring(d.sp and d.sp.key), tostring(d.steamId), why and (" (" .. tostring(why) .. ")") or "")
            if ok then H.log(line) else H.logError(line) end
        end
    end
end

--------------------------------------------------------------------------
-- Start
--------------------------------------------------------------------------

math.randomseed(os.time())
readConfig()
LoopAsync(READ_MS, function()
    readConfig()
    writeStatus()
    return false
end)
H.every(TICK_MS, MOD .. " turn", tick)
H.every(DROP_MS, MOD .. " drops", pollDrops)
H.log(MOD .. ": loaded — zones from " .. ZONES_PATH .. " (off until the panel turns them on)")
