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
    that way — if a feature needs to change the world, it belongs in another mod.

    Threads (docs/lua-safety-rules.md):
      * game thread  — hooks, and the snapshot read every SNAPSHOT_SECONDS
                       (ExecuteInGameThread). These only read and queue.
      * async thread — the 1s LoopAsync tick. It only writes queued lines to
                       disk and never touches a UObject.
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
-- once in ue4ss/UE4SS.log, never a crash. Confirm them with the UE4SS Live
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

--------------------------------------------------------------------------
-- Reads (all pcall-guarded, all return nil on failure)
--------------------------------------------------------------------------

--- Class name of a pawn, or "unknown". pcall returns (ok, value), and on
-- failure the second value is the error message — so check ok explicitly.
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

--- World position in UE units (cm), rounded — sub-centimetre precision is
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

local function steamIdOfPawn(pawn)
    local ok, ctrl = pcall(function() return pawn.Controller end)
    if not ok then return nil end
    return H.safeSteamId(ctrl)
end

--------------------------------------------------------------------------
-- Queue — hooks append here, the tick flushes
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

RegisterHook("/Script/TheIsle.TICharacterBase:ApplyDamage",
function(selfParam, targetParam, amountParam)
    H.try(MOD .. ": ApplyDamage", function()
        local attacker = selfParam and selfParam:get()
        local target   = targetParam and targetParam:get()
        if not H.isValid(attacker) or not H.isValid(target) then return end

        local amount
        if amountParam then
            local got, v = pcall(function() return amountParam:get() end)
            if got then amount = tonumber(v) end
        end

        -- A pawn's controller is how we reach a SteamID. Missing controller
        -- means AI, so we record the side we can identify and mark the other.
        local attackerId = steamIdOfPawn(attacker)
        local victimId   = steamIdOfPawn(target)
        local attackerSpecies = speciesOf(attacker)
        local victimSpecies   = speciesOf(target)

        -- Only a hit with an identifiable player behind it can explain a
        -- death later. Recording an unattributable one would overwrite a real
        -- killer and turn an attributed death into an anonymous one.
        if victimId and attackerId then
            recentHits[victimId] = {
                by      = attackerId,
                species = attackerSpecies,
                growth  = tonumber(H.readField(attacker, VITALS.growth, "growth")),
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
            loc             = locationOf(target),
        })
    end)
end)

--------------------------------------------------------------------------
-- Chat — the shared hook already deduplicates and defers out of the hook
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
-- Snapshot loop — the only way to see deaths, spawns and sessions
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
        queue({
            type      = "spawn",
            steamId   = id,
            name      = name,
            species   = snap.species,
            classPath = classPathOf(pawn),
            growth    = snap.growth,
            mutations = muts,
            loc       = snap.loc,
        })
        life[id] = {
            species   = snap.species,
            health    = health,
            growth    = snap.growth,
            spawnedAt = now,
            mutations = muts,
        }
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

    prev.health = health
    if g1 ~= nil then prev.growth = g1 end
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
        if not pawn then return end

        local snap = {
            type    = "snapshot",
            steamId = id,
            name    = name,
            species = speciesOf(pawn),
            health  = tonumber(H.readField(pawn, VITALS.health,  "health")),
            stamina = tonumber(H.readField(pawn, VITALS.stamina, "stamina")),
            hunger  = tonumber(H.readField(pawn, VITALS.hunger,  "hunger")),
            thirst  = tonumber(H.readField(pawn, VITALS.thirst,  "thirst")),
            oxygen  = tonumber(H.readField(pawn, VITALS.oxygen,  "oxygen")),
            blood   = tonumber(H.readField(pawn, VITALS.blood,   "blood")),
            growth  = tonumber(H.readField(pawn, VITALS.growth,  "growth")),
            loc     = locationOf(pawn),
            yaw     = yawOf(pawn),
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
-- reads the game: every TICK_MS it writes whatever is queued, and every
-- SNAPSHOT_SECONDS it asks the game thread to take one snapshot.

local TICK_MS = 1000
local READ_EVERY_TICKS = math.floor(SNAPSHOT_SECONDS * 1000 / TICK_MS)
local ticks = 0
local readQueued = false   -- a snapshot is waiting on the game thread

local function writeQueued()
    -- Events first: a death and the snapshot that revealed it carry the same
    -- timestamp, and consumers should see the death before the corpse.
    flush()
    if #readySnaps > 0 then
        local batch = readySnaps
        readySnaps = {}
        Events.emitManyTo("snapshots", batch)
    end
end

LoopAsync(TICK_MS, function()
    H.try(MOD .. ": write", writeQueued)

    ticks = ticks + 1
    if ticks >= READ_EVERY_TICKS and not readQueued then
        ticks = 0
        -- Never stack reads: if the game thread is slow, skip rather than
        -- queue a backlog of snapshots behind it.
        readQueued = H.onGameThread(MOD .. ": snapshot", function()
            readQueued = false
            snapshotOnce()
        end)
    end
    return false   -- keep looping
end)

H.log(MOD .. ": loaded, writing " .. Events.STREAMS.events.path
    .. " and " .. Events.STREAMS.snapshots.path)
Events.emit({ type = "mod_loaded", mod = MOD })
