-- AIZones — AI that lives in admin-drawn zones.
--
-- The game spawns its own AI around players (Game.ini AIDensity…); it has no
-- zones. This mod adds them: each zone (drawn on the admin panel) has its
-- species, how many to add at a time and how often, a growth range, and two
-- limits: `idleMax` while nobody is in the zone (it is never empty, but
-- stays light) and `max` once a player is inside (it fills up for them).
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
local PER_TURN    = 5        -- …and never more than this many spawns per zone per turn
local TRIES       = 3        -- spawn points tried per AI before giving up this turn

local config = nil           -- the decoded zones.json (plain Lua data)
local status = nil           -- built on the game thread, written by the async loop
local nextAt = {}            -- zone id -> os.time() of its next turn
local ours = {}              -- address -> true: AI this mod spawned, still seen alive
local zoneStats = {}         -- zone id -> { spawned, failed, lastSpawn, lastError }
local lastScan = 0           -- os.time() of the last AI scan
local SCAN_EVERY_S = 30      -- with nothing due, the count of ours is refreshed this often

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

--- One AI of `sp` at one of the zone's points. Returns true, or false + why.
local function spawnOne(world, zone, sp)
    local pawnCls = findClass(sp.pawn)
    local ctrlCls = findClass(sp.ctrl)
    if pawnCls == nil or ctrlCls == nil then
        return false, "class not found: " .. tostring(pawnCls == nil and sp.pawn or sp.ctrl)
    end
    local points = zone.points
    for _ = 1, TRIES do
        local pt = points[math.random(#points)]
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

    -- Which zones take a turn now: on, due, with points and species. Whether
    -- a player is inside decides the limit (max) or (idleMax).
    local due = {}
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
            if now >= (nextAt[z.id] or 0) then due[#due + 1] = z end
        end
    end

    -- One scan of the AI serves every zone. Only when a zone is due, or now
    -- and then to keep the count of ours fresh: a FindAllOf of every pawn is
    -- not free, and with nothing to spawn there is nothing to count for.
    local ai = nil
    if #due > 0 or (st.enabled and now - lastScan >= SCAN_EVERY_S) then
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

    for _, z in ipairs(due) do
        nextAt[z.id] = now + math.floor(num(z.every, 10, 3600, 60))
        local stats = zoneStats[z.id] or { spawned = 0, failed = 0 }
        zoneStats[z.id] = stats
        -- What is in the zone now: its species, whoever spawned them.
        local classes = {}
        for _, sp in ipairs(z.species) do if sp.cls then classes[sp.cls] = true end end
        local radius = num(z.radius, 1000, 2000000, 20000)
        local count = 0
        for _, a in ipairs(ai or {}) do
            if a.cls and classes[a.cls] and near(a, z.x, z.y, radius) then count = count + 1 end
        end
        local full = math.floor(num(z.max, 0, 500, 5))
        local occupied = st.zones[tostring(z.id)].occupied
        local max = occupied and full or math.min(full, math.floor(num(z.idleMax, 0, 500, 0)))
        local room = math.min(math.floor(num(z.perTurn, 1, PER_TURN, 1)), max - count, cap - total, HARD_MAX - alive)
        if ai == nil then room = 0 end                -- no count, no spawn
        if room > 0 and world == nil then
            stats.lastError = "no world to spawn in"
            room = 0
        end
        local made = {}
        for _ = 1, room do
            local sp = z.species[math.random(#z.species)]
            local ok, why = spawnOne(world, z, sp)
            if ok then
                count, alive, total = count + 1, alive + 1, total + 1
                stats.spawned = stats.spawned + 1
                stats.lastSpawn = now
                made[#made + 1] = tostring(sp.key)
            else
                stats.failed = stats.failed + 1
                stats.lastError = why
                H.logError(MOD .. ": zone '" .. tostring(z.name) .. "': " .. tostring(why))
            end
        end
        if #made > 0 then
            H.log(string.format("%s: zone '%s' +%d (%s) — %d/%d in the zone (%s), %d/%d AI on the server",
                MOD, tostring(z.name), #made, table.concat(made, ", "), count, max,
                occupied and "a player is in it" or "empty", total, cap))
        end
        local zs = st.zones[tostring(z.id)]
        zs.count, zs.limit = count, max
    end

    for id, stats in pairs(zoneStats) do
        local zs = st.zones[tostring(id)]
        if zs then
            zs.spawned, zs.failed, zs.lastSpawn, zs.lastError = stats.spawned, stats.failed, stats.lastSpawn, stats.lastError
        end
    end
    st.alive, st.cap = alive, cap
    if ai then st.total = total end
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
