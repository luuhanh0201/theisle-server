-- GrowthLab, TEST SERVER ONLY (off in ue4ss/mods.txt; turned on by hand in the
-- test copy). The 2026-10-05 vomit (a T-Rex's stomach left at 1,725 on 52 %
-- after an admin's growth and two growth bags): every growth write the mod
-- makes must leave the stomach at the species' share of the max health, as
-- the game itself does, its originals too, and the food at most full.
--
-- For every playable species, on a dino spawned for it, with the DinoGarage
-- mod's OWN code (garage/admin.lua, garage/stomach.lua):
--   spawn -> the game's own stomach / health share (as spawned), against
--   stomach.lua's table -> SetGrowth 0.62 + Stomach.fit (a garage redeem),
--   wait (an older dino) -> Admin.grow 0.32 (an admin) -> 0.42, 0.52 (growth
--   bags) -> Admin.feed 0.5 (a food box) -> Admin.grow 1 + prime (a Phiếu
--   Prime) -> kill. After each write, and again a few seconds later (does the
--   game move it on its own?): growth, max health, stomach, OriginalMaxHunger,
--   food; PASS when stomach = share x max health (1 %) and food <= stomach.
-- Results: Saved/growthlab.txt (to read) and growthlab.json, rewritten after
-- every reading. Flag first per species (Saved/<species>.trying), as the
-- other labs: found at load, the species is skipped.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
-- The DinoGarage mod's own modules (require("garage.admin") …).
if not package.path:find("Mods/DinoGarage/Scripts/?.lua", 1, true) then
    package.path = "Mods/DinoGarage/Scripts/?.lua;" .. package.path
end
local H       = require("shared.isle.helpers")
local json    = require("shared.isle.json")
local Admin   = require("garage.admin")
local Stomach = require("garage.stomach")

local MOD  = "GrowthLab"
local DIR  = "Mods/GrowthLab/Saved/"
local DINOS = "/Game/TheIsle/Core/Characters/Dinosaurs/"
local STATICS = "/Script/Engine.Default__GameplayStatics"
local AT = { X = 350856, Y = -354551, Z = 39315 }   -- StatLab's spot: open ground
local START_AFTER_S = 90
local TOLERANCE = 0.01

local SPECIES = {
    "Tyrannosaurus", "Allosaurus", "Austroraptor", "Beipiaosaurus", "Carnotaurus", "Ceratosaurus",
    "Deinosuchus", "Diabloceratops", "Dilophosaurus", "Dryosaurus", "Gallimimus",
    "Herrerasaurus", "Hypsilophodon", "Kentrosaurus", "Maiasaura", "Omniraptor",
    "Pachycephalosaurus", "Pteranodon", "Stegosaurus", "Tenontosaurus", "Triceratops", "Troodon",
}

-- { wait before (s), label, what to do (pawn) }; a nil action = a reading only.
local PLAN = {
    { 4,  "as spawned",                 nil },
    { 0,  "garage: 62 % + fit",         function(p) pcall(function() p:SetGrowth(0.62) end); Stomach.fit(p) end },
    { 15, "62 %, 15 s later",           nil },
    { 0,  "admin growth -> 32 %",       function(p) Admin.grow(p, 0.32) end },
    { 6,  "32 %, 6 s later",            nil },
    { 0,  "growth bag -> 42 %",         function(p) Admin.grow(p, 0.42) end },
    { 0,  "growth bag -> 52 %",         function(p) Admin.grow(p, 0.52) end },
    { 10, "52 %, 10 s later",           nil },
    { 0,  "food box +50 %",             function(p) Admin.feed(p, 0.5) end },
    { 0,  "Phieu Prime: 100 % + prime", function(p) Admin.grow(p, 1, true) end },
    { 8,  "prime, 8 s later",           nil },
}

local results, summary = {}, { pass = 0, fail = 0 }
local function exists(p) local f = io.open(p, "r"); if f then f:close(); return true end; return false end
local function write(p, t) local f = io.open(p, "w"); if f then f:write(t); f:close() end end
local function isValid(o) return o ~= nil and H.isValid(o) end
local function addressOf(o) local ok, a = pcall(function() return o:GetAddress() end); return ok and a ~= 0 and a or nil end
local function find(path) local ok, o = pcall(function() return StaticFindObject(path) end); return ok and isValid(o) and o or nil end
local function num(p, fn) local ok, v = pcall(function() return p[fn](p) end); return ok and type(v) == "number" and v or nil end

local function originalMaxHunger(pawn)
    local addr = addressOf(pawn)
    local ok, sets = pcall(function() return FindAllOf("TIAttributeSetDinosaur") or {} end)
    for _, s in ipairs(ok and sets or {}) do
        local okO, outer = pcall(function() return s:GetOuter():GetAddress() end)
        if okO and outer == addr then
            local okV, v = pcall(function() return s.OriginalMaxHunger.CurrentValue end)
            return okV and v or nil
        end
    end
    return nil
end

local function save()
    write(DIR .. "growthlab.json", json.encode({ species = results, summary = summary, t = os.time() }))
    local rows = { string.format("GrowthLab: %d PASS, %d FAIL (stomach = share x max health within %d %%, food <= stomach)",
        summary.pass, summary.fail, TOLERANCE * 100) }
    for _, name in ipairs(SPECIES) do
        local r = results[name]
        if r then
            rows[#rows + 1] = string.format("== %s: %s  table share %s, game's own %s", name, r.status,
                tostring(r.tableShare), r.gameShare and string.format("%.4f", r.gameShare) or "?")
            for _, s in ipairs(r.readings) do
                rows[#rows + 1] = string.format("   %-4s %-28s g=%.3f  health %9.1f  stomach %8.1f (want %8.1f)  original %8s  food %8.1f",
                    s.ok and "ok" or "FAIL", s.label, s.growth or -1, s.health or -1, s.stomach or -1, s.want or -1,
                    s.original and string.format("%.1f", s.original) or "?", s.food or -1)
            end
        end
    end
    write(DIR .. "growthlab.txt", table.concat(rows, "\n") .. "\n")
end

local idx, step, nextAt, loadedAt, current = 1, 0, 0, os.time(), nil

local function thePawn(name)
    if current == nil then return nil end
    local ok, all = pcall(function() return FindAllOf("BP_" .. name .. "_C") or {} end)
    for _, p in ipairs(ok and all or {}) do if addressOf(p) == current.addr and isValid(p) then return p end end
    return nil
end

local function read(name, pawn, label, first)
    local r = results[name]
    local health, stomach, food = num(pawn, "GetMaxHealth"), num(pawn, "GetMaxHunger"), num(pawn, "GetHunger")
    local s = { label = label, growth = num(pawn, "GetGrowth"), health = health, stomach = stomach, food = food,
        original = originalMaxHunger(pawn) }
    if first then
        -- As spawned: the game's own share, every max its own.
        r.gameShare = (health and stomach and health > 0) and stomach / health or nil
        s.want = stomach
        s.ok = r.gameShare ~= nil and r.tableShare ~= nil and math.abs(r.gameShare / r.tableShare - 1) <= TOLERANCE
    else
        s.want = (r.tableShare and health) and r.tableShare * health or nil
        s.ok = s.want ~= nil and stomach ~= nil and math.abs(stomach / s.want - 1) <= TOLERANCE
            and (food == nil or food <= stomach + 0.01)
    end
    r.readings[#r.readings + 1] = s
    if s.ok then summary.pass = summary.pass + 1 else summary.fail = summary.fail + 1 end
    save()
end

local function finish(name, status)
    if results[name] then results[name].status = status end
    os.remove(DIR .. name .. ".trying")
    save()
    H.log(MOD .. ": " .. name .. ", " .. status)
end

H.every(1000, MOD .. ": step", function()
    local now = os.time()
    if now < loadedAt + START_AFTER_S or now < nextAt or idx > #SPECIES then return end
    local name = SPECIES[idx]

    if current == nil then
        if exists(DIR .. name .. ".trying") then
            results[name] = { status = "SKIPPED, the server stopped while testing it last time", readings = {} }
            os.remove(DIR .. name .. ".trying")
            idx = idx + 1
            save()
            return
        end
        local okW, world = pcall(function()
            local gs = FindFirstOf("TIGameStateBase")
            return isValid(gs) and gs:GetWorld() or nil
        end)
        if not (okW and isValid(world)) then return end
        local path = DINOS .. name .. "/BP_" .. name .. ".BP_" .. name .. "_C"
        results[name] = { status = "testing", readings = {}, tableShare = Stomach.RATIO[name] }
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
        current, step = { addr = addr }, 1
        nextAt = now + PLAN[1][1]
        return
    end

    local pawn = thePawn(name)
    if pawn == nil then
        finish(name, string.format("pawn gone at step %d", step))
        current, idx = nil, idx + 1
        return
    end

    local p = PLAN[step]
    if p[3] ~= nil then
        local ok, err = pcall(p[3], pawn)
        if not ok then H.logError(MOD .. ": " .. name .. " " .. p[2] .. ": " .. tostring(err)) end
    end
    read(name, pawn, p[2], step == 1)
    step = step + 1
    if step > #PLAN then
        pcall(function() pawn:SetHealth(0) end)
        local fails = 0
        for _, s in ipairs(results[name].readings) do if not s.ok then fails = fails + 1 end end
        finish(name, fails == 0 and "PASS" or string.format("FAIL (%d)", fails))
        current, idx, nextAt = nil, idx + 1, now + 3
        if idx > #SPECIES then H.log(MOD .. ": ALL DONE") end
        return
    end
    nextAt = now + PLAN[step][1]
end)

H.log(string.format("%s: loaded, %d species, starting %d s after load", MOD, #SPECIES, START_AFTER_S))
