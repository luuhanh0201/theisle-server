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
--- a turn takes the next one, so no two land on the same spot.
local function spotsFor(zone, players)
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
    return function()
        i = i + 1
        return far[(i - 1) % #far + 1]    -- more AI than spots: round again
    end
end

--- One AI of `sp` at the next free spot. Returns true, or false + why.
local function spawnOne(world, zone, sp, nextSpot)
    local pawnCls = findClass(sp.pawn)
    local ctrlCls = findClass(sp.ctrl)
    if pawnCls == nil or ctrlCls == nil then
        return false, "class not found: " .. tostring(pawnCls == nil and sp.pawn or sp.ctrl)
    end
    for _ = 1, TRIES do
        local pt = nextSpot()
        local loc = { X = pt[1], Y = pt[2], Z = pt[3] + num(sp.lift, 0, 1000, 150) }
        local rot = { Pitch = 0, Yaw = math.random(0, 359), Roll = 0 }
        local okP, pawn = pcall(function() return world:SpawnActor(pawnCls, loc, rot) end)
        -- A spawn blocked by terrain comes back as an empty wrapper: try another point.
        if okP and pawn ~= nil and addressOf(pawn) ~= nil then
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
    local players, playerAddrs, world = {}, {}, nil
    H.forEachPlayer(function(ctrl)
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local addr = addressOf(pawn)
        if addr then playerAddrs[addr] = true end
        local loc = locationOf(pawn)
        if loc then players[#players + 1] = loc end
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
                if near(p, x, y, radius) then zs.occupied = true; break end
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
            if a.cls and classes[a.cls] and near(a, z.x, z.y, radius) then count = count + 1 end
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
        local nextSpot = room > 0 and spotsFor(z, players) or nil
        for _ = 1, room do
            local sp = z.species[math.random(#z.species)]
            local ok, err = spawnOne(world, z, sp, nextSpot)
            if ok then
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
        budget = budget - room
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
H.log(MOD .. ": loaded — zones from " .. ZONES_PATH .. " (off until the panel turns them on)")
