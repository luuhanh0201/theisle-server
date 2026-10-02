-- VitalLab — TEST SERVER ONLY (off in ue4ss/mods.txt; turned on by hand in the
-- test copy).
--
-- Runs 1–4 (2026-10-02): the stomach after the garage — the attribute set's
-- OriginalMaxHunger / Thirst / Stamina stay a hatchling's after SetGrowth; written
-- by restore.lua R.setOriginals, fixed for all 22 species.
--
-- Run 5 (this): malnutrition. A dino out of the garage with a nutrient at 0 went
-- dark-edged at the next login (the game's malnutrition: the α β γ icons empty;
-- 2026-10-02, a Rex that only ate lipid). How low may a nutrient be before the
-- game calls it malnutrition? Dinos spawned for the test, each with its nutrients
-- at one level (a share of its stomach max, as the garage fills them), the
-- game's own NutrientsStruct.bMalnutrition read every 30 s for 10 minutes:
--   Tyrannosaurus and Triceratops at 0, 0.5, 1, 2, 5, 10, 25, 50 % (all three)
--   Tyrannosaurus with only one of carb / protein / lipid at 0 (the others 50 %)
-- Writes Mods/VitalLab/Saved/vitallab.txt.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H = require("shared.isle.helpers")

local MOD  = "VitalLab"
local DIR  = "Mods/VitalLab/Saved/"
local OUT  = DIR .. "vitallab.txt"
local DINOS = "/Game/TheIsle/Core/Characters/Dinosaurs/"
local STATICS = "/Script/Engine.Default__GameplayStatics"
local START_AFTER_S = 90
local GROWTH = 0.6
local WATCH_S = 600
local EVERY_S = 30
local LEVELS = { 0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5 }
local FIELDS = { "CarbValue", "ProteinValue", "LipidValue" }

-- { species, label, { CarbValue = share, ProteinValue = share, LipidValue = share } }
local CASES = {}
for _, sp in ipairs({ "Tyrannosaurus", "Triceratops" }) do
    for _, l in ipairs(LEVELS) do
        CASES[#CASES + 1] = { sp, string.format("all %.1f%%", l * 100), { CarbValue = l, ProteinValue = l, LipidValue = l } }
    end
end
for _, f in ipairs(FIELDS) do
    local mix = { CarbValue = 0.5, ProteinValue = 0.5, LipidValue = 0.5 }
    mix[f] = 0
    CASES[#CASES + 1] = { "Tyrannosaurus", f .. " 0, others 50%", mix }
end

local rows = {}
local function out(fmt, ...)
    local line = string.format(fmt, ...)
    rows[#rows + 1] = os.date("!%H:%M:%S ") .. line
    H.log(MOD .. ": " .. line)
    local f = io.open(OUT, "w")
    if f then f:write(table.concat(rows, "\n"), "\n"); f:close() end
end
local function isValid(o) return o ~= nil and H.isValid(o) end
local function addressOf(o) local ok, a = pcall(function() return o:GetAddress() end); return ok and a ~= 0 and a or nil end
local function find(path) local ok, o = pcall(function() return StaticFindObject(path) end); return ok and isValid(o) and o or nil end
local function num(p, fn) local ok, v = pcall(function() return p[fn](p) end); return ok and tonumber(v) or nil end

local function spawn(world, name, at)
    local path = DINOS .. name .. "/BP_" .. name .. ".BP_" .. name .. "_C"
    local statics, cls = find(STATICS), find(path)
    if cls == nil and type(LoadAsset) == "function" then pcall(function() LoadAsset(path) end); cls = find(path) end
    if not (statics and cls) then return nil end
    local addr = nil
    pcall(function()
        local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = at, Scale3D = { X = 1, Y = 1, Z = 1 } }
        local a = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
        if a ~= nil and addressOf(a) ~= nil then statics:FinishSpawningActor(a, xf, 1); addr = addressOf(a) end
    end)
    return addr
end
local function byAddress(name, addr)
    local ok, all = pcall(function() return FindAllOf("BP_" .. name .. "_C") or {} end)
    for _, p in ipairs(ok and all or {}) do if addressOf(p) == addr and isValid(p) then return p end end
    return nil
end
local function readNutrients(p)
    local ok, s = pcall(function()
        local st = p.NutrientsStruct
        return { carb = st.CarbValue, protein = st.ProteinValue, lipid = st.LipidValue, mal = st.bMalnutrition }
    end)
    return ok and s or nil
end

local dinos = {}   -- { case, addr, stomach, malSince, last }
local phase, loadedAt, nextAt, startedAt = 0, os.time(), 0, nil
H.every(2000, MOD .. ": step", function()
    local now = os.time()
    if phase >= 99 or now < loadedAt + START_AFTER_S or now < nextAt then return end
    local okG, world = pcall(function()
        local gs = FindFirstOf("TIGameStateBase")
        return isValid(gs) and gs:GetWorld() or nil
    end)
    if not (okG and isValid(world)) then return end
    if phase == 0 then
        -- One by one, 10 m apart on StatLab's open ground.
        local i = #dinos + 1
        local c = CASES[i]
        if c == nil then phase, nextAt = 1, now + 3; return end
        local at = { X = 350856 + ((i - 1) % 6) * 1000, Y = -354551 + math.floor((i - 1) / 6) * 1000, Z = 39315 }
        dinos[i] = { case = c, addr = spawn(world, c[1], at) }
        out("spawned %s (%s): %s", c[1], c[2], dinos[i].addr and "ok" or "FAILED")
        return
    end
    if phase == 1 then
        for _, d in ipairs(dinos) do
            local p = d.addr and byAddress(d.case[1], d.addr)
            if p then
                pcall(function() p:SetGrowth(GROWTH) end)
                local stomach = num(p, "GetMaxHunger")
                d.stomach = stomach
                pcall(function() p:SetHunger((stomach or 0) * 0.5) end)
                pcall(function()
                    local st = p.NutrientsStruct
                    for f, share in pairs(d.case[3]) do st[f] = (stomach or 0) * share end
                    st.bMalnutrition = false
                    p:SetNutrientsStruct(st, true)
                end)
            end
        end
        startedAt = now
        out("all set (growth %.2f, stomach half full, nutrients as each case) — watching %d s", GROWTH, WATCH_S)
        phase, nextAt = 2, now + EVERY_S
        return
    end
    if phase == 2 then
        local t = now - startedAt
        for _, d in ipairs(dinos) do
            local p = d.addr and byAddress(d.case[1], d.addr)
            local n = p and readNutrients(p)
            if n then
                if n.mal == true and d.malSince == nil then d.malSince = t end
                d.last = n
                -- Keep it alive and fed (the stomach, not the nutrients): only the nutrients are being looked at.
                pcall(function() p:SetHunger((d.stomach or 0) * 0.5) end)
                pcall(function() p:SetThirst(num(p, "GetMaxThirst") or 1000) end)
            end
        end
        local line = {}
        for _, d in ipairs(dinos) do
            local n = d.last
            line[#line + 1] = string.format("%s/%s mal=%s", d.case[1]:sub(1, 5), d.case[2], n and tostring(n.mal) or "?")
        end
        out("t=%ds  %s", t, table.concat(line, " | "))
        if t >= WATCH_S then
            out("SUMMARY (stomach max at %.0f%% growth: share = nutrient / stomach max)", GROWTH * 100)
            for _, d in ipairs(dinos) do
                local n = d.last
                out("  %-14s %-28s malnutrition: %-26s now carb %s protein %s lipid %s (stomach %s)", d.case[1], d.case[2],
                    d.malSince and ("YES (from t=" .. d.malSince .. "s)") or "no",
                    n and string.format("%.1f", n.carb or -1) or "?", n and string.format("%.1f", n.protein or -1) or "?",
                    n and string.format("%.1f", n.lipid or -1) or "?", d.stomach and string.format("%.0f", d.stomach) or "?")
            end
            for _, d in ipairs(dinos) do
                local p = d.addr and byAddress(d.case[1], d.addr)
                if p then pcall(function() p:SetHealth(0) end) end
            end
            out("DONE")
            phase = 99
            return
        end
        nextAt = now + EVERY_S
    end
end)

out("loaded — %d dinos, starting %d s after load", #CASES, START_AFTER_S)
