-- PteraCarry — step 1: find out how the game's own Pteranodon carry works.
--
-- The game already lets an adult Pteranodon pick up small prey (crabs, frogs,
-- rabbits, chickens, hatchlings and small juveniles — Evrima Quick Guide).
-- On this server it reportedly does not. Before changing anything, this
-- read-only step lists what the engine really has, and logs what happens
-- when a player tries:
--
--   1. every function and property of BP_Pteranodon_C and its parents whose
--      name is about carrying (carry / grab / pick / drop / hold / prey …),
--      with the functions' parameters
--   2. the same for the player controller (the grab input may be its RPC)
--   3. a logging hook on each carry ACTION (Set…/Server…/Grab…/Release…/
--      Pickup…, never a Get…/Is… getter: those run every frame for every
--      character): when a player tries to grab, UE4SS.log shows which
--      function ran, with what (the first MAX_FIRES of each)
--   4. every 30 s, for each player playing a Pteranodon: its weight and
--      bBlockPickUp, and the same for the prey (rabbit, chicken, frog, crab)
--      within 30 m — read on the live pawns, numbers and flags only
--
-- NEVER read a class default object (GetCDO): reading its properties crashed
-- the server twice (2026-09-26 00:36, 00:37). Nothing is written to the game. All of it runs on the game thread
-- (H.every); hooks only read their parameters. Output: UE4SS.log, lines
-- "[isle] PteraCarry: …" — scripts/logs.sh ue4ss.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H = require("shared.isle.helpers")

local MOD = "PteraCarry"
local DINOS = "/Game/TheIsle/Core/Characters/Dinosaurs"
local ANIMALS = "/Game/TheIsle/Core/Characters/Animals"
local PTERA = DINOS .. "/Pteranodon/BP_Pteranodon.BP_Pteranodon_C"
local PREY = { BP_Rabbit_C = true, BP_Chicken_C = true, BP_Bullfrog_C = true, BP_Crab_C = true }
local PREY_NEAR_CM = 3000
-- Lower-case pieces of a name that make it worth listing.
local WORDS = { "carr", "grab", "pick", "drop", "prey", "snatch", "releas", "talon", "claw",
                "attach", "weight", "grip", "held", "drag", "interact" }
-- Hooked: an action about carrying. Getters (Get…, Is…, OnRep_…, Input…,
-- Receive…) are listed but never hooked — they run every frame.
local HOOK_WORDS = { "carr", "grab", "pick", "drop", "snatch", "releas", "grip", "drag", "interact" }
local NOT_HOOKED = { "^Get", "^Is", "^OnRep", "^Input", "^Receive", "^K2_", "^Can", "Organ", "Egg" }
local MAX_HOOKS = 30
local MAX_FIRES = 5
local RETRY_MS = 30000

local function log(fmt, ...) H.log(MOD .. ": " .. string.format(fmt, ...)) end

local function hookable(name)
    for _, pat in ipairs(NOT_HOOKED) do
        if name:find(pat) then return false end
    end
    return true
end

local function matches(name, words)
    local low = name:lower()
    for _, w in ipairs(words) do
        if low:find(w, 1, true) then return true end
    end
    return false
end

local function nameOf(obj)
    local ok, n = pcall(function() return obj:GetFName():ToString() end)
    return ok and tostring(n) or "?"
end

--- A value as text: numbers, booleans, names, objects by class.
local function show(v)
    local t = type(v)
    if t == "number" or t == "boolean" or t == "nil" then return tostring(v) end
    if t == "string" then return string.format("%q", v) end
    local okS, s = pcall(function() return v:ToString() end)
    if okS and type(s) == "string" then return string.format("%q", s) end
    local okC, c = pcall(function() return v:GetClass():GetFName():ToString() end)
    if okC and c then return "<" .. tostring(c) .. ">" end
    return "<" .. t .. ">"
end

--- Walk a class and its parents: fn(cls, depth). Stops at 15 levels.
local function eachClass(cls, fn)
    local depth = 0
    while cls ~= nil and depth < 15 do
        local okV, valid = pcall(function() return cls:IsValid() end)
        if not (okV and valid) then break end
        fn(cls, depth)
        local okS, super = pcall(function() return cls:GetSuperStruct() end)
        cls = okS and super or nil
        depth = depth + 1
    end
end

local function findClass(path)
    local ok, cls = pcall(function() return StaticFindObject(path) end)
    if ok and cls ~= nil and H.isValid(cls) then return cls end
    return nil
end

--------------------------------------------------------------------------
-- 3. Logging hooks
--------------------------------------------------------------------------

local hooked = {}
local hookCount = 0

local function hook(path, label)
    if hooked[path] or hookCount >= MAX_HOOKS then return end
    hooked[path] = true
    local fires = 0
    local ok, err = pcall(function()
        RegisterHook(path, function(...)
            if fires >= MAX_FIRES then return end
            fires = fires + 1
            -- Read only: the parameters' values, never a call that changes anything.
            local parts = {}
            for i = 1, select("#", ...) do
                local p = select(i, ...)
                local okG, v = pcall(function() return p:get() end)
                parts[#parts + 1] = okG and show(v) or "?"
            end
            log("FIRED %s #%d (self, params…): %s", label, fires, table.concat(parts, ", "))
        end)
    end)
    if ok then hookCount = hookCount + 1 end
    log("hook %s: %s", path, ok and "registered" or ("failed: " .. tostring(err)))
end

--------------------------------------------------------------------------
-- 1 + 2. What the classes have
--------------------------------------------------------------------------

local function listClass(label, cls)
    log("=== %s and parents: carry-related functions and properties ===", label)
    eachClass(cls, function(c, depth)
        local cname = nameOf(c)
        pcall(function()
            c:ForEachFunction(function(fn)
                local name = nameOf(fn)
                if not matches(name, WORDS) then return end
                local params = {}
                pcall(function()
                    fn:ForEachProperty(function(prop)
                        params[#params + 1] = nameOf(prop) .. ":" .. nameOf(prop:GetClass())
                    end)
                end)
                log("  [%d %s] function %s(%s)", depth, cname, name, table.concat(params, ", "))
                if matches(name, HOOK_WORDS) and hookable(name) then
                    local okP, full = pcall(function() return fn:GetFullName() end)
                    -- "Function /Script/TheIsle.X:Name" -> "/Script/TheIsle.X:Name"
                    local path = okP and tostring(full):match("^Function (.+)$")
                    if path then hook(path, cname .. ":" .. name) end
                end
            end)
        end)
        pcall(function()
            c:ForEachProperty(function(prop)
                local name = nameOf(prop)
                if matches(name, WORDS) then
                    log("  [%d %s] property %s : %s", depth, cname, name, nameOf(prop:GetClass()))
                end
            end)
        end)
    end)
end

--------------------------------------------------------------------------
-- 4. Live values: a playing Pteranodon and the prey near it
--------------------------------------------------------------------------

local function num(pawn, getter)
    local ok, v = pcall(function() return pawn[getter](pawn) end)
    return ok and type(v) == "number" and string.format("%.1f", v) or "?"
end

local function flag(pawn, prop)
    local ok, v = pcall(function() return pawn[prop] end)
    return ok and type(v) == "boolean" and tostring(v) or "?"
end

--- "BP_Rabbit_C" (a longer "…/BP_Rabbit.BP_Rabbit_C" is cut to its last part, as in AIZones).
local function short(pawn)
    local ok, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    return ok and n ~= nil and (tostring(n):match("([%w_]+)$") or tostring(n)) or "?"
end

local function where(pawn)
    local ok, v = pcall(function() return pawn:K2_GetActorLocation() end)
    return ok and v and type(v.X) == "number" and v or nil
end

local function liveValues()
    local pteras = {}
    H.forEachPlayer(function(ctrl)
        local pawn = H.livePawnFromCtrl(ctrl)
        if pawn and short(pawn) == "BP_Pteranodon_C" then pteras[#pteras + 1] = { ctrl = ctrl, pawn = pawn } end
    end)
    if #pteras == 0 then return end
    local okA, all = pcall(function() return FindAllOf("Pawn") or {} end)
    for _, p in ipairs(pteras) do
        local at = where(p.pawn)
        log("live ptera %s: growth %s, GetWeight %s, bBlockPickUp %s, bBeingPickedUp %s",
            tostring(H.safeSteamId(p.ctrl)), num(p.pawn, "GetGrowth"), num(p.pawn, "GetWeight"),
            flag(p.pawn, "bBlockPickUp"), flag(p.pawn, "bBeingPickedUp"))
        local shown = 0
        for _, other in ipairs(okA and all or {}) do
            if shown < 6 and H.isValid(other) and PREY[short(other)] then
                local o = where(other)
                if at and o and (o.X - at.X) ^ 2 + (o.Y - at.Y) ^ 2 <= PREY_NEAR_CM ^ 2 then
                    shown = shown + 1
                    log("  prey %s at %.0f m: GetWeight %s, bBlockPickUp %s, bBeingPickedUp %s, health %s",
                        short(other), math.sqrt((o.X - at.X) ^ 2 + (o.Y - at.Y) ^ 2) / 100,
                        num(other, "GetWeight"), flag(other, "bBlockPickUp"), flag(other, "bBeingPickedUp"),
                        num(other, "GetHealth"))
                end
            end
        end
        if shown == 0 then log("  no rabbit / chicken / frog / crab within %d m", PREY_NEAR_CM // 100) end
    end
end

--------------------------------------------------------------------------
-- Run once the classes are loaded (a class loads when first used).
--------------------------------------------------------------------------

local pteraDone, ctrlDone = false, false

local function step()
    if not pteraDone then
        local cls = findClass(PTERA)
        if cls then
            pteraDone = true
            listClass("BP_Pteranodon_C", cls)
            log("%d logging hooks set — now have an adult Pteranodon try to grab a rabbit or a chicken", hookCount)
        end
    end
    if not ctrlDone then
        -- The controller's class, from a player online (its path is not guessed).
        local cls = nil
        H.forEachPlayer(function(ctrl)
            if cls == nil then
                local ok, c = pcall(function() return ctrl:GetClass() end)
                if ok and c ~= nil then cls = c end
            end
        end)
        if cls then
            ctrlDone = true
            listClass("player controller " .. nameOf(cls), cls)
        end
    end
    liveValues()
end

H.every(RETRY_MS, MOD .. " discovery", step)
log("loaded (read-only discovery) — results appear once the classes are loaded")
