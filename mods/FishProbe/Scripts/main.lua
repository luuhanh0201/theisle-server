-- FishProbe — read-only: how does this server spawn its fish?
--
-- The world AI spawner (TIAIWorldSpawner, PlantProbe 2026-09-26) has the
-- ambient fish: AIAmbientFishClasses, MaxAmbientFishPerPlayer,
-- AmbientFishSoftLimitPerWater, AmbientFishSpawnAttemptsPerPlayer,
-- AmbientFishSpawnCooldown. Before a mod sets the density and the species
-- (admin's choice), this finds out:
--
--   1. once, two minutes after load: those settings (numbers only) and the
--      TYPE of AIAmbientFishClasses; its entries (class names) are read only
--      when it is a plain array of classes — a soft reference crashed this
--      server (2026-09-24), so anything else is only described
--   2. while players are online (every minute, 10 times at most): the actors
--      whose class says "Fish", counted by class, a few locations, and each
--      new class's parents (names only)
--
-- Output: Mods/AIZones/Saved/fishprobe.txt (that folder exists). Part 1 runs
-- under a flag written first (no crash loop); delete fishprobe.flag to rerun.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H = require("shared.isle.helpers")

local MOD = "FishProbe"
local DIR = "Mods/AIZones/Saved/"
local FLAG = DIR .. "fishprobe.flag"
local OUT = DIR .. "fishprobe.txt"
local SETTINGS = { "MaxAmbientFishPerPlayer", "AmbientFishSoftLimitPerWater", "AmbientFishSpawnAttemptsPerPlayer",
    "AmbientFishSpawnCooldown", "GlobalAISpawnLimit", "CharacterTickerPlayersPerTick", "CharacterTickerTimeBudgetMs",
    "bHasGeneratedFishNav", "bDebugAmbientFishSpawnLocations" }
local MAX_REPORTS = 10

local lines = {}
local function out(fmt, ...)
    local s = string.format(fmt, ...)
    lines[#lines + 1] = s
    H.log(MOD .. ": " .. s)
end
local function flush()
    local f = io.open(OUT, "w")
    if not f then return end
    f:write(table.concat(lines, "\n"), "\n")
    f:close()
end
local function nameOf(o)
    local ok, n = pcall(function() return o:GetFName():ToString() end)
    return ok and tostring(n) or "?"
end
local function scalar(o, name)
    local ok, v = pcall(function() return o[name] end)
    if ok and (type(v) == "number" or type(v) == "boolean") then return tostring(v) end
    return "(not a number)"
end

--- The type of a property of `cls` (and its inner type, for an array), from the class only.
local function propType(cls, wanted)
    local found = nil
    local depth = 0
    while cls ~= nil and depth < 8 and found == nil do
        pcall(function()
            cls:ForEachProperty(function(p)
                if found == nil and nameOf(p) == wanted then
                    local t = nameOf(p:GetClass())
                    local inner = nil
                    pcall(function() inner = nameOf(p:GetInner():GetClass()) end)
                    found = { type = t, inner = inner }
                end
            end)
        end)
        local okS, s = pcall(function() return cls:GetSuperStruct() end)
        cls = okS and s or nil
        depth = depth + 1
    end
    return found
end

local function spawnerSettings()
    local okA, all = pcall(function() return FindAllOf("TIAIWorldSpawner") or {} end)
    local ws = okA and all[1] or nil
    if ws == nil or not H.isValid(ws) then out("no TIAIWorldSpawner found"); return end
    out("=== TIAIWorldSpawner (%s) ===", nameOf(ws:GetClass()))
    for _, k in ipairs(SETTINGS) do out("  %s = %s", k, scalar(ws, k)) end
    local t = propType(ws:GetClass(), "AIAmbientFishClasses")
    out("  AIAmbientFishClasses: %s of %s", t and t.type or "?", t and tostring(t.inner) or "?")
    if t and t.type == "ArrayProperty" and t.inner == "ClassProperty" then
        local names = {}
        pcall(function()
            ws.AIAmbientFishClasses:ForEach(function(_, e)
                local okC, c = pcall(function() return e:get() end)
                names[#names + 1] = okC and c and nameOf(c) or "?"
            end)
        end)
        out("  fish classes (%d): %s", #names, table.concat(names, ", "))
    else
        out("  (not read: only a plain array of classes is read)")
    end
    for _, k in ipairs({ "SpeciesSpawnLimits", "AIWaterAnimalCharacters", "AISaltWaterAnimalCharacters", "WaterBodies" }) do
        local pt = propType(ws:GetClass(), k)
        out("  %s: %s of %s (not read)", k, pt and pt.type or "?", pt and tostring(pt.inner) or "?")
    end
end

local reports, described = 0, {}
local function fishCensus()
    if reports >= MAX_REPORTS then return end
    local online = 0
    H.forEachPlayer(function() online = online + 1 end)
    if online == 0 then return end
    reports = reports + 1
    local okA, all = pcall(function() return FindAllOf("Actor") or {} end)
    local by = {}
    for _, a in ipairs(okA and all or {}) do
        local okC, c = pcall(function() return a:GetClass() end)
        local n = okC and c and nameOf(c) or "?"
        if n:lower():find("fish", 1, true) then
            local e = by[n] or { n = 0, where = {}, cls = c }
            by[n] = e
            e.n = e.n + 1
            if #e.where < 3 then
                local okL, v = pcall(function() return a:K2_GetActorLocation() end)
                if okL and v then e.where[#e.where + 1] = string.format("(%.0f, %.0f, %.0f)", v.X, v.Y, v.Z) end
            end
        end
    end
    out("=== fish actors, report %d (%d players online) ===", reports, online)
    local any = false
    for n, e in pairs(by) do
        any = true
        out("  %5d  %s  %s", e.n, n, table.concat(e.where, " "))
        if not described[n] then
            described[n] = true
            local chain, cls, d = {}, e.cls, 0
            while cls ~= nil and d < 8 do
                chain[#chain + 1] = nameOf(cls)
                local okS, s = pcall(function() return cls:GetSuperStruct() end)
                cls = okS and s or nil
                d = d + 1
            end
            out("         parents: %s", table.concat(chain, " < "))
        end
    end
    if not any then out("  none — go near a river, a lake or the sea") end
    flush()
end

local already = io.open(FLAG, "r")
if already then
    already:close()
    H.log(MOD .. ": settings already probed (delete " .. FLAG .. " to redo) — fish census only")
else
    H.defer(120000, function()
        local f = io.open(FLAG, "w")
        if f then f:write(tostring(os.time())); f:close() end
        H.try(MOD .. ": spawner", spawnerSettings)
        flush()
    end)
end
H.every(60000, MOD .. " census", fishCensus)
H.log(MOD .. ": loaded — report in " .. OUT)
