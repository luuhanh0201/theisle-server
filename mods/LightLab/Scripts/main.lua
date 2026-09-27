-- LightLab — TEST SERVER ONLY (off in ue4ss/mods.txt; turned on by hand in the
-- test copy). Looking for a light that would show on players' machines dim or
-- coloured: a client builds a replicated actor from its CLASS DEFAULTS (a
-- light's colour / intensity set on the server do not reach it — the engine
-- PointLight showed white on the live server, 2026-09-27). So: is there a
-- class in the game whose light is already dim or coloured by default?
-- Writes to Mods/LightLab/Saved/lightlab.txt, READ ONLY:
--   1. world: one actor of each class in the world — its light components
--      (class, colour, intensity, radius)
--   2. dino: a Deinosuchus spawned for the test — any light on it?
--   3. memory: every loaded object whose class is a light component (placed
--      or a Blueprint's template), with its owner / outer and numbers
-- Each step is flagged (Saved/<step>.trying): a crash in one is named at the
-- next start and that step is not run again.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H = require("shared.isle.helpers")

local MOD  = "LightLab"
local DIR  = "Mods/LightLab/Saved/"
local OUT  = DIR .. "lightlab.txt"
local DINO = "/Game/TheIsle/Core/Characters/Dinosaurs/Deinosuchus/BP_Deinosuchus.BP_Deinosuchus_C"
local STATICS = "/Script/Engine.Default__GameplayStatics"
local LIGHT_COMPONENT = "/Script/Engine.LightComponent"
local AT = { X = 350856, Y = -354551, Z = 39315 }
local START_AFTER_S = 90
local MAX_MEMORY_HITS = 150

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

local STEPS = { "world", "dino", "memory" }
local crashed = {}
for _, s in ipairs(STEPS) do if exists(DIR .. s .. ".trying") then crashed[s] = true end end
local function step(name, fn)
    if crashed[name] then out("step %s: SKIPPED — the server stopped during it last time (crash)", name); return false end
    write(DIR .. name .. ".trying", tostring(os.time()))
    local ok, err = pcall(fn)
    os.remove(DIR .. name .. ".trying")
    if not ok then out("step %s: error %s", name, tostring(err)) end
    return ok
end

local function isValid(o) return o ~= nil and H.isValid(o) end
local function addressOf(o) local ok, a = pcall(function() return o:GetAddress() end); return ok and a ~= 0 and a or nil end
local function find(path) local ok, o = pcall(function() return StaticFindObject(path) end); return ok and isValid(o) and o or nil end
local function className(o) local ok, n = pcall(function() return o:GetClass():GetFName():ToString() end); return ok and tostring(n) or "?" end
local function num(o, n) local ok, v = pcall(function() return o[n] end); return ok and type(v) == "number" and v or nil end

--- A light component's numbers: "PointLightComponent rgb(255,200,120) I=5000 R=1000".
local function lightText(c)
    local col = "?"
    pcall(function() local lc = c.LightColor; col = string.format("rgb(%d,%d,%d)", lc.R, lc.G, lc.B) end)
    local okV, vis = pcall(function() return c:IsVisible() end)
    return string.format("%s %s I=%s R=%s temp=%s%s", className(c), col, tostring(num(c, "Intensity")),
        tostring(num(c, "AttenuationRadius")), tostring(num(c, "Temperature")), (okV and vis == false) and " (hidden)" or "")
end

--- The light components of an actor (GetComponentsByClass).
local function lightsOf(actor, lightCls)
    local ok, comps = pcall(function() return actor:K2_GetComponentsByClass(lightCls) end)
    if not ok or comps == nil then return {} end
    local list = {}
    pcall(function() for i = 1, #comps do list[#list + 1] = comps[i] end end)
    return list
end

local phase, loadedAt, nextAt, dinoAddr = 1, os.time(), 0, nil
H.every(2000, MOD .. ": step", function()
    local now = os.time()
    if now < loadedAt + START_AFTER_S or now < nextAt or phase > 4 then return end
    local okG, world = pcall(function()
        local gs = FindFirstOf("TIGameStateBase")
        return isValid(gs) and gs:GetWorld() or nil
    end)
    if not (okG and isValid(world)) then return end
    local lightCls = find(LIGHT_COMPONENT)

    if phase == 1 then
        step("world", function()
            if lightCls == nil then out("world: LightComponent class not found"); return end
            local ok, all = pcall(function() return FindAllOf("Actor") or {} end)
            local seen, withLights = {}, 0
            for _, a in ipairs(ok and all or {}) do
                local c = className(a)
                if not seen[c] then
                    seen[c] = true
                    local ls = lightsOf(a, lightCls)
                    if #ls > 0 then
                        withLights = withLights + 1
                        local t = {}
                        for _, l in ipairs(ls) do t[#t + 1] = lightText(l) end
                        out("world: %s has %d light(s): %s", c, #ls, table.concat(t, " | "))
                    end
                end
            end
            out("world: %d classes looked at, %d with lights", (function() local n = 0; for _ in pairs(seen) do n = n + 1 end; return n end)(), withLights)
        end)
        phase, nextAt = 2, now + 2
    elseif phase == 2 then
        step("dino", function()
            local statics, cls = find(STATICS), find(DINO)
            if cls == nil and type(LoadAsset) == "function" then pcall(function() LoadAsset(DINO) end); cls = find(DINO) end
            if not (statics and cls) then out("dino: class not found"); return end
            local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = AT, Scale3D = { X = 1, Y = 1, Z = 1 } }
            local a = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
            if a == nil or addressOf(a) == nil then out("dino: nothing made"); return end
            statics:FinishSpawningActor(a, xf, 1)
            dinoAddr = addressOf(a)
            local ls = lightCls and lightsOf(a, lightCls) or {}
            local t = {}
            for _, l in ipairs(ls) do t[#t + 1] = lightText(l) end
            out("dino: a Deinosuchus has %d light(s)%s", #ls, #t > 0 and (": " .. table.concat(t, " | ")) or "")
        end)
        phase, nextAt = 3, now + 4
    elseif phase == 3 then
        step("memory", function()
            if type(ForEachUObject) ~= "function" then out("memory: ForEachUObject not in this UE4SS build"); return end
            local hits, scanned = 0, 0
            local byOuter = {}
            ForEachUObject(function(obj)
                scanned = scanned + 1
                if hits >= MAX_MEMORY_HITS then return end
                local okN, cn = pcall(function() return obj:GetClass():GetFName():ToString() end)
                if not okN then return end
                cn = tostring(cn)
                if cn:find("LightComponent", 1, true) == nil or cn:find("Sky", 1, true) or cn:find("Directional", 1, true) then return end
                hits = hits + 1
                local okF, full = pcall(function() return obj:GetFullName() end)
                local name = okF and tostring(full) or "?"
                byOuter[#byOuter + 1] = name:sub(1, 180) .. " :: " .. lightText(obj)
            end)
            out("memory: %d objects scanned, %d light components (sky / sun left out)%s", scanned, hits,
                hits >= MAX_MEMORY_HITS and " — stopped at the limit" or "")
            table.sort(byOuter)
            for _, l in ipairs(byOuter) do out("memory: %s", l) end
        end)
        phase, nextAt = 4, now + 2
    elseif phase == 4 then
        out("DONE")
        phase = 5
    end
end)

out("loaded — the probe starts %d s after load", START_AFTER_S)
