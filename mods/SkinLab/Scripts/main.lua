-- SkinLab — TEST SERVER ONLY (off in ue4ss/mods.txt; scripts/test-server.sh
-- turns it on in the test copy). Tries on a dino nobody plays what the skin
-- features would do on the live server, and writes what happened to
-- Mods/SkinLab/Saved/skinlab.txt:
--   1. spawn a Deinosuchus (the deferred spawn AIZones uses)
--   2. read its skin effects (H.readSkinEffects: reflection first, only numbers)
--      and its CustomizerData (H.readSkin)
--   3. write "HDR" colours (above 1), a pattern / theme / variation out of the
--      usual range, field by field (as garage/skin.lua does)
--   4. read them back: kept, or clamped by the game?
--   5. call the game's effect setters (SetMudAmount, SetBloodAmount,
--      SetDirtAmount) with 0.8 and read the effects again
-- Each step is flagged (Saved/<step>.trying before, removed after): a crash
-- in one is named at the next start and that step is not run again.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local MOD  = "SkinLab"
local DIR  = "Mods/SkinLab/Saved/"
local OUT  = DIR .. "skinlab.txt"
local PAWN = "/Game/TheIsle/Core/Characters/Dinosaurs/Deinosuchus/BP_Deinosuchus.BP_Deinosuchus_C"
local STATICS = "/Script/Engine.Default__GameplayStatics"
-- A lake shore on Gateway (a Deinosuchus stood here on 2026-09-27), a little above ground.
local AT = { X = 350856, Y = -354551, Z = 39315 }
local START_AFTER_S = 90

local rows = {}
local function out(fmt, ...)
    local line = string.format(fmt, ...)
    rows[#rows + 1] = os.date("!%H:%M:%S ") .. line
    H.log(MOD .. ": " .. line)
    local f = io.open(OUT, "w")
    if f then f:write(table.concat(rows, "\n"), "\n"); f:close() end
end

local function exists(path) local f = io.open(path, "r"); if f then f:close(); return true end; return false end
local function write(path, text) local f = io.open(path, "w"); if f then f:write(text); f:close() end end

local STEPS = { "spawn", "read", "write", "readback", "setters" }
local crashed = {}
for _, s in ipairs(STEPS) do
    if exists(DIR .. s .. ".trying") then crashed[s] = true end
end

--- Run one step once, flag first. false when it crashed a previous run (skipped).
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

local pawnAddr = nil
--- The spawned dino, found fresh (never kept across ticks).
local function ourDino()
    if pawnAddr == nil then return nil end
    local ok, all = pcall(function() return FindAllOf("BP_Deinosuchus_C") or {} end)
    for _, p in ipairs(ok and all or {}) do if addressOf(p) == pawnAddr then return p end end
    return nil
end

local function skinText(sk)
    if sk == nil then return "nil" end
    return json.encode(sk)
end

local phase, loadedAt, nextAt = 1, os.time(), 0
H.every(2000, MOD .. ": step", function()
    local now = os.time()
    if now < loadedAt + START_AFTER_S or now < nextAt or phase > #STEPS + 1 then return end

    if phase == 1 then
        local okG, world = pcall(function()
            local gs = FindFirstOf("TIGameStateBase")
            return isValid(gs) and gs:GetWorld() or nil
        end)
        if not (okG and isValid(world)) then return end   -- the world is not up yet
        step("spawn", function()
            local cls = find(PAWN)
            if cls == nil and type(LoadAsset) == "function" then
                pcall(function() LoadAsset(PAWN) end)
                cls = find(PAWN)
            end
            if cls == nil then out("spawn: class not found (%s)", PAWN); return end
            local statics = find(STATICS)
            local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = AT, Scale3D = { X = 1, Y = 1, Z = 1 } }
            local actor = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
            if actor == nil or addressOf(actor) == nil then out("spawn: nothing made"); return end
            statics:FinishSpawningActor(actor, xf, 1)
            pawnAddr = addressOf(actor)
            out("spawn: a Deinosuchus at (%d, %d, %d)", AT.X, AT.Y, AT.Z)
        end)
        phase, nextAt = 2, now + 6
        return
    end

    local pawn = ourDino()
    if pawn == nil then out("no dino to test (spawn failed or it is gone) — stopping"); phase = #STEPS + 2; return end

    if phase == 2 then
        step("read", function()
            local e = H.readSkinEffects(pawn)
            if e == nil then out("read: no skin effects found on the pawn")
            else
                local f = {}
                for _, x in ipairs(e.fields) do f[#f + 1] = x[1] .. ":" .. x[2] end
                out("read: effects struct %s — fields [%s]", tostring(e.struct), table.concat(f, ", "))
                out("read: effects values %s", json.encode(e.values))
            end
            out("read: CustomizerData %s", skinText(H.readSkin(pawn)))
        end)
        phase, nextAt = 3, now + 2
    elseif phase == 3 then
        step("write", function()
            local data = pawn.CustomizerData
            local wrote = {}
            local function color(field, r, g, b)
                local ok = pcall(function() local c = data[field]; c.R = r; c.G = g; c.B = b end)
                wrote[#wrote + 1] = field .. (ok and "" or " FAILED")
            end
            color("BodyColor", 3, 0.5, 0)        -- "red, three times brighter than white"
            color("MarkingsColor", 0, 4, 6)       -- cyan, far above 1
            color("EyesColor", 8, 8, 0)
            local okP = pcall(function() data.PatternIndex = 5 end)
            local okT = pcall(function() data.ThemeIndex = 9 end)
            local okV = pcall(function() data.SkinVariation = 50 end)
            out("write: %s; PatternIndex=5 %s, ThemeIndex=9 %s, SkinVariation=50 %s", table.concat(wrote, ", "),
                okP and "ok" or "FAILED", okT and "ok" or "FAILED", okV and "ok" or "FAILED")
        end)
        phase, nextAt = 4, now + 4
    elseif phase == 4 then
        step("readback", function()
            out("readback: CustomizerData %s", skinText(H.readSkin(pawn)))
            local okR, bodyR = pcall(function() return pawn.CustomizerData.BodyColor.R end)
            out("readback: BodyColor.R = %s (3 written: %s)", tostring(okR and bodyR),
                (okR and type(bodyR) == "number" and bodyR > 1.5) and "KEPT above 1" or "clamped or not read")
        end)
        phase, nextAt = 5, now + 2
    elseif phase == 5 then
        step("setters", function()
            for _, fn in ipairs({ "SetMudAmount", "SetBloodAmount", "SetDirtAmount" }) do
                local ok, err = pcall(function() pawn[fn](pawn, 0.8) end)
                out("setters: %s(0.8) %s", fn, ok and "called" or ("failed: " .. tostring(err)))
            end
        end)
        phase, nextAt = 6, now + 3
    elseif phase == 6 then
        local e = H.readSkinEffects(pawn)
        out("after setters: effects %s", e and json.encode(e.values) or "none")
        out("DONE")
        phase = #STEPS + 2
    end
end)

out("loaded — the test starts %d s after load", START_AFTER_S)
