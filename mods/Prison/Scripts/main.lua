-- Prison — a rule breaker serves time on the island, in a zone the admin
-- draws (panel → Bản đồ: an AI zone ticked "Nhà tù"; sentences from panel →
-- Người chơi → Bỏ tù; bridge/src/prison.ts owns them).
--
--   Mods/Prison/Saved/prison.json   written by the bridge: the zone, the spots
--                                   to drop inmates on (ground points inside
--                                   it, with their height), the sting for
--                                   outsiders, the admins (exempt), and the
--                                   sentences: { steamId: { id, total, release } }
--   Mods/Prison/Saved/state.json    written here: per sentence, the time
--                                   served, escaped or not, the arrest spot,
--                                   done — the bridge reads it
--
-- An inmate (a SteamID with a sentence — not a dino: a new dino of theirs
-- goes in too):
--   * a fresh dino of theirs (SETTLE_S after it appears) is moved to a drop
--     spot; the first time, where it stood is kept: it goes back there when
--     the sentence ends
--   * growth, stomach, thirst, nutrients and the prime tasks stay as they
--     were when it was moved in (re-set when they drift; growth first, then
--     the vitals, since SetGrowth refills them — restore.lua rule 1)
--   * inside the zone its health cannot go down (put back every tick) and
--     the sentence runs; outside it the sentence stops and health is not
--     held — an "escape": one event when it walks out, one when it comes
--     back (the bridge announces, shows it on the map, credits whoever kills it)
--   * it may not sleep: a dino that falls asleep is woken up (and told why)
--   * offline, dead or in the species screen: nothing runs
--   * when the time is served (or the bridge says release) the dino is put
--     back where it was arrested, if it is still in the prison
-- An escaped inmate brought down (the admin's choice, cfg.caught.mode):
--   * "teleport": once its health falls to `pct`% of its max it does not die:
--     it is put back in the prison with the health it escaped with ("caught")
--   * "respawn": it dies; the next dino the player spawns as the SAME species is
--     made into the dino they had (the garage's own capture / restore: growth,
--     mutations, prime, skin…) and put back in the prison. A one-shot kill in
--     "teleport" mode ends the same way.
--   The bridge credits whoever brought it down (prison_caught / death events).
-- A player who is not an inmate (nor an admin) in the zone is warned, then
-- stung like ZoneGuard's bees.
--
-- Safety (docs/lua-safety-rules.md): all on the game thread (H.every), every
-- pawn re-resolved from its controller each tick (only SteamIDs and pawn
-- addresses are kept, never a pawn), every engine call in pcall.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
-- The garage's capture / restore (an escaped inmate's dino made again: "respawn").
if not package.path:find("Mods/DinoGarage/Scripts/?.lua", 1, true) then
    package.path = package.path .. ";Mods/DinoGarage/Scripts/?.lua"
end

local H      = require("shared.isle.helpers")
local json   = require("shared.isle.json")
local Msg    = require("shared.isle.messages")
local Events = require("shared.isle.events")

local MOD = "Prison"
local DIR = "Mods/Prison/Saved/"
local CONFIG_PATH = DIR .. "prison.json"
local STATE_PATH  = DIR .. "state.json"
local TICK_MS = 1000
local RELOAD_S = 5
local SETTLE_S = 3          -- a new dino settles before it is moved (as the garage waits)
local ESCAPE_GRACE_S = 6    -- after a move the location read may still be the old one
local LIFT = 100            -- cm above the drop spot / arrest spot
local SAVE_EVERY_S = 5
local PRIME_EVERY_S = 5
local NUTRIENTS_EVERY_S = 10
local FORGET_S = 300        -- a sentence the bridge no longer lists: its state kept this long
local REENTER_S = 60        -- an outsider back in the zone within this keeps its sting clock
local WAKE_FORCE_S = 3      -- still asleep this long after WakeUp: the flag is cleared directly
local SLEEP_NOTIFY_S = 30   -- "no sleeping" told at most this often

--------------------------------------------------------------------------
-- Config (written by the bridge; decoded only when it changed)
--------------------------------------------------------------------------

local OFF = { enabled = false, zone = nil, drops = {}, exempt = {}, sentences = {}, sting = { grace = 10, every = 3, pct = 10 },
    caught = { mode = "teleport", pct = 20 } }
local cfg, cfgRaw, cfgAt = OFF, nil, nil

local function num(v, lo, hi, default)
    local n = tonumber(v)
    if n == nil then return default end
    return math.max(lo, math.min(hi, n))
end

local function readConfig()
    local now = os.time()
    if cfgAt ~= nil and now - cfgAt < RELOAD_S then return cfg end
    cfgAt = now
    local f = io.open(CONFIG_PATH, "r")
    if not f then cfg, cfgRaw = OFF, nil; return cfg end
    local raw = f:read("*a")
    f:close()
    if raw == cfgRaw then return cfg end
    local ok, d = pcall(json.decode, raw or "")
    if not ok or type(d) ~= "table" then return cfg end   -- a torn file: keep the last
    cfgRaw = raw
    local zone = nil
    local z = d.zone
    if type(z) == "table" and tonumber(z.x) and tonumber(z.y) and tonumber(z.radius) then
        zone = { name = tostring(z.name or "?"), x = tonumber(z.x), y = tonumber(z.y), radius = tonumber(z.radius),
            poly = (type(z.poly) == "table" and #z.poly >= 3) and z.poly or nil }
    end
    local drops = {}
    for _, p in ipairs(type(d.drops) == "table" and d.drops or {}) do
        if type(p) == "table" and tonumber(p[1]) and tonumber(p[2]) and tonumber(p[3]) then
            drops[#drops + 1] = { x = tonumber(p[1]), y = tonumber(p[2]), z = tonumber(p[3]) }
        end
    end
    local exempt = {}
    for _, id in ipairs(type(d.exempt) == "table" and d.exempt or {}) do exempt[tostring(id)] = true end
    local sentences = {}
    for sid, s in pairs(type(d.sentences) == "table" and d.sentences or {}) do
        if type(s) == "table" and type(s.id) == "string" and tonumber(s.total) then
            sentences[tostring(sid)] = { id = s.id, total = tonumber(s.total), release = s.release == true }
        end
    end
    local st = type(d.sting) == "table" and d.sting or {}
    local ca = type(d.caught) == "table" and d.caught or {}
    cfg = {
        enabled = d.enabled == true and zone ~= nil,
        zone = zone, drops = drops, exempt = exempt, sentences = sentences,
        sting = { grace = num(st.grace, 0, 600, 10), every = num(st.every, 1, 60, 3), pct = num(st.pct, 1, 100, 10) },
        caught = { mode = ca.mode == "respawn" and "respawn" or "teleport", pct = num(ca.pct, 1, 90, 20) },
    }
    return cfg
end

--------------------------------------------------------------------------
-- State (this mod's; survives a restart)
--------------------------------------------------------------------------

local state = { sentences = {} }
do
    local f = io.open(STATE_PATH, "r")
    if f then
        local ok, d = pcall(json.decode, f:read("*a") or "")
        f:close()
        if ok and type(d) == "table" and type(d.sentences) == "table" then state.sentences = d.sentences end
    end
end
local dirty, savedAt = false, 0

local function saveState(now)
    if not dirty or now - savedAt < SAVE_EVERY_S then return end
    savedAt = now
    state.t = now
    local okE, text = pcall(json.encode, state)
    if not okE then H.logError(MOD .. ": state encode failed"); return end
    local tmp = STATE_PATH .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then H.logError(MOD .. ": cannot write " .. tmp); return end
    f:write(text)
    f:close()
    os.remove(STATE_PATH)
    os.rename(tmp, STATE_PATH)
    dirty = false
end

local function stateOf(id)
    local st = state.sentences[id]
    if st == nil then
        st = { served = 0, escapes = 0, jailed = 0 }
        state.sentences[id] = st
        dirty = true
    end
    return st
end

--------------------------------------------------------------------------
-- Engine reads and writes (game thread)
--------------------------------------------------------------------------

local function call(pawn, fn)
    local ok, v = pcall(function() return pawn[fn](pawn) end)
    return ok and type(v) == "number" and v or nil
end

local function set(pawn, fn, v)
    if v == nil then return false end
    return pcall(function() pawn[fn](pawn, v) end)
end

local function addressOf(pawn)
    local ok, a = pcall(function() return pawn:GetAddress() end)
    return ok and a or nil
end

local function locOf(pawn)
    local ok, v = pcall(function() return pawn:K2_GetActorLocation() end)
    if ok and v and type(v.X) == "number" then return v.X, v.Y, v.Z end
    return nil
end

--- "BP_Carnotaurus_C" -> "Carnotaurus"
local function speciesOf(pawn)
    local ok, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    if not ok or n == nil then return nil end
    local cls = tostring(n):match("([%w_]+)$") or tostring(n)
    return (cls:gsub("^BP_", ""):gsub("_C$", ""))
end

local function classPathOf(pawn)
    local ok, n = pcall(function() return pawn:GetClass():GetFullName() end)
    return ok and n ~= nil and tostring(n) or nil
end

--- The garage's capture / restore modules (DinoGarage), loaded once; nil when unavailable.
local garageMods = nil
local function garage()
    if garageMods == nil then
        local okC, C = pcall(require, "garage.capture")
        local okR, R = pcall(require, "garage.restore")
        if okC and okR and type(C) == "table" and type(R) == "table" then
            garageMods = { capture = C, restore = R }
        else
            garageMods = false
            H.logError(MOD .. ": the garage's capture / restore did not load — a dead escaper will not be made again")
        end
    end
    return garageMods or nil
end

local function teleport(pawn, p)
    local ok, moved = pcall(function()
        return pawn:K2_SetActorLocation({ X = p.x, Y = p.y, Z = p.z + LIFT }, false, {}, true)
    end)
    return ok and moved ~= false
end

local function inPoly(poly, x, y)
    local inside = false
    local j = #poly
    for i = 1, #poly do
        local xi, yi = tonumber(poly[i][1]), tonumber(poly[i][2])
        local xj, yj = tonumber(poly[j][1]), tonumber(poly[j][2])
        if xi and yi and xj and yj and ((yi > y) ~= (yj > y)) and x < (xj - xi) * (y - yi) / (yj - yi) + xi then
            inside = not inside
        end
        j = i
    end
    return inside
end

local function inZone(zone, x, y)
    if zone == nil or x == nil then return false end
    local dx, dy = x - zone.x, y - zone.y
    return dx * dx + dy * dy <= zone.radius * zone.radius and (zone.poly == nil or inPoly(zone.poly, x, y))
end

--- What stays as it was while jailed.
local function capture(pawn)
    local f = { growth = call(pawn, "GetGrowth"), hunger = call(pawn, "GetHunger"), thirst = call(pawn, "GetThirst"),
        prime = {}, nutrients = {} }
    pcall(function()
        local data = pawn.EligiblePrimeElderData
        for i = 1, 10 do
            local v = data["bPrimeCondition" .. i]
            if type(v) == "boolean" then f.prime[i] = v end
        end
        local e = data.bIsEligiblePrime
        if type(e) == "boolean" then f.prime.eligible = e end
    end)
    pcall(function()
        local struct = pawn.NutrientsStruct
        for _, name in ipairs(H.structFields(struct)) do
            local v = struct[name]
            if type(v) == "number" then f.nutrients[name] = v end
        end
    end)
    return f
end

--- Put back what drifted since the capture.
local function freeze(pawn, run, now)
    local f = run.frozen
    if f == nil then return end
    local g = call(pawn, "GetGrowth")
    if g and f.growth and g > f.growth + 0.0005 then
        if set(pawn, "SetGrowth", f.growth) then
            -- SetGrowth refills the vitals: the stomach, thirst and health go back too.
            set(pawn, "SetHunger", f.hunger)
            set(pawn, "SetThirst", f.thirst)
            set(pawn, "SetHealth", run.lockHp)
        end
    end
    local h = call(pawn, "GetHunger")
    if h and f.hunger and math.abs(h - f.hunger) > 0.05 then set(pawn, "SetHunger", f.hunger) end
    local w = call(pawn, "GetThirst")
    if w and f.thirst and math.abs(w - f.thirst) > 0.05 then set(pawn, "SetThirst", f.thirst) end

    if now - (run.primeAt or 0) >= PRIME_EVERY_S then
        run.primeAt = now
        pcall(function()
            local data = pawn.EligiblePrimeElderData
            for i = 1, 10 do
                if f.prime[i] == false and data["bPrimeCondition" .. i] == true then data["bPrimeCondition" .. i] = false end
            end
            if f.prime.eligible == false and data.bIsEligiblePrime == true then data.bIsEligiblePrime = false end
        end)
    end
    if now - (run.nutrientsAt or 0) >= NUTRIENTS_EVERY_S and next(f.nutrients) ~= nil then
        run.nutrientsAt = now
        pcall(function()
            local struct = pawn.NutrientsStruct
            local changed = false
            for name, v in pairs(f.nutrients) do
                local cur = struct[name]
                if type(cur) == "number" and math.abs(cur - v) > 0.5 then struct[name] = v; changed = true end
            end
            if changed then pawn:SetNutrientsStruct(struct, true) end
        end)
    end
end

--------------------------------------------------------------------------
-- No sleeping in prison
--------------------------------------------------------------------------

local sleepChecked = false

--- pawn.bIsSleeping (the game's flag; AS_Sleeping is its action state), or nil when it cannot be read.
local function isAsleep(pawn)
    local ok, v = pcall(function() return pawn.bIsSleeping end)
    if ok and type(v) == "boolean" then return v end
    return nil
end

local function noSleep(ctrl, id, pawn, run, now)
    local asleep = isAsleep(pawn)
    if not sleepChecked then
        -- Once per run, to see in the log that the flag reads on the live dinos.
        sleepChecked = true
        H.log(string.format("%s: sleep check — bIsSleeping on %s reads %s", MOD, tostring(speciesOf(pawn)), tostring(asleep)))
    end
    if asleep ~= true then run.asleepSince = nil; return end
    local first = run.asleepSince == nil
    run.asleepSince = run.asleepSince or now
    local woke = pcall(function() pawn:WakeUp() end)
    if not woke or now - run.asleepSince >= WAKE_FORCE_S then
        pcall(function() pawn.bIsSleeping = false end)
    end
    if first then
        H.log(string.format("%s: %s fell asleep in prison — WakeUp %s", MOD, id, woke and "called" or "failed"))
    end
    if ctrl and now - (run.sleepToldAt or 0) >= SLEEP_NOTIFY_S then
        run.sleepToldAt = now
        Msg.notify(ctrl, "prison.noSleep", "Đang ở tù: không được ngủ.")
    end
end

--------------------------------------------------------------------------
-- Inmates
--------------------------------------------------------------------------

local live = {}          -- SteamID -> { addr, pending, firstSeen, jailedAt, lastTick, frozen, lockHp, … } (no pawn kept)
local dropTurn = 0
local warnedNoDrop = false

local function remaining(sen, st)
    return sen.total - (st.served or 0)
end

local function jail(id, pawn, sen, st, run, addr, hp, now, c)
    if #c.drops == 0 then
        if not warnedNoDrop then
            warnedNoDrop = true
            H.logError(MOD .. ": no drop spot in the prison zone yet — walk inside it once (ground points)")
        end
        return
    end
    local x, y, z = locOf(pawn)
    if st.arrest == nil and x then st.arrest = { x = x, y = y, z = z } end
    -- The dino as it is when first jailed: made again if it dies on the run.
    if st.dino == nil then
        local G = garage()
        local okS, snap = pcall(function() return G and G.capture.capture(pawn) or nil end)
        if okS and type(snap) == "table" then snap.location, snap.rotation = nil, nil; st.dino = snap end
    end
    dropTurn = dropTurn % #c.drops + 1
    if not teleport(pawn, c.drops[dropTurn]) then
        H.logError(MOD .. ": could not move " .. id .. " to the prison")
        return
    end
    run.addr, run.jailedAt, run.lastTick = addr, now, now
    run.frozen = capture(pawn)
    run.lockHp = hp
    st.jailed = (st.jailed or 0) + 1
    st.escaped, st.inside = false, true
    dirty = true
    Events.emit({ type = "prison_jailed", steamId = id, id = sen.id, again = st.jailed > 1, species = speciesOf(pawn) })
    H.log(string.format("%s: %s jailed (%s, %d s left)", MOD, id, sen.id, math.floor(remaining(sen, st))))
end

local function release(id, pawn, sen, st, c)
    local x, y = locOf(pawn)
    if st.arrest ~= nil and inZone(c.zone, x, y) then teleport(pawn, st.arrest) end
    st.done, st.escaped, st.inside = true, false, false
    dirty = true
    live[id] = nil
    Events.emit({ type = "prison_released", steamId = id, id = sen.id, early = sen.release == true, served = math.floor(st.served or 0) })
    H.log(string.format("%s: %s released (%s)", MOD, id, sen.id))
end

--- A dead escaper's next dino (same species): made into the one they had, in the prison.
local function recreate(id, pawn, sen, st, run, addr, now, c)
    local G = garage()
    dropTurn = dropTurn % #c.drops + 1
    if not teleport(pawn, c.drops[dropTurn]) then return false end
    run.addr, run.jailedAt, run.lastTick, run.restoring = addr, now, now, true
    st.recreate, st.escaped, st.inside = false, false, true
    st.jailed = (st.jailed or 0) + 1
    dirty = true
    G.restore.apply(pawn, st.dino, function(ok)
        run.restoring = nil
        if H.isValid(pawn) then
            run.frozen = capture(pawn)
            run.lockHp = call(pawn, "GetHealth")
        end
        Events.emit({ type = "prison_recreated", steamId = id, id = sen.id, ok = ok == true, species = speciesOf(pawn) })
        H.log(string.format("%s: %s's dino made again in the prison (%s)", MOD, id, tostring(ok)))
    end)
    return true
end

--- An escaper brought low ("teleport" mode): back in the prison, not dead.
local function catchEscaper(id, pawn, sen, st, run, now, c, mx)
    dropTurn = dropTurn % #c.drops + 1
    if not teleport(pawn, c.drops[dropTurn]) then return end
    local hp = math.max(st.escapeHp or 0, mx * c.caught.pct / 100)
    set(pawn, "SetHealth", hp)
    run.lockHp, run.jailedAt, run.lastTick = hp, now, now
    st.escaped, st.inside = false, true
    dirty = true
    Events.emit({ type = "prison_caught", steamId = id, id = sen.id, species = speciesOf(pawn) })
    H.log(string.format("%s: %s caught and put back in the prison", MOD, id))
end

local function handleInmate(ctrl, id, pawn, sen, now, c)
    local st = stateOf(sen.id)
    if st.done then return end
    st.missingSince = nil
    local hp = call(pawn, "GetHealth")
    local run = live[id]
    if run == nil then run = {}; live[id] = run end
    if hp ~= nil and hp <= 0 then
        -- Died on the run: the next dino of that species is made into this one.
        if st.escaped and run.addr ~= nil and st.dino ~= nil and not st.recreate then
            st.recreate = true
            dirty = true
            Events.emit({ type = "prison_died", steamId = id, id = sen.id, species = st.dino.classPath and tostring(st.dino.classPath):match("([%w_]+)$") or nil })
            H.log(string.format("%s: %s died on the run — the next %s is made again", MOD, id, tostring(st.dino.classPath)))
        end
        -- A corpse: the next dino goes in again.
        run.addr, run.pending = nil, nil
        if st.inside then st.inside = false; dirty = true end
        return
    end
    local addr = addressOf(pawn)
    if run.addr ~= addr then
        if run.pending ~= addr then run.pending, run.firstSeen = addr, now; return end
        if now - run.firstSeen < SETTLE_S then return end
        if sen.release or remaining(sen, st) <= 0 then release(id, pawn, sen, st, c); return end
        if st.recreate and st.dino ~= nil and #c.drops > 0 and garage() ~= nil and classPathOf(pawn) == st.dino.classPath then
            if recreate(id, pawn, sen, st, run, addr, now, c) then return end
        end
        if st.recreate then st.recreate = false; dirty = true end   -- another species: that one goes in as it is
        jail(id, pawn, sen, st, run, addr, hp, now, c)
        return
    end
    if run.restoring then return end
    if sen.release or remaining(sen, st) <= 0 then release(id, pawn, sen, st, c); return end

    local x, y = locOf(pawn)
    if x then st.loc = { x = math.floor(x), y = math.floor(y) } end
    local inside = inZone(c.zone, x, y) or now - run.jailedAt < ESCAPE_GRACE_S
    local dt = math.max(0, math.min(5, now - (run.lastTick or now)))
    run.lastTick = now
    if inside then
        if st.escaped then
            st.escaped = false
            Events.emit({ type = "prison_returned", steamId = id, id = sen.id })
            H.log(string.format("%s: %s is back in the prison", MOD, id))
        end
        -- Health cannot go down inside; it may come up (and is held there).
        if hp ~= nil and run.lockHp ~= nil and hp < run.lockHp - 0.5 then set(pawn, "SetHealth", run.lockHp)
        elseif hp ~= nil then run.lockHp = hp end
        st.served = (st.served or 0) + dt
    else
        if st.escaped and c.caught.mode == "teleport" and hp ~= nil then
            local mx = call(pawn, "GetMaxHealth")
            if mx and mx > 0 and hp > 0 and hp <= mx * c.caught.pct / 100 then
                catchEscaper(id, pawn, sen, st, run, now, c, mx)
                return
            end
        end
        if not st.escaped then
            st.escaped = true
            st.escapeHp = hp
            st.escapes = (st.escapes or 0) + 1
            Events.emit({ type = "prison_escape", steamId = id, id = sen.id, x = st.loc and st.loc.x, y = st.loc and st.loc.y,
                species = speciesOf(pawn), escapes = st.escapes })
            H.log(string.format("%s: %s escaped (%d)", MOD, id, st.escapes))
        end
        run.lockHp = hp
    end
    st.inside = inside
    dirty = true
    freeze(pawn, run, now)
    noSleep(ctrl, id, pawn, run, now)
end

--------------------------------------------------------------------------
-- Outsiders in the prison: stung
--------------------------------------------------------------------------

local stings = {}   -- SteamID -> { since, stungAt, leftAt }

local function handleOutsider(ctrl, id, pawn, now, c)
    if c.exempt[id] then stings[id] = nil; return end
    local hp = call(pawn, "GetHealth")
    if hp ~= nil and hp <= 0 then stings[id] = nil; return end
    local x, y = locOf(pawn)
    local s = stings[id]
    if not inZone(c.zone, x, y) then
        if s then
            s.leftAt = s.leftAt or now
            if now - s.leftAt > REENTER_S then stings[id] = nil end
        end
        return
    end
    if s == nil or (s.leftAt and now - s.leftAt > REENTER_S) then
        stings[id] = { since = now }
        Msg.notify(ctrl, "prison.sting.warn", "Đây là khu nhà tù — rời khỏi trong {seconds} giây, nếu không sẽ bị ong đốt!",
            { seconds = math.floor(c.sting.grace) })
        return
    end
    s.leftAt = nil
    if now - s.since < c.sting.grace then return end
    if s.stungAt and now - s.stungAt < c.sting.every then return end
    local mx = call(pawn, "GetMaxHealth")
    if hp == nil or mx == nil or mx <= 0 then return end
    if not set(pawn, "SetHealth", math.max(0, hp - mx * c.sting.pct / 100)) then return end
    if not s.stungAt then
        Msg.notify(ctrl, "prison.sting", "Bạn đang bị ong đốt ở khu nhà tù — mất {pct}% máu mỗi {every} giây cho tới khi rời đi.",
            { pct = math.floor(c.sting.pct), every = math.floor(c.sting.every) })
    end
    s.stungAt = now
end

--------------------------------------------------------------------------
-- The tick
--------------------------------------------------------------------------

local function tick()
    local c = readConfig()
    local now = os.time()
    if c.enabled then
        local seen = {}
        H.forEachPlayer(function(ctrl)
            local id = H.safeSteamId(ctrl)
            local pawn = id and H.livePawnFromCtrl(ctrl)
            if not pawn then return end
            seen[id] = true
            local sen = c.sentences[id]
            if sen then handleInmate(ctrl, id, pawn, sen, now, c) else handleOutsider(ctrl, id, pawn, now, c) end
        end)
        for id in pairs(stings) do if not seen[id] then stings[id] = nil end end
        -- Offline inmates: the clock stops (the next tick of theirs starts a fresh dt).
        for id, run in pairs(live) do
            if not seen[id] then run.lastTick = nil end
            if c.sentences[id] == nil then live[id] = nil end
        end
        for sid, sen in pairs(c.sentences) do
            local st = state.sentences[sen.id]
            if st and st.inside and not seen[sid] then st.inside = false; dirty = true end
        end
    end
    -- Sentences the bridge no longer lists (moved to its history): forgotten after a while.
    local listed = {}
    for _, sen in pairs(c.sentences) do listed[sen.id] = true end
    for sid, st in pairs(state.sentences) do
        if not listed[sid] and c ~= OFF then
            if st.missingSince == nil then st.missingSince = now; dirty = true end
            if now - st.missingSince > FORGET_S then state.sentences[sid] = nil; dirty = true end
        end
    end
    saveState(now)
end

H.every(TICK_MS, MOD .. " tick", tick)
H.log(MOD .. ": loaded — config from " .. CONFIG_PATH)
Events.emit({ type = "mod_loaded", mod = MOD })
