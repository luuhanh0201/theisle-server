--[[
    StatsLogger

    Emits what happens on the server to two append-only NDJSON streams that the
    external bridge service tails (see mods/_shared/events.lua):

      events.ndjson     session_start / session_end, spawn, death, damage,
                        chat, growth milestones
      snapshots.ndjson  one line per online player every SNAPSHOT_SECONDS:
                        name, species, vitals, growth, position

    This mod is READ-ONLY. It hooks, it reads, it writes to disk. It never
    mutates game state, which is what keeps its crash risk near zero. Keep it
    that way, if a feature needs to change the world, it belongs in another mod.

    Threads (docs/lua-safety-rules.md):
      * game thread, hooks, and the read loop (H.every: the live state
                       every second, a snapshot every SNAPSHOT_SECONDS).
                       These only read and queue.
      * async thread, the 0.5 s LoopAsync tick. It only writes queued lines
                       to disk and never touches a UObject.
    So a slow disk never stalls the game, and no engine object is read from
    the wrong thread.

    What it can and cannot see (docs/reference/EVRIMA_KillFeed_Design.md):
      * player-on-player direct attacks  -> ApplyDamage hook, reliable
      * fall / drown / environmental     -> INVISIBLE, no hook fires
      * damage-over-time ticks           -> INVISIBLE
      * AI damage                        -> INVISIBLE
      * deaths, spawns, sessions,        -> inferred by the snapshot loop from
        growth milestones, mutation picks   state changes between two polls,
                                            up to SNAPSHOT_SECONDS late
]]

-- Resolve require("shared.isle.*") to Mods/shared/isle/ whatever UE4SS itself
-- puts on package.path. Relative to the server's working directory
-- (Binaries/Win64), like every path the mods use.
if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H      = require("shared.isle.helpers")
local Events = require("shared.isle.events")

local MOD = "StatsLogger"

local SNAPSHOT_SECONDS  = 5                         -- upstream cadence
local ATTRIB_WINDOW     = 10                        -- seconds a hit can explain a death
local GROWTH_MILESTONES = { 0.25, 0.5, 0.75, 1.0 }
-- Natural growth takes hours; a bigger step than this between two polls was
-- set, not grown (DinoGarage !redeem, an admin command, a cheat).
local MAX_NATURAL_GROWTH_STEP = 0.05

--------------------------------------------------------------------------
-- Property names that still need verifying on the real server
--------------------------------------------------------------------------
-- Every name below is read defensively: a miss yields nil and is reported
-- once in UE4SS.log, never a crash. Confirm them with the UE4SS Live
-- View against a live pawn, then delete the ones that turn out wrong.
-- Same candidates as DinoGarage's capture.lua, so both mods agree.

local VITALS = {
    health  = { "Health", "CurrentHealth" },
    stamina = { "Stamina", "CurrentStamina" },
    hunger  = { "Hunger", "CurrentHunger" },
    thirst  = { "Thirst", "CurrentThirst" },
    oxygen  = { "Oxygen", "CurrentOxygen" },
    blood   = { "Blood", "CurrentBlood" },
    growth  = { "Growth", "GrowthPercent" },
}

-- Tried first. Evrima keeps vitals in GAS attribute sets, so on the live
-- server (0.21.784) `pawn.Health` is nil, the pawn's getters are the way in.
-- The names are the UFunctions found in the server binary next to the
-- SetHealth/SetGrowth setters the garage uses.
local GETTERS = {
    health = "GetHealth", stamina = "GetStamina", hunger = "GetHunger",
    thirst = "GetThirst", oxygen = "GetOxygen", blood = "GetBlood",
    growth = "GetGrowth",
}

local function vital(pawn, key)
    return H.readVital(pawn, GETTERS[key], VITALS[key], key)
end

-- Maxima, for the portal's bars. The game recomputes them with growth, so
-- they are read every poll. Missing getter = no bar for that vital.
local MAX_GETTERS = {
    health = "GetMaxHealth", stamina = "GetMaxStamina", hunger = "GetMaxHunger",
    thirst = "GetMaxThirst", blood = "GetMaxBlood", oxygen = "GetMaxOxygen",
}

local function maxima(pawn)
    local out, any = {}, false
    for key, fn in pairs(MAX_GETTERS) do
        local ok, v = pcall(function() return pawn[fn](pawn) end)
        if ok and type(v) == "number" and v > 0 then
            out[key] = math.floor(v * 100 + 0.5) / 100
            any = true
        end
    end
    return any and out or nil
end

--- Prime / elder status as the game's own getters answer it.
local function primeState(pawn)
    local function bool(fn)
        local ok, v = pcall(function() return pawn[fn](pawn) end)
        if ok and type(v) == "boolean" then return v end
        return nil
    end
    local okS, stacks = pcall(function() return pawn:GetElderReplicationStacks() end)
    -- The ten prime conditions (pawn.EligiblePrimeElderData.bPrimeCondition1..10,
    -- found by IsleProbe on 0.21.784). Keyed "1".."10": a JSON array cannot hold
    -- a condition that failed to read.
    local conditions = {}
    local okD, data = pcall(function() return pawn.EligiblePrimeElderData end)
    if okD and data ~= nil then
        for i = 1, 10 do
            local okC, v = pcall(function() return data["bPrimeCondition" .. i] end)
            if okC and type(v) == "boolean" then conditions[tostring(i)] = v end
        end
    end
    return {
        elder    = bool("IsElder"),
        prime    = bool("IsPrimeElder"),
        eligible = bool("GetIsEligiblePrimeElder"),
        elderStacks = okS and tonumber(stacks) or nil,
        conditions = next(conditions) ~= nil and conditions or nil,
    }
end

local function primeKey(p)
    local c = {}
    for i = 1, 10 do c[i] = tostring(p.conditions and p.conditions[tostring(i)]) end
    return string.format("%s|%s|%s|%s|%s", tostring(p.elder), tostring(p.prime), tostring(p.eligible),
        tostring(p.elderStacks), table.concat(c, ","))
end

--------------------------------------------------------------------------
-- Reads (all pcall-guarded, all return nil on failure)
--------------------------------------------------------------------------

--- Class name of a pawn, or "unknown". pcall returns (ok, value), and on
-- failure the second value is the error message, so check ok explicitly.
local function speciesOf(pawn)
    local ok, name = pcall(function()
        return pawn:GetClass():GetFName():ToString()
    end)
    if not ok or name == nil then return "unknown" end
    return tostring(name)
end

--- Full class path, the exact string DinoGarage compares on !redeem. The bridge
-- collects these so an admin can only pick species that really exist here.
local function classPathOf(pawn)
    local ok, name = pcall(function() return pawn:GetClass():GetFullName() end)
    if not ok or name == nil then return nil end
    return tostring(name)
end

-- Same slot keys and fields as DinoGarage's capture.lua, so a mutation seen
-- here can be written into a garage slot unchanged.
local MUTATION_SLOTS = {
    Slot1 = "MutationSlot1", Slot2 = "MutationSlot2",
    Slot3 = "MutationSlot3", Slot4 = "MutationSlot4",
    ParentSlot1 = "ParentMutationSlot1", ParentSlot2 = "ParentMutationSlot2",
    ParentSlot3 = "ParentMutationSlot3", ParentSlot4 = "ParentMutationSlot4",
    ElderSlot1A = "ElderMutationSlot1A", ElderSlot1B = "ElderMutationSlot1B",
    ElderSlot2A = "ElderMutationSlot2A", ElderSlot2B = "ElderMutationSlot2B",
    ElderSlot3A = "ElderMutationSlot3A", ElderSlot3B = "ElderMutationSlot3B",
    ElderSlot4A = "ElderMutationSlot4A", ElderSlot4B = "ElderMutationSlot4B",
}

--- Filled mutation slots as { Slot1 = "MUT_X", ... }, or nil if unreadable.
-- Empty and "None" slots are left out.
local function mutationsOf(pawn)
    local ok, struct = pcall(function() return pawn.ReplicatedMutationsData end)
    if not ok or struct == nil then return nil end
    local out = {}
    for key, field in pairs(MUTATION_SLOTS) do
        local got, v = pcall(function() return struct[field]:ToString() end)
        if got and v ~= nil and v ~= "" and v ~= "None" then out[key] = tostring(v) end
    end
    return out
end

local function round(v)
    v = tonumber(v)
    if v == nil then return nil end
    return math.floor(v + 0.5)
end

--- World position in UE units (cm), rounded, sub-centimetre precision is
-- noise and doubles the size of the snapshot stream.
local function locationOf(pawn)
    local ok, loc = pcall(function()
        local v = pawn:K2_GetActorLocation()
        return { x = round(v.X), y = round(v.Y), z = round(v.Z) }
    end)
    if not ok or loc == nil or loc.x == nil or loc.y == nil then return nil end
    return loc
end

local function yawOf(pawn)
    local ok, yaw = pcall(function() return pawn:K2_GetActorRotation().Yaw end)
    if not ok then return nil end
    return round(yaw)
end

--- Display name from the PlayerState, or nil. Names are plain strings, so
-- caching them per SteamID is safe (rule 1 is about UObjects).
local function playerNameOf(ctrl)
    local ok, name = pcall(function()
        local ps = ctrl.PlayerState
        if not H.isValid(ps) then return nil end
        return ps:GetPlayerName():ToString()
    end)
    if not ok or name == nil or name == "" then return nil end
    return tostring(name)
end

--------------------------------------------------------------------------
-- Ping: the round trip the SERVER measured for each player, read with the
-- snapshot (every SNAPSHOT_SECONDS, no need for more). UE5 keeps it on the
-- PlayerState as CompressedPing, a uint8 of ms / 4 (UE4: Ping); a number
-- read, like the name above. It includes the server's own frame time: when
-- the server bogs down, everyone's ping rises together. Flag first:
-- Saved/ping-read.trying before the first read of a run, removed after;
-- found at load, ping stays off.
local PING_FLAG = "Mods/StatsLogger/Saved/ping-read.trying"
local pingOff, pingTried = false, false
do
    local f = io.open(PING_FLAG, "r")
    if f then
        f:close()
        pingOff = true
        H.logError(MOD .. ": the last run stopped while reading a ping, ping off. Delete " .. PING_FLAG .. " to try again.")
    end
end

--- ms, or nil when it cannot be read.
local function pingOf(ctrl)
    if pingOff then return nil end
    local first = not pingTried
    if first then
        local f = io.open(PING_FLAG, "w")
        if f then f:write(tostring(os.time())); f:close() end
    end
    local ok, v = pcall(function()
        local ps = ctrl.PlayerState
        if not H.isValid(ps) then return nil end
        local okC, c = pcall(function() return ps.CompressedPing end)
        if okC and type(c) == "number" then return c end
        local okP, legacy = pcall(function() return ps.Ping end)
        if okP and type(legacy) == "number" then return legacy end
        return nil
    end)
    if first then
        os.remove(PING_FLAG)
        pingTried = true
        H.log(MOD .. ": ping read: " .. (ok and v ~= nil and (tostring(v * 4) .. " ms") or "not readable on this build"))
    end
    if ok and type(v) == "number" then return v * 4 end
    return nil
end

local function steamIdOfPawn(pawn)
    local ok, ctrl = pcall(function() return pawn.Controller end)
    if not ok then return nil end
    return H.safeSteamId(ctrl)
end

--------------------------------------------------------------------------
-- Queue, hooks append here, the tick flushes
--------------------------------------------------------------------------

local pending = {}

--- Stamp the time NOW, not at flush, so ordering and latency stay honest.
local function queue(event)
    event.t = os.time()
    pending[#pending + 1] = event
end

local function flush()
    if #pending == 0 then return end
    local batch = pending
    pending = {}
    Events.emitMany(batch)
end

--------------------------------------------------------------------------
-- Skin effects probe (mud, dirt, blood, scars), READ ONLY (H.readSkinEffects)
--------------------------------------------------------------------------
-- What the game holds and in which shape, before anything writes it: the
-- first read of a run logs the struct's fields and types; then each dino's
-- values are an event (skin_effects) when they change, at most every
-- EFFECTS_EVERY_S. Flag first: Saved/effects-probe.trying is written before
-- the first read and removed after it; found at load, the probe stays off.
local EFFECTS_FLAG = "Mods/StatsLogger/Saved/effects-probe.trying"
local EFFECTS_EVERY_S = 30
local effectsOff = false
local effectsTried = false
do
    local f = io.open(EFFECTS_FLAG, "r")
    if f then
        f:close()
        effectsOff = true
        H.logError(MOD .. ": the last run stopped while probing skin effects, probe off. Delete " .. EFFECTS_FLAG .. " to try again.")
    end
end

local function effectsText(e)
    local parts = {}
    for _, f in ipairs(e.fields or {}) do parts[#parts + 1] = f[1] .. ":" .. f[2] end
    local vals = {}
    for k, v in pairs(e.values or {}) do vals[#vals + 1] = k .. "=" .. tostring(v) end
    table.sort(vals)
    return string.format("%s [%s] values {%s}", tostring(e.struct or "no struct"), table.concat(parts, ", "), table.concat(vals, ", "))
end

--- Once every EFFECTS_EVERY_S per player: read, log the shape once, an event on change.
local function effectsProbe(pawn, id, name, species, prev, now)
    if effectsOff or (prev.effectsAt and now - prev.effectsAt < EFFECTS_EVERY_S) then return end
    prev.effectsAt = now
    local first = not effectsTried
    if first then
        local f = io.open(EFFECTS_FLAG, "w")
        if f then f:write(tostring(now)); f:close() end
    end
    local e = H.readSkinEffects(pawn)
    if first then
        os.remove(EFFECTS_FLAG)
        effectsTried = true
        H.log(MOD .. ": skin effects probe (" .. tostring(species) .. "): " .. (e and effectsText(e) or "nothing found on the pawn"))
    end
    if e == nil then return end
    -- Coarse key: mud drying a little every few seconds is not a change worth an event.
    local keyParts = {}
    for k, v in pairs(e.values) do
        keyParts[#keyParts + 1] = k .. "=" .. (type(v) == "number" and string.format("%.2f", math.floor(v * 20 + 0.5) / 20) or tostring(v))
    end
    table.sort(keyParts)
    local key = table.concat(keyParts, ",")
    if key ~= prev.effectsKey then
        prev.effectsKey = key
        queue({ type = "skin_effects", steamId = id, name = name, species = species, struct = e.struct, values = e.values })
    end
end

--------------------------------------------------------------------------
-- Per-player state, keyed by SteamID only (never by UObject)
--------------------------------------------------------------------------

local readySnaps = {}   -- taken on the game thread, written by the async tick

local names      = {}   -- steamId -> last known display name
local sessions   = {}   -- steamId -> { start = ts }
local life       = {}   -- steamId -> { species, health, growth, spawnedAt }
local recentHits = {}   -- victimSteamId -> last player hit on them

--------------------------------------------------------------------------
-- Damage hook
--------------------------------------------------------------------------
-- Called ON the attacker, with the target as the first argument.
-- The remaining parameters are NOT yet verified, so we read them positionally
-- and defensively rather than pretending to know their names.

-- One event per bite. The game calls ApplyDamage several times for one bite
-- with the same number (a T-Rex bite logged up to six times; the victim lost
-- it once, 2026-09-28): those repeats are dropped here, before anything is
-- read. A hold bite (mouse held) deals ticks, each a little lower: they keep
-- the bite's id with their tick number, so the bridge adds them into one bite.
-- os.clock (ms, since the server started) orders them within a second.
local REPEAT_WITHIN_S = 0.25
local TICK_WITHIN_S   = 1.0
local lastBite = {}     -- "<attacker addr>><victim addr>" -> { at, amount, bite, tick }
local biteSeq = 0

--- "repeat" (drop it), or the bite id and tick number this hit belongs to.
local function biteOf(attacker, target, amount)
    local okA, a = pcall(function() return attacker:GetAddress() end)
    local okV, v = pcall(function() return target:GetAddress() end)
    local key = (okA and tostring(a) or "?") .. ">" .. (okV and tostring(v) or "?")
    local now = os.clock()
    local prev = lastBite[key]
    if prev and amount and prev.amount then
        local dt = now - prev.at
        if dt >= 0 and dt < REPEAT_WITHIN_S and math.abs(amount - prev.amount) < 0.01 then return "repeat" end
        local drop = prev.amount - amount
        if dt >= 0 and dt < TICK_WITHIN_S and drop > 0 and drop < prev.amount * 0.1 then
            prev.at, prev.amount, prev.tick = now, amount, prev.tick + 1
            return prev.bite, prev.tick, now
        end
    end
    biteSeq = biteSeq + 1
    local bite = string.format("%d-%d", os.time(), biteSeq)
    lastBite[key] = { at = now, amount = amount, bite = bite, tick = 1 }
    -- Forget pairs that fought long ago (the table stays small).
    if biteSeq % 200 == 0 then
        for k, b in pairs(lastBite) do if now - b.at > 60 then lastBite[k] = nil end end
    end
    return bite, 1, now
end

RegisterHook("/Script/TheIsle.TICharacterBase:ApplyDamage",
H.timed(MOD .. ": damage hook", function(selfParam, targetParam, amountParam)
    H.try(MOD .. ": ApplyDamage", function()
        local attacker = selfParam and selfParam:get()
        local target   = targetParam and targetParam:get()
        if not H.isValid(attacker) or not H.isValid(target) then return end

        local amount
        if amountParam then
            local got, v = pcall(function() return amountParam:get() end)
            if got then amount = tonumber(v) end
        end
        local bite, tick, clock = biteOf(attacker, target, amount)
        if bite == "repeat" then return end

        -- A pawn's controller is how we reach a SteamID. Missing controller
        -- means AI, so we record the side we can identify and mark the other.
        local attackerId = steamIdOfPawn(attacker)
        local victimId   = steamIdOfPawn(target)
        local attackerSpecies = speciesOf(attacker)
        local victimSpecies   = speciesOf(target)

        -- Only a hit with an identifiable player behind it can explain a
        -- death later. Recording an unattributable one would overwrite a real
        -- killer and turn an attributed death into an anonymous one.
        local attackerGrowth = vital(attacker, "growth")
        if victimId and attackerId then
            recentHits[victimId] = {
                by      = attackerId,
                species = attackerSpecies,
                growth  = attackerGrowth,
                at      = os.time(),
                amount  = amount,
            }
        end

        queue({
            type            = "damage",
            attacker        = attackerId or "ai",
            attackerName    = attackerId and names[attackerId] or nil,
            attackerSpecies = attackerSpecies,
            victim          = victimId or "ai",
            victimName      = victimId and names[victimId] or nil,
            victimSpecies   = victimSpecies,
            amount          = amount,
            bite            = bite,
            tick            = tick,
            clockMs         = math.floor(clock * 1000),
            loc             = locationOf(target),
            -- Where the attacker stood and both sizes (2026-10-07): the bridge
            -- measures the bite's reach and flags one far beyond its species'
            -- usual (bridge/src/damage-range.ts).
            attackerLoc     = locationOf(attacker),
            attackerGrowth  = attackerGrowth,
            victimGrowth    = vital(target, "growth"),
        })
    end)
end))

--------------------------------------------------------------------------
-- Chat, the shared hook already deduplicates and defers out of the hook
--------------------------------------------------------------------------

H.onChat(function(_ctrl, steamId, msg)
    queue({
        type    = "chat",
        steamId = steamId,
        name    = names[steamId],
        message = msg,
    })
end)

--------------------------------------------------------------------------
-- Snapshot loop, the only way to see deaths, spawns and sessions
--------------------------------------------------------------------------

local function checkLife(id, name, pawn, snap)
    local now  = os.time()
    local prev = life[id]
    local health = snap.health

    -- Spawn: first live pawn this session, a new life after a death, or a
    -- different species (a new character without a death we could see).
    -- A failed class read ("unknown") is not a species change.
    local alive = health == nil or health > 0
    local swapped = prev ~= nil and snap.species ~= "unknown"
        and prev.species ~= "unknown" and prev.species ~= snap.species
    if alive and (prev == nil or prev.dead or swapped) then
        local muts = mutationsOf(pawn)
        local unlocks = H.readUnlockedMutations(pawn)
        queue({
            type      = "spawn",
            steamId   = id,
            name      = name,
            species   = snap.species,
            classPath = classPathOf(pawn),
            growth    = snap.growth,
            mutations = muts,
            unlockedMutations = unlocks,
            loc       = snap.loc,
        })
        local skin = H.readSkin(pawn)
        local prime = primeState(pawn)
        snap.prime = prime.prime
        life[id] = {
            species   = snap.species,
            health    = health,
            growth    = snap.growth,
            loc       = snap.loc,
            spawnedAt = now,
            mutations = muts,
            unlocksKey = unlocks and table.concat(unlocks, ",") or nil,
            skinKey   = H.skinKey(skin),
            primeKey  = primeKey(prime),
        }
        if skin then queue({ type = "skin", steamId = id, name = name, species = snap.species, skin = skin }) end
        queue({ type = "prime", steamId = id, name = name, species = snap.species,
                elder = prime.elder, prime = prime.prime, eligible = prime.eligible,
                elderStacks = prime.elderStacks, conditions = prime.conditions, growth = snap.growth })
        return
    end
    if prev == nil then
        -- First sight of this player is already a corpse: nothing to report
        -- until they spawn.
        life[id] = { species = snap.species, health = health, dead = true }
        return
    end
    if prev.dead then return end

    -- Death = HP crossed from above zero to zero or below.
    if health ~= nil and prev.health ~= nil and prev.health > 0 and health <= 0 then
        local hit = recentHits[id]
        local attributable = hit ~= nil and (now - hit.at) <= ATTRIB_WINDOW
        queue({
            type          = "death",
            steamId       = id,
            name          = name,
            species       = snap.species,
            growth        = snap.growth,
            loc           = snap.loc,
            lifeSeconds   = prev.spawnedAt and (now - prev.spawnedAt) or nil,
            -- Environmental, DoT and AI deaths land here with no killer.
            -- That is a platform limit, not a bug.
            attributed    = attributable or false,
            killer        = attributable and hit.by or nil,
            killerName    = attributable and names[hit.by] or nil,
            killerSpecies = attributable and hit.species or nil,
            killerGrowth  = attributable and hit.growth or nil,
            lastHit       = attributable and hit.amount or nil,
        })
        recentHits[id] = nil
        prev.dead   = true
        prev.health = health
        return
    end

    -- Growth, only within one life: a jump is logged as such, and only
    -- natural growth counts toward milestones.
    local g0, g1 = prev.growth, snap.growth
    if g0 ~= nil and g1 ~= nil and math.abs(g1 - g0) > MAX_NATURAL_GROWTH_STEP then
        queue({
            type    = "growth_set",
            steamId = id,
            name    = name,
            species = snap.species,
            from    = g0,
            to      = g1,
        })
    elseif g0 ~= nil and g1 ~= nil and g1 > g0 then
        for _, m in ipairs(GROWTH_MILESTONES) do
            if g0 < m and g1 >= m then
                queue({
                    type      = "growth",
                    steamId   = id,
                    name      = name,
                    species   = snap.species,
                    milestone = m,
                    growth    = g1,
                    lifeSeconds = prev.spawnedAt and (now - prev.spawnedAt) or nil,
                })
            end
        end
    end

    -- Skin: its own event, only when it changes (a spawn sends the first).
    -- Not in every snapshot: ten colours per player every 5 s would bloat the file.
    local skin = H.readSkin(pawn)
    local key = H.skinKey(skin)
    if skin and key ~= prev.skinKey then
        queue({ type = "skin", steamId = id, name = name, species = snap.species, skin = skin })
        prev.skinKey = key
    end

    -- Skin effects (probe, read only): see effectsProbe.
    effectsProbe(pawn, id, name, snap.species, prev, now)

    -- Prime / elder: an event when it changes (and once per life).
    local prime = primeState(pawn)
    -- On the snapshot too: the bridge keeps a prime dino's maxima apart from
    -- the usual ones, and telling them apart by the "prime" events' times
    -- let a prime Deinosuchus's 10,800 pass for the plain value at 88 %.
    snap.prime = prime.prime
    local pk = primeKey(prime)
    if pk ~= prev.primeKey then
        prev.primeKey = pk
        queue({ type = "prime", steamId = id, name = name, species = snap.species,
                elder = prime.elder, prime = prime.prime, eligible = prime.eligible,
                elderStacks = prime.elderStacks, conditions = prime.conditions, growth = snap.growth })
    end

    -- Mutation picks: one event per slot that changed within this life.
    local muts = mutationsOf(pawn)
    if muts ~= nil and prev.mutations ~= nil then
        for key in pairs(MUTATION_SLOTS) do
            if muts[key] ~= prev.mutations[key] then
                queue({
                    type    = "mutation",
                    steamId = id,
                    name    = name,
                    species = snap.species,
                    slot    = key,
                    from    = prev.mutations[key],
                    to      = muts[key],
                    growth  = g1,
                })
            end
        end
    end
    if muts ~= nil then prev.mutations = muts end

    -- Quest mutations unlocked (drink saltwater, jump 50 times…): an event
    -- when the list changes, what the garage must give back (restore.lua).
    local unlocks = H.readUnlockedMutations(pawn)
    local unlocksKey = unlocks and table.concat(unlocks, ",") or nil
    if unlocksKey ~= nil and prev.unlocksKey ~= nil and unlocksKey ~= prev.unlocksKey then
        queue({ type = "mutation_unlocks", steamId = id, name = name, species = snap.species,
                unlocked = unlocks, growth = g1 })
    end
    if unlocksKey ~= nil then prev.unlocksKey = unlocksKey end

    prev.health = health
    if g1 ~= nil then prev.growth = g1 end
    prev.loc = snap.loc                   -- where a pawn_lost death happened
end

--- The player is still connected but has no pawn. A dino that was alive at
-- the last poll has died: in Evrima the controller lets go of the pawn at
-- death and the player lands in the spawn menu, usually before the next
-- 5-second poll could see HP reach zero (a fall kills in one frame). Store and
-- admin kills end the same way; the bridge tells those apart.
local function lostPawn(id, name)
    local prev = life[id]
    if prev == nil or prev.dead then return end
    local now = os.time()
    local hit = recentHits[id]
    local attributable = hit ~= nil and (now - hit.at) <= ATTRIB_WINDOW
    queue({
        type          = "death",
        steamId       = id,
        name          = name,
        species       = prev.species,
        growth        = prev.growth,
        loc           = prev.loc,
        lifeSeconds   = prev.spawnedAt and (now - prev.spawnedAt) or nil,
        detectedBy    = "pawn_lost",
        attributed    = attributable or false,
        killer        = attributable and hit.by or nil,
        killerName    = attributable and names[hit.by] or nil,
        killerSpecies = attributable and hit.species or nil,
        killerGrowth  = attributable and hit.growth or nil,
        lastHit       = attributable and hit.amount or nil,
    })
    recentHits[id] = nil
    prev.dead = true
end

--------------------------------------------------------------------------
-- Live state: players every second, AI every other second
--------------------------------------------------------------------------
-- The snapshot stream (5 s) is the record; this is the "now" the map and the
-- player portal show, as fresh as it can be. One small file replaced each
-- time (not appended): nobody needs its history, and a stream at 1 s with
-- hundreds of AI would bloat.
--
-- AI = every pawn nobody plays: Evrima spawns AI around players and despawns
-- it, so only a live read is true. Uses nothing new against the engine,
-- FindAllOf, IsValid, GetAddress, the class name, K2_GetActorLocation and the
-- vital getters are what this mod already calls on player pawns. No
-- reflection walk (reading arbitrary properties crashed the server,
-- 2026-09-24).

local LIVE_FILE      = "live.json"
local LIVE_EVERY_MS  = 1000
local AI_EVERY_LIVES = 2      -- AI list every 2nd live read (2 s)
local AI_MAX         = 500
-- The game's ambient fish (TIAIWorldSpawner.AIAmbientFishClasses, FishProbe
-- 2026-09-26): spawned around players in the water. Marked among the Pawns
-- (f = true, counted apart as `fish`) so the map draws them as their own layer.
-- Not looked up by class: none was ever found that way, and it was one of the
-- new reads just before the 10:35 crash (2026-09-26).
local FISH_CLASSES = { "BP_Catfish_C", "BP_Coalecanth_C", "BP_Forktail_C", "BP_Hoplo_C", "BP_Longear_C", "BP_Muskel_C" }
local FISH_SET = {}
for _, c in ipairs(FISH_CLASSES) do FISH_SET[c] = true end
local FISH_MAX = 300
local readyLive = nil         -- the latest state, written by the async tick
local lastAi    = nil         -- the last AI scan, repeated between scans
local liveCount = 0

local function health(pawn)
    local ok, v = pcall(function() return pawn:GetHealth() end)
    if ok and type(v) == "number" then return v end
    return nil
end

--- A number the game keeps on its game state (scalar properties only:
--- AIAlive, ServerFPS, both read fine by IsleProbe's config dump).
local function gameStateNumber(field)
    local ok, n = pcall(function()
        local gs = FindFirstOf("TIGameStateBase")
        if not H.isValid(gs) then return nil end
        return gs[field]
    end)
    return ok and type(n) == "number" and n or nil
end
local function aiAliveCounter() return gameStateNumber("AIAlive") end

local function scanAi(now, playerPawns)
    local ok, pawns = pcall(function() return FindAllOf("Pawn") or {} end)
    if not ok then
        H.logError(MOD .. ": FindAllOf(Pawn) failed")
        return nil
    end
    local list, total, dead, fish, fishListed = {}, 0, 0, 0, 0
    local seen = {}
    local function add(pawn, addr, isFish)
        seen[addr] = true
        local hp = health(pawn)
        if hp ~= nil and hp <= 0 then
            dead = dead + 1                   -- a corpse is not AI you can meet
            return
        end
        local loc = locationOf(pawn)
        if isFish then
            fish = fish + 1
            if loc and fishListed < FISH_MAX then
                fishListed = fishListed + 1
                list[#list + 1] = { c = speciesOf(pawn), x = loc.x, y = loc.y, z = loc.z, hp = hp, f = true }
            end
        else
            total = total + 1
            if loc and #list - fishListed < AI_MAX then
                list[#list + 1] = { c = speciesOf(pawn), x = loc.x, y = loc.y, z = loc.z, hp = hp }
            end
        end
    end
    for _, pawn in ipairs(pawns) do
        if H.isValid(pawn) then
            local okA, addr = pcall(function() return pawn:GetAddress() end)
            if okA and addr ~= 0 and not playerPawns[addr] then add(pawn, addr, FISH_SET[speciesOf(pawn)] == true) end
        end
    end
    -- The game's ambient fish are TIAmbientFish actors, not Pawns (FishSpawnTest,
    -- 2026-09-26: FindAllOf("TIAmbientFish") and their location read 12 times on
    -- the live server, fine). A fish the game parked is at (0, 0, 0): skipped.
    -- No health read (the class has no functions).
    local okF, swimmers = pcall(function() return FindAllOf("TIAmbientFish") or {} end)
    for _, obj in ipairs(okF and swimmers or {}) do
        if fishListed >= FISH_MAX then break end
        if H.isValid(obj) then
            local okA, addr = pcall(function() return obj:GetAddress() end)
            if okA and addr ~= 0 and not seen[addr] then
                seen[addr] = true
                local loc = locationOf(obj)
                if loc and not (loc.x == 0 and loc.y == 0 and loc.z == 0) then
                    fish = fish + 1
                    fishListed = fishListed + 1
                    list[#list + 1] = { c = speciesOf(obj), x = loc.x, y = loc.y, z = loc.z, f = true }
                end
            end
        end
    end
    return { t = now, count = total, fish = fish, dead = dead, aiAlive = aiAliveCounter(), list = list }
end

local function liveOnce()
    local now = os.time()
    local players, playerPawns = {}, {}
    H.forEachPlayer(function(ctrl)
        local id = H.safeSteamId(ctrl)
        if not id then return end
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local okAddr, addr = pcall(function() return pawn:GetAddress() end)
        if okAddr then playerPawns[addr] = true end
        local loc = locationOf(pawn)
        if not loc then return end
        players[#players + 1] = {
            id = id, x = loc.x, y = loc.y, z = loc.z, yaw = yawOf(pawn),
            health = vital(pawn, "health"), stamina = vital(pawn, "stamina"),
            hunger = vital(pawn, "hunger"), thirst = vital(pawn, "thirst"),
            oxygen = vital(pawn, "oxygen"), blood = vital(pawn, "blood"),
            growth = vital(pawn, "growth"),
        }
    end)
    liveCount = liveCount + 1
    if lastAi == nil or liveCount % AI_EVERY_LIVES == 0 then
        lastAi = scanAi(now, playerPawns) or lastAi
    end
    -- The server's own tick rate, for the panel's performance page.
    readyLive = { t = now, players = players, ai = lastAi, fps = gameStateNumber("ServerFPS") }
end

local function snapshotOnce()
    local now   = os.time()
    local seen  = {}
    local snaps = {}

    H.forEachPlayer(function(ctrl)
        -- H.forEachPlayer pcalls this callback, so one bad player cannot
        -- kill the whole loop.
        local id = H.safeSteamId(ctrl)
        if not id then return end
        seen[id] = true

        local name = playerNameOf(ctrl) or names[id]
        names[id] = name

        if sessions[id] == nil then
            sessions[id] = { start = now }
            queue({ type = "session_start", steamId = id, name = name })
        end

        -- No pawn: in the spawn menu, or between death and respawn.
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then
            lostPawn(id, name)
            return
        end
        local snap = {
            type    = "snapshot",
            steamId = id,
            name    = name,
            species = speciesOf(pawn),
            health  = vital(pawn, "health"),
            stamina = vital(pawn, "stamina"),
            hunger  = vital(pawn, "hunger"),
            thirst  = vital(pawn, "thirst"),
            oxygen  = vital(pawn, "oxygen"),
            blood   = vital(pawn, "blood"),
            growth  = vital(pawn, "growth"),
            max     = maxima(pawn),
            loc     = locationOf(pawn),
            yaw     = yawOf(pawn),
            ping    = pingOf(ctrl),
        }
        snaps[#snaps + 1] = snap

        checkLife(id, name, pawn, snap)
    end)

    -- Players who left: close the session and forget them, so the tables do
    -- not grow without bound.
    for id, s in pairs(sessions) do
        if not seen[id] then
            queue({
                type     = "session_end",
                steamId  = id,
                name     = names[id],
                species  = life[id] and life[id].species or nil,
                duration = now - s.start,
            })
            sessions[id], life[id], recentHits[id], names[id] = nil, nil, nil, nil
        end
    end

    -- No file I/O here: this runs on the game thread. Hand the snapshots to
    -- the async tick, which writes them after the events queued above.
    for _, snap in ipairs(snaps) do readySnaps[#readySnaps + 1] = snap end
end

-- DinoGarage's "store" step calls SetHealth(0), which this loop reports as a
-- death like any other. The bridge correlates it with the garage_store event
-- and labels it, so no cross-mod coupling is needed here.

--------------------------------------------------------------------------
-- Threads: read on the game thread, write on the async one
--------------------------------------------------------------------------
-- LoopAsync runs on UE4SS's async thread, where touching a UObject can crash
-- the server (AGENTS.md, docs/lua-safety-rules.md). So the async tick never
-- reads the game: every TICK_MS it writes whatever is queued.
--
-- The reads run in ONE game-thread loop (H.every → LoopInGameThreadWithDelay):
-- the live state every second, a snapshot every SNAPSHOT_SECONDS. It used to
-- be the async tick queuing ExecuteInGameThread for each read; on the
-- server's UE4SS two of those callbacks were lost ("Ref was not function",
-- 2026-09-24 11:06 UTC) and their "still queued" flags stopped every read
-- for good, the map lost everyone while they were still playing.

local TICK_MS = 500
local SNAPSHOT_EVERY_LIVES = math.floor(SNAPSHOT_SECONDS * 1000 / LIVE_EVERY_MS)
local lives = 0

local function writeQueued()
    -- Events first: a death and the snapshot that revealed it carry the same
    -- timestamp, and consumers should see the death before the corpse.
    flush()
    if #readySnaps > 0 then
        local batch = readySnaps
        readySnaps = {}
        Events.emitManyTo("snapshots", batch)
    end
    if readyLive then
        local live = readyLive
        readyLive = nil
        Events.writeLatest(LIVE_FILE, live)
    end
end

LoopAsync(TICK_MS, function()
    H.try(MOD .. ": write", writeQueued)
    return false   -- keep looping
end)

H.every(LIVE_EVERY_MS, MOD .. ": read", function()
    lives = lives + 1
    if lives >= SNAPSHOT_EVERY_LIVES then
        lives = 0
        H.try(MOD .. ": snapshot", snapshotOnce)
    end
    H.try(MOD .. ": live", liveOnce)
end)

-- The world AI spawner's fish numbers, once, two minutes after load: tells
-- whether the Game.ini [/Script/TheIsle.TIAIWorldSpawner] lines (panel → AI)
-- are taken. Numbers only, reading them is safe; a Lua WRITE there crashed
-- the server (docs/lua-safety-rules.md).
H.defer(120000, function()
    local okA, all = pcall(function() return FindAllOf("TIAIWorldSpawner") or {} end)
    local ws = okA and all[1] or nil
    if ws == nil or not H.isValid(ws) then H.log(MOD .. ": spawner: not found"); return end
    local function num(k)
        local ok, v = pcall(function() return ws[k] end)
        return ok and type(v) == "number" and v or nil
    end
    local row = { type = "spawner", t = os.time(), fishPerPlayer = num("MaxAmbientFishPerPlayer"),
        fishPerWater = num("AmbientFishSoftLimitPerWater"), attempts = num("AmbientFishSpawnAttemptsPerPlayer"),
        cooldown = num("AmbientFishSpawnCooldown") }
    H.log(string.format("%s: spawner: fish per player %s, per water %s, attempts %s, cooldown %s", MOD,
        tostring(row.fishPerPlayer), tostring(row.fishPerWater), tostring(row.attempts), tostring(row.cooldown)))
    queue(row)
end)

H.log(MOD .. ": loaded, writing " .. Events.STREAMS.events.path
    .. " and " .. Events.STREAMS.snapshots.path)
Events.emit({ type = "mod_loaded", mod = MOD })
