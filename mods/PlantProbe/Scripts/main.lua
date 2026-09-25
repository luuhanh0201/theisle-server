-- PlantProbe — read-only: how does this server keep its plants?
--
-- Game.ini has bSpawnPlants / PlantSpawnMultiplier: plants are spawned while
-- the game runs. Before any mod decides where nutrient plants may grow
-- (migration zones only), this finds out what a plant is here:
--
--   1. every actor, counted by class; the plant-looking classes (and the
--      migration / patrol zone ones) with a few locations
--   2. for those classes: their properties' NAMES and types and their
--      functions' names — from the class, never a value read from an actor
--   3. instanced meshes (foliage): per component, its owner class and how
--      many instances it has (GetInstanceCount, a UFunction)
--
-- Lessons kept (docs/NHAT-KY-VAN-HANH.md 2026-09-24, 2026-09-26):
--   * NO property value is read from an unknown actor (that crashed the
--     server inside UE4SS.dll, where pcall cannot catch it); NO GetCDO()
--   * runs ONCE: a flag file is written BEFORE the probe, so if it crashes the
--     next start skips it instead of crashing in a loop
--   * the report goes to its own file (UE4SS.log is overwritten on restart)
--
-- Output: Mods/AIZones/Saved/plantprobe.txt (that folder exists; Lua cannot
-- create one). Delete plantprobe.flag there to run it again.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H = require("shared.isle.helpers")

local MOD = "PlantProbe"
local DIR = "Mods/AIZones/Saved/"
local FLAG = DIR .. "plantprobe.flag"
local OUT = DIR .. "plantprobe.txt"
local AFTER_MS = 120000          -- two minutes after load: the world is up, plants spawned
local WORDS = { "plant", "flora", "food", "fruit", "bush", "berry", "mushroom", "foliage", "tree", "coconut",
    "mango", "melon", "pumpkin", "root", "flower", "fern", "leaf", "seed", "nut", "spawn", "migrat", "patrol",
    "zone", "region", "biome", "harvest", "edible", "forage", "diet", "nutri", "grow" }
local SAMPLES = 3                -- locations listed per interesting class
local MAX_MEMBERS = 80           -- property / function names listed per class

local lines = {}
local function out(fmt, ...)
    local s = string.format(fmt, ...)
    lines[#lines + 1] = s
    H.log(MOD .. ": " .. s)
end

local function flush()
    local f = io.open(OUT, "w")
    if not f then H.logError(MOD .. ": cannot write " .. OUT); return end
    f:write(table.concat(lines, "\n"), "\n")
    f:close()
end

local function interesting(name)
    local low = name:lower()
    for _, w in ipairs(WORDS) do
        if low:find(w, 1, true) then return true end
    end
    return false
end

local function nameOf(obj)
    local ok, n = pcall(function() return obj:GetFName():ToString() end)
    return ok and tostring(n) or "?"
end

local function classOf(obj)
    local ok, c = pcall(function() return obj:GetClass() end)
    return ok and c or nil
end

local function whereOf(actor)
    local ok, v = pcall(function() return actor:K2_GetActorLocation() end)
    if ok and v and type(v.X) == "number" then return string.format("(%.0f, %.0f, %.0f)", v.X, v.Y, v.Z) end
    return "?"
end

--- Names and types of a class's properties and functions (its own and its
--- parents' down to Actor) — metadata only, no value is read.
local function describeClass(cls)
    local depth = 0
    while cls ~= nil and depth < 8 do
        local cname = nameOf(cls)
        if cname == "Actor" or cname == "Object" or cname == "Pawn" or cname == "Character" then break end
        local props, fns = {}, {}
        pcall(function()
            cls:ForEachProperty(function(p)
                if #props < MAX_MEMBERS then props[#props + 1] = nameOf(p) .. ":" .. nameOf(p:GetClass()) end
            end)
        end)
        pcall(function()
            cls:ForEachFunction(function(fn)
                if #fns < MAX_MEMBERS then fns[#fns + 1] = nameOf(fn) end
            end)
        end)
        out("    [%d %s] %d properties: %s", depth, cname, #props, table.concat(props, ", "))
        out("    [%d %s] %d functions: %s", depth, cname, #fns, table.concat(fns, ", "))
        local okS, super = pcall(function() return cls:GetSuperStruct() end)
        cls = okS and super or nil
        depth = depth + 1
    end
end

local function actorCensus()
    local okA, all = pcall(function() return FindAllOf("Actor") or {} end)
    if not okA then out("FindAllOf(Actor) failed"); return end
    local byClass, order = {}, {}
    for _, a in ipairs(all) do
        local c = classOf(a)
        local n = c and nameOf(c) or "?"
        local e = byClass[n]
        if not e then e = { n = 0, cls = c, samples = {} }; byClass[n] = e; order[#order + 1] = n end
        e.n = e.n + 1
        if #e.samples < SAMPLES and interesting(n) then e.samples[#e.samples + 1] = whereOf(a) end
    end
    table.sort(order, function(a, b) return byClass[a].n > byClass[b].n end)
    out("=== ACTORS: %d in %d classes ===", #all, #order)
    for _, n in ipairs(order) do
        out("  %6d  %s%s", byClass[n].n, n, interesting(n) and ("  <-- " .. table.concat(byClass[n].samples, " ")) or "")
    end
    out("=== the plant / zone looking classes, described (names and types only) ===")
    for _, n in ipairs(order) do
        if interesting(n) and byClass[n].cls then
            out("  %s (%d)", n, byClass[n].n)
            describeClass(byClass[n].cls)
        end
    end
end

local function foliageCensus()
    out("=== INSTANCED MESHES (foliage) ===")
    local okC, comps = pcall(function() return FindAllOf("InstancedStaticMeshComponent") or {} end)
    if not okC then out("FindAllOf(InstancedStaticMeshComponent) failed"); return end
    local byOwner, total = {}, 0
    for _, c in ipairs(comps) do
        local okN, count = pcall(function() return c:GetInstanceCount() end)
        local okO, owner = pcall(function() return c:GetOwner() end)
        local ownerCls = okO and owner and classOf(owner)
        local key = (ownerCls and nameOf(ownerCls) or "?") .. " / " .. (nameOf(classOf(c) or c))
        local e = byOwner[key] or { comps = 0, inst = 0, names = {} }
        byOwner[key] = e
        e.comps = e.comps + 1
        if okN and type(count) == "number" then e.inst = e.inst + count; total = total + count end
        if #e.names < 12 then e.names[#e.names + 1] = nameOf(c) .. "=" .. tostring(okN and count or "?") end
    end
    out("%d components, %d instances", #comps, total)
    for key, e in pairs(byOwner) do
        out("  %s: %d components, %d instances — %s", key, e.comps, e.inst, table.concat(e.names, ", "))
    end
end

local function probe()
    -- The flag first: a crash below must not repeat on every start.
    local f = io.open(FLAG, "w")
    if f then f:write(tostring(os.time())); f:close() end
    out("PlantProbe ran at %s", os.date("!%Y-%m-%d %H:%M:%S UTC"))
    H.try(MOD .. ": actors", actorCensus)
    flush()
    H.try(MOD .. ": foliage", foliageCensus)
    flush()
    out("done")
    flush()
end

local already = io.open(FLAG, "r")
if already then
    already:close()
    H.log(MOD .. ": already ran (delete " .. FLAG .. " to run again) — nothing to do")
else
    H.defer(AFTER_MS, probe)
    H.log(MOD .. ": loaded — probing plants in " .. (AFTER_MS // 1000) .. " s, report in " .. OUT)
end
