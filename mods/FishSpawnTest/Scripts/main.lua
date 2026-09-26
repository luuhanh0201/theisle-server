-- FishSpawnTest — TEST SERVER ONLY (theisle-test, not in the live mods.txt).
--
-- Can a mod spawn the game's fish, as AIZones spawns boars? FishFind step 3
-- (2026-09-26) gave the classes: /Game/TheIsle/Core/AI/Characters/Fish/BP_*.
-- BP_*_C, and step 1 the controller /Script/TheIsle.TIAIFishController.
-- Once, a minute after load: 3 catfish at a lake a Deinosuchus player stood in
-- (x 105026, y -243570, z 27738), at 3 depths, each with a fish controller
-- (SpawnActor + Possess, like AIZones); 20 s later where they are, found
-- among the Pawns (never a reference kept across ticks). Every step written
-- before the next, so a crash says where. Flag first: no crash loop.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H = require("shared.isle.helpers")

local MOD = "FishSpawnTest"
local DIR = "Mods/AIZones/Saved/"
-- Run 1 (fishspawn.flag): the pawn spawned, then the server CRASHED at the
-- controller (SpawnActor of TIAIFishController / Possess). Run 2: pawns only,
-- no controller — do they stay, where, and do they move?
-- Run 2 (fishspawn2.flag): 3 pawns spawned, none among the Pawns 20 s later —
-- not Pawns, or gone. Run 3: found by their own classes (BP_Catfish_C,
-- TIFishBase, TIAmbientFish) 5 s and 30 s after.
-- Run 3 (fishspawn3.flag): BP_Catfish_C is a TIAmbientFish, not a Pawn;
-- the 3 stayed 30 s, but read at (0, 0, 0). Run 4: one fish — its location
-- right after the spawn, a root component or not, then K2_SetActorLocation.
-- Run 4 (fishspawn4.flag): right after the spawn the fish IS at the lake
-- (root component, location right); 5 s later it reads (0, 0, 0) — parked by
-- the game's fish system? Run 5: the names of TIAmbientFish's and
-- BP_Catfish_C's own functions and properties (the class's lists; no parent
-- walk — that crashed) to find how the game places a fish.
-- Run 5 (fishspawn5.flag): TIAmbientFish has no functions of its own, but
-- RelevanceDistance, DespawnDelaySeconds, MinimumWaterDepth, Client*
-- smoothing… — a server-side swimmer, replicated, parked with no player near?
-- Run 6: once a player is online, 3 catfish around them 1.5 m under them,
-- their places every 5 s for a minute (and the fish's own numbers).
local FLAG = DIR .. "fishspawn6.flag"
local OUT = DIR .. "fishspawn6.txt"
local WAIT_FOR_PLAYER = true
local USE_CONTROLLER = false
local PAWN = "/Game/TheIsle/Core/AI/Characters/Fish/BP_Catfish.BP_Catfish_C"
local CTRL = "/Script/TheIsle.TIAIFishController"
local AT = { X = 105026, Y = -243570, Z = 27738 }
local DEPTHS = { 100, 300, 600 }

local rows = {}
local function out(fmt, ...)
    rows[#rows + 1] = string.format(fmt, ...)
    local f = io.open(OUT, "w")
    if f then f:write(table.concat(rows, "\n"), "\n"); f:close() end
end
local function find(path)
    local ok, o = pcall(function() return StaticFindObject(path) end)
    if ok and o ~= nil and H.isValid(o) then return o end
    return nil
end
local function addr(o)
    local ok, a = pcall(function() return o:GetAddress() end)
    return ok and type(a) == "number" and a ~= 0 and a or nil
end

local function spawn(AT)
    local f = io.open(FLAG, "w")
    if f then f:write(tostring(os.time())); f:close() end
    out("FishSpawnTest at %s", os.date("!%Y-%m-%d %H:%M:%S UTC"))
    local pawnCls, ctrlCls = find(PAWN), find(CTRL)

    out("classes: pawn %s, controller %s", pawnCls and "found" or "NOT FOUND", ctrlCls and "found" or "NOT FOUND")
    if not pawnCls then return end
    local okW, world = pcall(function() return FindFirstOf("TIGameStateBase"):GetWorld() end)
    if not okW or world == nil then out("no world"); return end
    for i, depth in ipairs(DEPTHS) do
        local loc = { X = AT.X + i * 300, Y = AT.Y + 200, Z = AT.Z - 150 }
        out("spawn %d at z %d …", i, loc.Z)
        local okP, pawn = pcall(function() return world:SpawnActor(pawnCls, loc, { Pitch = 0, Yaw = 0, Roll = 0 }) end)
        if not (okP and pawn ~= nil and addr(pawn)) then out("  pawn: not spawned (%s)", tostring(pawn)); goto continue end
        out("  pawn: spawned")
        if ctrlCls and USE_CONTROLLER then
            local okC, ctrl = pcall(function() return world:SpawnActor(ctrlCls, loc, { Pitch = 0, Yaw = 0, Roll = 0 }) end)
            if okC and ctrl ~= nil and addr(ctrl) then
                local okPo = pcall(function() ctrl:Possess(pawn) end)
                out("  controller: spawned, possess %s", okPo and "ok" or "failed")
            else
                out("  controller: not spawned")
            end
        end
        pcall(function() pawn:SetReplicates(true) end)
        local function where(tag)
            local okL, v = pcall(function() return pawn:K2_GetActorLocation() end)
            out("  %s: (%s)", tag, okL and v and string.format("%.0f, %.0f, %.0f", v.X, v.Y, v.Z) or "?")
        end
        where("location right after spawn")
        if i == 1 then
            for _, k in ipairs({ "RelevanceDistance", "DespawnDelaySeconds", "MinimumWaterDepth", "SurfaceClearance", "FloorClearance", "WanderRadius" }) do
                local okV, v = pcall(function() return pawn[k] end)
                out("  %s = %s", k, okV and tostring(v) or "?")
            end
        end
        local okR, root = pcall(function() return pawn:K2_GetRootComponent() end)
        out("  root component: %s", okR and root ~= nil and H.isValid(root) and "yes" or "none")
        local okS = pcall(function() pawn:K2_SetActorLocation(loc, false, {}, true) end)
        out("  K2_SetActorLocation: %s", okS and "called" or "failed")
        where("location after set")
        ::continue::
    end
    out("spawned; checking in 5 s and 30 s")
    local function look(label)
        for _, cname in ipairs({ "BP_Catfish_C" }) do
            local okA, list = pcall(function() return FindAllOf(cname) or {} end)
            local n, first = 0, ""
            for _, o in ipairs(okA and list or {}) do
                local okN, cls = pcall(function() return o:GetClass():GetFName():ToString() end)
                if okN and tostring(cls) == "BP_Catfish_C" then
                    n = n + 1
                    do
                        local okL, v = pcall(function() return o:K2_GetActorLocation() end)
                        if okL and v then first = first .. string.format(" (%.0f, %.0f, %.0f)", v.X, v.Y, v.Z) end
                    end
                end
            end
            out("  %s: FindAllOf(%s) -> %d catfish%s (%s)", label, cname, n, first, okA and "ok" or "failed")
        end
    end
    for k = 1, 12 do
        H.defer(k * 5000, function() look((k * 5) .. " s"); if k == 12 then out("done") end end)
    end
end

-- Only where the marker file exists (made on the test server only).
local marker = io.open("Mods/FishSpawnTest/TEST_SERVER", "r")
if not marker then
    H.log(MOD .. ": not the test server (no Mods/FishSpawnTest/TEST_SERVER) — nothing to do")
    return
end
marker:close()

local already = io.open(FLAG, "r")
if already then
    already:close()
    H.log(MOD .. ": already ran — nothing to do")
else
    local started = false
    H.every(5000, MOD .. " wait", function()
        if started then return end
        local at = nil
        H.forEachPlayer(function(ctrl)
            local pawn = H.livePawnFromCtrl(ctrl)
            local okL, v = pcall(function() return pawn:K2_GetActorLocation() end)
            if at == nil and okL and v then at = { X = v.X, Y = v.Y, Z = v.Z } end
        end)
        if at == nil then return end
        started = true
        out("player at (%.0f, %.0f, %.0f)", at.X, at.Y, at.Z)
        H.try(MOD .. ": spawn", function() spawn(at) end)
    end)
    H.log(MOD .. ": loaded — spawns 3 catfish around the first player online (TEST SERVER)")
end
