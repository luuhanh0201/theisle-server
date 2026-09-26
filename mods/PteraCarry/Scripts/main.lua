-- PteraCarry — a Pteranodon carries another player's dino, up to a weight the
-- admin sets (panel → Server → Cấu hình → Ptera gắp).
--
-- The game (Evrima 0.21) lets a Pteranodon carry only small critters and
-- hatchlings. What it does have, found by probing this server (2026-09-26,
-- the probe is in git history, commit 764c3e6): flying close to a dino and
-- holding Z + right mouse (the latch key, while the game's interaction
-- prompt shows) makes the game call
-- TICharacterBase:GrabPhysicsCharacter(ptera, that dino) — and let go ten
-- seconds later without moving it — but only for AI (a player's dino never
-- got that call when tried on 2026-09-26 01:30). So the grab is the key
-- itself: Z + right mouse starts the Gameplay Ability "TIGameplayAbilityTryLatch"
-- (AbilitySystemComponent:ServerTryActivateAbility / ServerSetInputPressed
-- with its handle). When a flying Pteranodon's player does that:
--
--   * the nearest other player's dino within `grabMeters`, no heavier than
--     `maxKg` (its GetWeight), is taken (the game's own grab call, when it
--     happens, is taken too) — unless the carrier is cooling down
--   * every HOLD_MS, on the game thread, the target is put right under the
--     Pteranodon's feet — its top `belowCm` below the carrier's capsule
--     bottom (both capsule half-heights read live), facing the same way
--     (K2_SetActorLocationAndRotation, teleport — as !unstuck does) — and
--     given the carrier's velocity (LaunchCharacter), so it moves with it
--     between two updates instead of hanging back; the game's own "being
--     picked up" flag is set (SetIsBeingPickedUp) so its player cannot walk off
--   * it ends when the Pteranodon lands, its player types !drop, after
--     `maxSeconds`, or when either leaves / dies. Let go in the air, the
--     target falls — and takes the game's fall damage
--   * a flying Pteranodon near a light enough player is told it can grab —
--     a server message (a mod cannot draw the game's own prompt), OFF by
--     default like every carry message (the popup did not suit; the admin
--     turns one on in the panel's Thông báo)
--   * the game's own prompt (Z + right mouse, like "hold E to eat") shows for
--     AI only. Whether its "can be picked up" flag is what keeps players out:
--     every FLAGS_EVERY_S while players are online (FLAGS_RUNS times), the flags bBlockPickUp /
--     bBeingPickedUp (two booleans, read-only) are logged once per species,
--     player and AI apart — "PteraCarry flags:" in UE4SS.log
--
-- Safety (docs/lua-safety-rules.md): the hook only queues the two addresses;
-- everything else runs on the game thread, re-resolving both players by
-- SteamID each tick (no pawn kept across ticks), every call in pcall.
-- Never GetCDO(): reading class defaults crashed this server (00:36).

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")
local Msg  = require("shared.isle.messages")

local MOD = "PteraCarry"
local SETTINGS_PATH = "Mods/PteraCarry/Saved/settings.json"
local GRAB_HOOK = "/Script/TheIsle.TICharacterBase:GrabPhysicsCharacter"
local PTERA = "BP_Pteranodon_C"
local HOLD_MS = 50           -- how often a carried dino is put back under its carrier
local HINT_MS = 1000         -- how often flying Pteranodons look for something to grab
local HINT_AGAIN_S = 30      -- one hint per carrier and target this often
local SETTINGS_RELOAD_S = 5
local FLAGS_EVERY_S = 300    -- the pick-up flags census (read-only), while players are online
local FLAGS_MAX_PAWNS = 400
local FLAGS_RUNS = 0          -- done (2026-09-26): players have bBlockPickUp=false too, like AI — not what hides the prompt
local MIN_CARRY_S = 1        -- a carrier "landing" in the first second is the take-off itself

local ASC_CLASS = "/Script/GameplayAbilities.AbilitySystemComponent"
local KEY_HOOKS = { ASC_CLASS .. ":ServerTryActivateAbility", ASC_CLASS .. ":ServerSetInputPressed" }
local LATCH = "Latch"        -- the ability Z + right mouse starts: TIGameplayAbilityTryLatch

local DEFAULTS = { enabled = false, maxKg = 150, maxSeconds = 20, cooldown = 30, hintMeters = 10, belowCm = 20, grabMeters = 8 }
local HALF_FALLBACK = 100    -- capsule half-height when it cannot be read (cm)

--------------------------------------------------------------------------
-- Settings (written by the bridge; read at most every few seconds)
--------------------------------------------------------------------------

local settings, settingsAt = DEFAULTS, nil

local function num(v, lo, hi, default)
    local n = tonumber(v)
    if n == nil then return default end
    return math.max(lo, math.min(hi, n))
end

local function readSettings()
    local now = os.time()
    if settingsAt ~= nil and now - settingsAt < SETTINGS_RELOAD_S then return settings end
    settingsAt = now
    local f = io.open(SETTINGS_PATH, "r")
    if not f then settings = DEFAULTS; return settings end
    local raw = f:read("*a")
    f:close()
    local ok, d = pcall(json.decode, raw or "")
    if not ok or type(d) ~= "table" then return settings end   -- a torn file: keep the last
    settings = {
        enabled    = d.enabled == true,
        maxKg      = num(d.maxKg, 1, 20000, DEFAULTS.maxKg),
        maxSeconds = num(d.maxSeconds, 3, 120, DEFAULTS.maxSeconds),
        cooldown   = num(d.cooldown, 0, 3600, DEFAULTS.cooldown),
        hintMeters = num(d.hintMeters, 0, 50, DEFAULTS.hintMeters),
        belowCm    = num(d.belowCm, 0, 1000, DEFAULTS.belowCm),
        grabMeters = num(d.grabMeters, 2, 30, DEFAULTS.grabMeters),
    }
    return settings
end

--------------------------------------------------------------------------
-- Reading pawns (game thread)
--------------------------------------------------------------------------

local function addressOf(obj)
    local ok, a = pcall(function() return obj:GetAddress() end)
    if ok and type(a) == "number" and a ~= 0 then return a end
    return nil
end

local function classOf(pawn)
    local ok, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    return ok and n ~= nil and (tostring(n):match("([%w_]+)$") or tostring(n)) or nil
end

--- "BP_Carnotaurus_C" -> "Carnotaurus"
local function speciesName(cls)
    return (tostring(cls or "?"):gsub("^BP_", ""):gsub("_C$", ""))
end

local function locOf(pawn)
    local ok, v = pcall(function() return pawn:K2_GetActorLocation() end)
    if ok and v and type(v.X) == "number" then return { X = v.X, Y = v.Y, Z = v.Z } end
    return nil
end

local function weightOf(pawn)
    local ok, w = pcall(function() return pawn:GetWeight() end)
    return ok and type(w) == "number" and w or nil
end

local function alive(pawn)
    local ok, hp = pcall(function() return pawn:GetHealth() end)
    return not (ok and type(hp) == "number" and hp <= 0)
end

local function onGround(pawn)
    local ok, g = pcall(function() return pawn.CharacterMovement:IsMovingOnGround() end)
    return ok and g == true
end

local function stopFall(pawn)
    pcall(function() pawn.CharacterMovement:StopMovementImmediately() end)
end

local function halfHeight(pawn)
    local ok, h = pcall(function() return pawn.CapsuleComponent:GetScaledCapsuleHalfHeight() end)
    return ok and type(h) == "number" and h > 0 and h or HALF_FALLBACK
end

local function velocityOf(pawn)
    local ok, v = pcall(function() return pawn:GetVelocity() end)
    if ok and v and type(v.X) == "number" then return { X = v.X, Y = v.Y, Z = v.Z } end
    return nil
end

local function yawOf(pawn)
    local ok, r = pcall(function() return pawn:K2_GetActorRotation() end)
    return ok and r and type(r.Yaw) == "number" and r.Yaw or nil
end

--- Put `target` right under `carrier`'s feet, moving with it.
local function hang(carrier, target, s)
    local at = locOf(carrier)
    if not at then return end
    local z = at.Z - halfHeight(carrier) - s.belowCm - halfHeight(target)
    local loc = { X = at.X, Y = at.Y, Z = z }
    local yaw = yawOf(carrier)
    local placed = false
    if yaw then
        placed = pcall(function()
            target:K2_SetActorLocationAndRotation(loc, { Pitch = 0, Yaw = yaw, Roll = 0 }, false, {}, true)
        end)
    end
    if not placed then pcall(function() target:K2_SetActorLocation(loc, false, {}, true) end) end
    local v = velocityOf(carrier)
    local launched = v and pcall(function() target:LaunchCharacter(v, true, true) end)
    if not launched then stopFall(target) end
end


--- SteamID -> { ctrl, pawn } and pawn address -> SteamID, for this tick only.
local function playersNow()
    local byId, byAddr = {}, {}
    H.forEachPlayer(function(ctrl)
        local id = H.safeSteamId(ctrl)
        local pawn = H.livePawnFromCtrl(ctrl)
        if id and pawn then
            byId[id] = { ctrl = ctrl, pawn = pawn }
            local a = addressOf(pawn)
            if a then byAddr[a] = id end
        end
    end)
    return byId, byAddr
end

--------------------------------------------------------------------------
-- Carrying
--------------------------------------------------------------------------

local pending = {}     -- { self = address, target = address } queued by the hook
local carries = {}     -- carrier SteamID -> { target, species, kg, startedAt, dropAsked }
local carriedBy = {}   -- target SteamID -> carrier SteamID
local lastCarry = {}   -- carrier SteamID -> os.time() the last carry ended
local hinted = {}      -- "carrier:target" -> os.time()

local function finish(carrierId, reason, players)
    local c = carries[carrierId]
    if not c then return end
    carries[carrierId] = nil
    carriedBy[c.target] = nil
    lastCarry[carrierId] = os.time()
    local t = players[c.target]
    if t then
        pcall(function() t.pawn:SetIsBeingPickedUp(false) end)
        stopFall(t.pawn)
        Msg.notify(t.ctrl, "ptera.carry.released", "Pteranodon đã thả bạn ra.")
    end
    local p = players[carrierId]
    if p then Msg.notify(p.ctrl, "ptera.carry.dropped", "Đã thả {species}.", { species = c.species }) end
    H.log(string.format("%s: %s let go of %s (%s) after %ds — %s", MOD, carrierId, c.target, c.species,
        os.time() - c.startedAt, reason))
end

local keys = {}        -- { asc = address, handle = n } queued by the ability hooks
local abilities = {}   -- carrier SteamID -> { pawn = address, names = { [handle] = class } }

local ascClass = nil
local function ascOf(pawn)
    if ascClass == nil then
        local ok, c = pcall(function() return StaticFindObject(ASC_CLASS) end)
        if ok and c ~= nil then ascClass = c else return nil end
    end
    local ok, asc = pcall(function() return pawn:GetComponentByClass(ascClass) end)
    if ok and asc ~= nil and H.isValid(asc) then return asc end
    return nil
end

--- handle -> ability class of this pawn (read once per pawn; read-only).
local function abilityNames(steamId, pawn, asc)
    local a = addressOf(pawn)
    local known = abilities[steamId]
    if known and known.pawn == a then return known.names end
    local names = {}
    pcall(function()
        asc.ActivatableAbilities.Items:ForEach(function(_, elem)
            local spec = elem:get()
            local okH, h = pcall(function() return spec.Handle.Handle end)
            local okC, c = pcall(function() return spec.Ability:GetClass():GetFName():ToString() end)
            if okH and okC and h ~= nil then names[tonumber(h) or h] = tostring(c) end
        end)
    end)
    abilities[steamId] = { pawn = a, names = names }
    return names
end

--- The nearest other player's dino within `grabMeters` of the carrier, or nil.
local function nearestTarget(carrierId, carrier, s, players)
    local at = locOf(carrier.pawn)
    if not at then return nil end
    local best, bestD = nil, (s.grabMeters * 100) ^ 2
    for id, t in pairs(players) do
        if id ~= carrierId and not carriedBy[id] and not carries[id] then
            local o = locOf(t.pawn)
            local d = o and (o.X - at.X) ^ 2 + (o.Y - at.Y) ^ 2 + (o.Z - at.Z) ^ 2
            if d and d <= bestD then best, bestD = id, d end
        end
    end
    return best
end

--- A grab: start a carry if the rules allow it.
local function tryStart(grab, s, players, byAddr)
    local carrierId, targetId = grab.carrier or byAddr[grab.self], grab.targetId or byAddr[grab.target]
    if carrierId == nil or targetId == nil or carrierId == targetId then return end   -- not player to player
    local carrier, target = players[carrierId], players[targetId]
    if classOf(carrier.pawn) ~= PTERA or carries[carrierId] or carriedBy[targetId] or carries[targetId] then return end
    local wait = lastCarry[carrierId] and (lastCarry[carrierId] + s.cooldown - os.time()) or 0
    if wait > 0 then
        Msg.notify(carrier.ctrl, "ptera.carry.cooldown", "Gắp đang hồi: chờ {seconds} giây.", { seconds = wait })
        return
    end
    local species = speciesName(classOf(target.pawn))
    local kg = weightOf(target.pawn)
    if kg == nil or not alive(target.pawn) then return end
    if kg > s.maxKg then
        Msg.notify(carrier.ctrl, "ptera.carry.tooHeavy", "{species} nặng {kg} kg — Pteranodon chỉ gắp được tới {max} kg.",
            { species = species, kg = math.floor(kg + 0.5), max = math.floor(s.maxKg) })
        return
    end
    carries[carrierId] = { target = targetId, species = species, kg = kg, startedAt = os.time() }
    carriedBy[targetId] = carrierId
    pcall(function() target.pawn:SetIsBeingPickedUp(true) end)
    Msg.notify(carrier.ctrl, "ptera.carry.start", "Đang gắp {species} ({kg} kg). Đáp xuống hoặc gõ !drop để thả (tối đa {seconds} giây).",
        { species = species, kg = math.floor(kg + 0.5), seconds = math.floor(s.maxSeconds) })
    Msg.notify(target.ctrl, "ptera.carry.victim", "Bạn đang bị một Pteranodon gắp đi!")
    H.log(string.format("%s: %s grabbed %s (%s, %.0f kg)", MOD, carrierId, targetId, species, kg))
end

--- Z + right mouse by a flying Pteranodon's player → a grab of the nearest light dino.
local function keyGrabs(s, players, grabs)
    local pressed = keys
    keys = {}
    if #pressed == 0 then return end
    local byAsc = {}
    for id, p in pairs(players) do
        if classOf(p.pawn) == PTERA and not carries[id] then
            local asc = ascOf(p.pawn)
            local a = asc and addressOf(asc)
            if a then byAsc[a] = { id = id, p = p, asc = asc } end
        end
    end
    local done = {}
    for _, k in ipairs(pressed) do
        local who = byAsc[k.asc]
        if who and not done[who.id] then
            local name = abilityNames(who.id, who.p.pawn, who.asc)[k.handle]
            if name and name:find(LATCH, 1, true) and not onGround(who.p.pawn) then
                done[who.id] = true
                local target = nearestTarget(who.id, who.p, s, players)
                if target then grabs[#grabs + 1] = { carrier = who.id, targetId = target } end
            end
        end
    end
end

local function holdTick()
    if #pending == 0 and #keys == 0 and next(carries) == nil then return end
    local s = readSettings()
    local players, byAddr = playersNow()
    local grabs = pending
    pending = {}
    if s.enabled then keyGrabs(s, players, grabs) else keys = {} end
    if s.enabled then
        for _, g in ipairs(grabs) do tryStart(g, s, players, byAddr) end
    end
    for carrierId, c in pairs(carries) do
        local p, t = players[carrierId], players[c.target]
        if not s.enabled then
            finish(carrierId, "turned off on the panel", players)
        elseif p == nil or t == nil then
            finish(carrierId, "a player left", players)
        elseif not alive(p.pawn) or not alive(t.pawn) then
            finish(carrierId, "a dino died", players)
        elseif c.dropAsked then
            finish(carrierId, "!drop", players)
        elseif os.time() - c.startedAt >= s.maxSeconds then
            finish(carrierId, "time up", players)
        elseif os.time() - c.startedAt >= MIN_CARRY_S and onGround(p.pawn) then
            finish(carrierId, "landed", players)
        else
            hang(p.pawn, t.pawn, s)
        end
    end
end

--- Tell a flying Pteranodon when a light enough player is within reach.
local function hintTick()
    local s = readSettings()
    if not s.enabled or s.hintMeters <= 0 then return end
    local players = playersNow()
    local now = os.time()
    local reach = s.hintMeters * 100
    for carrierId, p in pairs(players) do
        if classOf(p.pawn) == PTERA and not carries[carrierId] and not onGround(p.pawn) then
            local at = locOf(p.pawn)
            for targetId, t in pairs(players) do
                local key = carrierId .. ":" .. targetId
                if targetId ~= carrierId and at and not carriedBy[targetId] and now - (hinted[key] or 0) >= HINT_AGAIN_S then
                    local o = locOf(t.pawn)
                    local kg = o and weightOf(t.pawn)
                    if kg and kg <= s.maxKg and (o.X - at.X) ^ 2 + (o.Y - at.Y) ^ 2 + (o.Z - at.Z) ^ 2 <= reach * reach then
                        hinted[key] = now
                        Msg.notify(p.ctrl, "ptera.carry.hint", "Có thể gắp {species} ({kg} kg) — đang bay, giữ Z + chuột phải sát nó.",
                            { species = speciesName(classOf(t.pawn)), kg = math.floor(kg + 0.5) })
                    end
                end
            end
        end
    end
end

--- Read-only: the game's pick-up flags, per species, players and AI apart
--- (logged once per species+kind+values). Booleans only (lua-safety-rules).
local flagsSeen, flagsAt, flagsRuns = {}, 0, 0
local function boolOf(pawn, name)
    local ok, v = pcall(function() return pawn[name] end)
    if ok and type(v) == "boolean" then return tostring(v) end
    return "?"
end
local function flagsCensus()
    local now = os.time()
    if flagsRuns >= FLAGS_RUNS or now - flagsAt < FLAGS_EVERY_S then return end
    local _, byAddr = playersNow()
    if next(byAddr) == nil then return end
    flagsAt = now
    flagsRuns = flagsRuns + 1
    local ok, all = pcall(function() return FindAllOf("TICharacterBase") or {} end)
    if not ok then return end
    local counts, order = {}, {}
    for i, pawn in ipairs(all) do
        if i > FLAGS_MAX_PAWNS then break end
        local a = addressOf(pawn)
        local cls = a and classOf(pawn)
        if cls then
            local key = string.format("%s (%s) bBlockPickUp=%s bBeingPickedUp=%s", cls, byAddr[a] and "player" or "AI",
                boolOf(pawn, "bBlockPickUp"), boolOf(pawn, "bBeingPickedUp"))
            if not counts[key] then order[#order + 1] = key end
            counts[key] = (counts[key] or 0) + 1
        end
    end
    for _, key in ipairs(order) do
        if not flagsSeen[key] then
            flagsSeen[key] = true
            H.log(string.format("%s flags: %s x%d", MOD, key, counts[key]))
        end
    end
end

--------------------------------------------------------------------------
-- Start
--------------------------------------------------------------------------

-- The hook only notes who grabbed whom (addresses); the game thread does the rest.
local okHook, err = pcall(function()
    RegisterHook(GRAB_HOOK, function(selfP, targetP)
        local okS, me = pcall(function() return selfP:get() end)
        local okT, it = pcall(function() return targetP:get() end)
        local a, b = okS and addressOf(me), okT and addressOf(it)
        if a and b and #pending < 20 then pending[#pending + 1] = { self = a, target = b } end
    end)
end)
H.log(MOD .. ": hook " .. GRAB_HOOK .. ": " .. (okHook and "registered" or ("FAILED: " .. tostring(err))))

-- Every ability a player starts reaches these; only the two addresses are noted.
for _, path in ipairs(KEY_HOOKS) do
    local okK, errK = pcall(function()
        RegisterHook(path, function(selfP, handleP)
            if #keys >= 50 then return end
            local okS, asc = pcall(function() return selfP:get() end)
            local okH, h = pcall(function() return handleP:get().Handle end)
            local a = okS and addressOf(asc)
            if a and okH and h ~= nil then keys[#keys + 1] = { asc = a, handle = tonumber(h) or h } end
        end)
    end)
    H.log(MOD .. ": hook " .. path .. ": " .. (okK and "registered" or ("FAILED: " .. tostring(errK))))
end

H.onChat(function(ctrl, steamId, msg)
    if H.parseCommand(msg) ~= "drop" then return end
    local c = carries[steamId]
    if c then c.dropAsked = true
    else Msg.notify(ctrl, "ptera.carry.nothing", "Bạn không gắp con nào.") end
end)

H.every(HOLD_MS, MOD .. " hold", holdTick)
H.every(HINT_MS, MOD .. " hints", function() hintTick(); flagsCensus() end)
H.log(MOD .. ": loaded — " .. (readSettings().enabled and "on" or "off (turn it on in the panel)"))
