-- SpeciesLab — TEST SERVER ONLY (off in ue4ss/mods.txt; turned on by hand in the
-- test copy). Every species' maxima at every growth, measured on the game
-- itself: the panel's "expected stats" only know what players happened to
-- play (2026-10-01: 20 species, most not up to 100 %), and the four
-- blueprints the game does not let anyone play yet (Avaceratops, Baryonyx,
-- Camarasaurus, Oviraptor) had no numbers at all.
--
-- One species at a time, on the game thread (H.every), at one spot:
--   spawn (BeginDeferredActorSpawnFromClass + FinishSpawningActor, as StatLab
--   and AIZones) -> read the maxima as spawned -> SetGrowth through GROWTHS,
--   reading after each -> SetHealth(0) (never K2_DestroyActor: it crashed on
--   an actor the game had removed) -> next species.
-- SetGrowth does NOT update the stomach max (it keeps the hatchling's until a
-- relog, restore.lua), so the as-spawned reading is kept apart: it is the
-- only one where every max is the game's own.
--
-- Flag first per species (Saved/<species>.trying): found at load, that
-- species is skipped (it took the server down last time) and the run goes on.
-- Results: Saved/species.json (machine) and Saved/species.txt (to read),
-- rewritten after every species.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local MOD  = "SpeciesLab"
local DIR  = "Mods/SpeciesLab/Saved/"
local DINOS = "/Game/TheIsle/Core/Characters/Dinosaurs/"
local STATICS = "/Script/Engine.Default__GameplayStatics"
local AT = { X = 350856, Y = -354551, Z = 39315 }   -- StatLab's spot: open ground
local START_AFTER_S = 90
local STEP_S = 2

local SPECIES = {
    "Allosaurus", "Austroraptor", "Beipiaosaurus", "Carnotaurus", "Ceratosaurus",
    "Deinosuchus", "Diabloceratops", "Dilophosaurus", "Dryosaurus", "Gallimimus",
    "Herrerasaurus", "Hypsilophodon", "Kentrosaurus", "Maiasaura", "Omniraptor",
    "Pachycephalosaurus", "Pteranodon", "Stegosaurus", "Tenontosaurus", "Triceratops",
    "Troodon", "Tyrannosaurus",
    -- blueprints only, not playable on this build
    "Avaceratops", "Baryonyx", "Camarasaurus", "Oviraptor",
}
local GROWTHS = { 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1.0 }
local STATS = { "Health", "Stamina", "Hunger", "Thirst", "Oxygen", "Blood" }

local results = {}
local function exists(p) local f = io.open(p, "r"); if f then f:close(); return true end; return false end
local function write(p, t) local f = io.open(p, "w"); if f then f:write(t); f:close() end end

local function save()
    write(DIR .. "species.json", json.encode({ species = results, t = os.time() }))
    local rows = {}
    for _, name in ipairs(SPECIES) do
        local r = results[name]
        if r then
            rows[#rows + 1] = string.format("== %s: %s", name, r.status)
            local function line(label, g, m)
                local parts = {}
                for _, s in ipairs(STATS) do
                    parts[#parts + 1] = string.format("%s %s", s:lower(), m[s:lower()] and string.format("%.2f", m[s:lower()]) or "?")
                end
                rows[#rows + 1] = string.format("   %-12s g=%s  %s", label, g and string.format("%.3f", g) or "?", table.concat(parts, "  "))
            end
            if r.spawned then line("as spawned", r.spawned.growth, r.spawned.max) end
            for _, s in ipairs(r.steps or {}) do line("SetGrowth", s.growth, s.max) end
        end
    end
    write(DIR .. "species.txt", table.concat(rows, "\n") .. "\n")
end

local function isValid(o) return o ~= nil and H.isValid(o) end
local function addressOf(o) local ok, a = pcall(function() return o:GetAddress() end); return ok and a ~= 0 and a or nil end
local function find(path) local ok, o = pcall(function() return StaticFindObject(path) end); return ok and isValid(o) and o or nil end
local function num(p, fn) local ok, v = pcall(function() return p[fn](p) end); return ok and type(v) == "number" and v or nil end

local function maxima(pawn)
    local m = {}
    for _, s in ipairs(STATS) do m[s:lower()] = num(pawn, "GetMax" .. s) end
    return m
end

local function finish(name, status)
    if results[name] then results[name].status = status end
    os.remove(DIR .. name .. ".trying")
    save()
    H.log(MOD .. ": " .. name .. " — " .. status)
end

local idx, phase, nextAt, loadedAt = 1, "spawn", 0, os.time()
local current = nil   -- { name, cls, addr, step }

local function thePawn()
    if current == nil or current.addr == nil then return nil end
    local ok, all = pcall(function() return FindAllOf("BP_" .. current.name .. "_C") or {} end)
    for _, p in ipairs(ok and all or {}) do if addressOf(p) == current.addr and isValid(p) then return p end end
    return nil
end

H.every(STEP_S * 1000, MOD .. ": step", function()
    local now = os.time()
    if now < loadedAt + START_AFTER_S or now < nextAt or idx > #SPECIES then return end
    local name = SPECIES[idx]

    if phase == "spawn" then
        if exists(DIR .. name .. ".trying") then
            results[name] = { status = "SKIPPED — the server stopped while measuring it last time (crash)" }
            os.remove(DIR .. name .. ".trying")
            save()
            idx = idx + 1
            return
        end
        local okW, world = pcall(function()
            local gs = FindFirstOf("TIGameStateBase")
            return isValid(gs) and gs:GetWorld() or nil
        end)
        if not (okW and isValid(world)) then return end
        local path = DINOS .. name .. "/BP_" .. name .. ".BP_" .. name .. "_C"
        results[name] = { path = path, steps = {}, status = "measuring" }
        write(DIR .. name .. ".trying", tostring(now))
        local statics, cls = find(STATICS), find(path)
        if cls == nil and type(LoadAsset) == "function" then pcall(function() LoadAsset(path) end); cls = find(path) end
        if not (statics and cls) then finish(name, "class not found"); idx = idx + 1; return end
        local addr = nil
        pcall(function()
            local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = AT, Scale3D = { X = 1, Y = 1, Z = 1 } }
            local a = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
            if a ~= nil and addressOf(a) ~= nil then statics:FinishSpawningActor(a, xf, 1); addr = addressOf(a) end
        end)
        if addr == nil then finish(name, "spawn failed"); idx = idx + 1; return end
        current = { name = name, addr = addr, step = 0 }
        phase, nextAt = "spawned", now + 4      -- let BeginPlay compute its stats
        return
    end

    local pawn = thePawn()
    if pawn == nil then
        finish(name, string.format("pawn gone after %d growth steps", current and current.step or 0))
        current, phase, idx = nil, "spawn", idx + 1
        return
    end

    if phase == "spawned" then
        results[name].spawned = { growth = num(pawn, "GetGrowth"), max = maxima(pawn) }
        phase = "grow"
        save()
    end

    if phase == "grow" then
        local st = current.step
        if st > 0 then
            local g = GROWTHS[st]
            results[name].steps[#results[name].steps + 1] = { growth = num(pawn, "GetGrowth") or g, asked = g, max = maxima(pawn) }
        end
        if st < #GROWTHS then
            current.step = st + 1
            local g = GROWTHS[current.step]
            local ok = pcall(function() pawn:SetGrowth(g) end)
            if not ok then finish(name, "SetGrowth failed at " .. g); phase = "kill" end
            nextAt = now + STEP_S
            return
        end
        phase = "kill"
    end

    if phase == "kill" then
        pcall(function() pawn:SetHealth(0) end)
        finish(name, results[name].status == "measuring" and "done" or results[name].status)
        current, phase, idx, nextAt = nil, "spawn", idx + 1, now + 3
        if idx > #SPECIES then H.log(MOD .. ": ALL DONE") end
    end
end)

H.log(string.format("%s: loaded — %d species, starting %d s after load", MOD, #SPECIES, START_AFTER_S))
