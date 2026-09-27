-- StatLab — TEST SERVER ONLY (off in ue4ss/mods.txt; turned on by hand in the
-- test copy). A prime dino taken out of the garage kept the max health of a
-- plain one (a prime Deinosuchus at 88 %: 8,799 instead of 10,931) until the
-- player logged in again (2026-09-28): restore.lua sets the growth, then asks
-- for prime — the game adds prime's stats when it recomputes them, and nothing
-- made it recompute after. On a Deinosuchus spawned for the test, writes
-- Mods/StatLab/Saved/statlab.txt: GetMaxHealth / GetMaxStamina / IsPrimeElder
--   1. after SetGrowth(0.88)
--   2. after the prime tasks (five) + ServerSetPrimeEligible(true)
--   3. after SetGrowth(0.88) again — does a growth write recompute with prime?
--   4. after SetGrowth(0.74) then SetGrowth(0.88) — crossing the 75 % mark
-- Flag first per step (Saved/<step>.trying), like the other labs.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H = require("shared.isle.helpers")

local MOD  = "StatLab"
local DIR  = "Mods/StatLab/Saved/"
local OUT  = DIR .. "statlab.txt"
local DINO = "/Game/TheIsle/Core/Characters/Dinosaurs/Deinosuchus/BP_Deinosuchus.BP_Deinosuchus_C"
local STATICS = "/Script/Engine.Default__GameplayStatics"
local AT = { X = 350856, Y = -354551, Z = 39315 }
local START_AFTER_S = 90
local GROWTH = 0.88

local rows = {}
local function out(fmt, ...)
    local line = string.format(fmt, ...)
    rows[#rows + 1] = os.date("!%H:%M:%S ") .. line
    H.log(MOD .. ": " .. line)
    local f = io.open(OUT, "w")
    if f then f:write(table.concat(rows, "\n"), "\n"); f:close() end
end
local function exists(p) local f = io.open(p, "r"); if f then f:close(); return true end; return false end
local function write(p, t) local f = io.open(p, "w"); if f then f:write(t); f:close() end end
local crashed = {}
for _, s in ipairs({ "growth", "prime", "regrow", "cross" }) do if exists(DIR .. s .. ".trying") then crashed[s] = true end end
local function step(name, fn)
    if crashed[name] then out("step %s: SKIPPED — the server stopped during it last time (crash)", name); return end
    write(DIR .. name .. ".trying", tostring(os.time()))
    local ok, err = pcall(fn)
    os.remove(DIR .. name .. ".trying")
    if not ok then out("step %s: error %s", name, tostring(err)) end
end

local function isValid(o) return o ~= nil and H.isValid(o) end
local function addressOf(o) local ok, a = pcall(function() return o:GetAddress() end); return ok and a ~= 0 and a or nil end
local function find(path) local ok, o = pcall(function() return StaticFindObject(path) end); return ok and isValid(o) and o or nil end
local function call(p, fn) local ok, v = pcall(function() return p[fn](p) end); return ok and tostring(v) or "?" end

local function numbers(pawn, label)
    out("%s: maxHealth=%s health=%s maxStamina=%s maxHunger=%s growth=%s prime=%s eligible=%s", label,
        call(pawn, "GetMaxHealth"), call(pawn, "GetHealth"), call(pawn, "GetMaxStamina"), call(pawn, "GetMaxHunger"),
        call(pawn, "GetGrowth"), call(pawn, "IsPrimeElder"), call(pawn, "GetIsEligiblePrimeElder"))
end

local dinoAddr = nil
local function theDino()
    if dinoAddr == nil then return nil end
    local ok, all = pcall(function() return FindAllOf("BP_Deinosuchus_C") or {} end)
    for _, p in ipairs(ok and all or {}) do if addressOf(p) == dinoAddr and isValid(p) then return p end end
    return nil
end

local phase, loadedAt, nextAt = 0, os.time(), 0
H.every(2000, MOD .. ": step", function()
    local now = os.time()
    if now < loadedAt + START_AFTER_S or now < nextAt or phase > 6 then return end
    local okG, world = pcall(function()
        local gs = FindFirstOf("TIGameStateBase")
        return isValid(gs) and gs:GetWorld() or nil
    end)
    if not (okG and isValid(world)) then return end
    if phase == 0 then
        local statics, cls = find(STATICS), find(DINO)
        if cls == nil and type(LoadAsset) == "function" then pcall(function() LoadAsset(DINO) end); cls = find(DINO) end
        if not (statics and cls) then out("dino: class not found"); phase = 7; return end
        pcall(function()
            local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = AT, Scale3D = { X = 1, Y = 1, Z = 1 } }
            local a = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
            if a ~= nil and addressOf(a) ~= nil then statics:FinishSpawningActor(a, xf, 1); dinoAddr = addressOf(a) end
        end)
        out("dino: %s", dinoAddr and "a Deinosuchus spawned" or "nothing made")
        phase, nextAt = dinoAddr and 1 or 7, now + 4
        return
    end
    local pawn = theDino()
    if pawn == nil then out("dino: gone"); phase = 7; return end
    if phase == 1 then
        numbers(pawn, "0 as spawned")
        step("growth", function() pawn:SetGrowth(GROWTH) end)
        phase, nextAt = 2, now + 2
    elseif phase == 2 then
        numbers(pawn, "1 after SetGrowth")
        step("prime", function()
            local data = pawn.EligiblePrimeElderData
            for i = 1, 10 do data["bPrimeCondition" .. i] = (i == 1 or i == 3 or i == 5 or i == 7 or i == 8) end
            data.bIsEligiblePrime = true
            pawn:ServerSetPrimeEligible(true)
        end)
        phase, nextAt = 3, now + 2
    elseif phase == 3 then
        numbers(pawn, "2 after prime")
        step("regrow", function() pawn:SetGrowth(GROWTH) end)
        phase, nextAt = 4, now + 2
    elseif phase == 4 then
        numbers(pawn, "3 after SetGrowth again")
        step("cross", function() pawn:SetGrowth(0.74); pawn:SetGrowth(GROWTH) end)
        phase, nextAt = 5, now + 2
    elseif phase == 5 then
        numbers(pawn, "4 after 0.74 -> 0.88")
        phase, nextAt = 6, now + 6
    elseif phase == 6 then
        numbers(pawn, "5 eight seconds later")
        out("DONE")
        phase = 7
    end
end)

out("loaded — the probe starts %d s after load", START_AFTER_S)
