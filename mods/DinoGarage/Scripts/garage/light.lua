--[[
    DinoGarage/light.lua, ADMIN TEST (panel API /api/light-test → inbox "light")

    Can a light the server spawns make a dino glow at night on the players'
    machines? A PointLight (the engine's), marked replicated before its spawn
    finishes, attached to the player's dino; "off" takes it away. Tried on a
    test server (LightLab, 2026-09-27): spawn, attach, colour and intensity all
    work there, no crash, whether players SEE it could only be told on the
    live server (nobody can join the test one).

    One light per player, found again by its address (never kept as an
    object). Off: dimmed, hidden, detached, then destroyed while it is still
    valid (checked in the same tick: a K2_DestroyActor on an actor the game
    already removed crashes).

    Flag first: Saved/light-test.trying before the first light of a run,
    removed after; found at load, lights stay off this run.
]]

local H = require("shared.isle.helpers")

local L = {}

L.FLAG = "Mods/DinoGarage/Saved/light-test.trying"
local LIGHT = "/Script/Engine.PointLight"
local STATICS = "/Script/Engine.Default__GameplayStatics"

local tried = nil   -- nil = not this run, true = worked, false = off
do
    local f = io.open(L.FLAG, "r")
    if f then
        f:close()
        tried = false
        H.logError("light: the last run stopped while making a test light, off. Delete " .. L.FLAG .. " to try again.")
    end
end

local lights = {}   -- steamId -> the light's address

local function addressOf(o) local ok, a = pcall(function() return o:GetAddress() end); return ok and a ~= 0 and a or nil end
local function find(path) local ok, o = pcall(function() return StaticFindObject(path) end); return ok and o ~= nil and H.isValid(o) and o or nil end

local function lightOf(id)
    local addr = lights[id]
    if addr == nil then return nil end
    local ok, all = pcall(function() return FindAllOf("PointLight") or {} end)
    for _, l in ipairs(ok and all or {}) do if addressOf(l) == addr and H.isValid(l) then return l end end
    lights[id] = nil
    return nil
end

--- A light on the dino of player `id` (pawn: theirs, live). Returns true, or false and why.
function L.on(id, pawn)
    if tried == false then return false, "off (a crash last time)" end
    if lightOf(id) ~= nil then return true end
    local okW, world = pcall(function() return pawn:GetWorld() end)
    local cls, statics = find(LIGHT), find(STATICS)
    if not (okW and world and cls and statics) then return false, "no world / class" end
    local first = tried == nil
    if first then local f = io.open(L.FLAG, "w"); if f then f:write(tostring(os.time())); f:close() end end
    local okL, loc = pcall(function() return pawn:K2_GetActorLocation() end)
    local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = okL and loc or { X = 0, Y = 0, Z = 0 }, Scale3D = { X = 1, Y = 1, Z = 1 } }
    local light = nil
    local ok, err = pcall(function()
        light = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
        if light == nil or addressOf(light) == nil then error("nothing made") end
        -- Replicated from its very spawn: a dynamic actor reaches clients only so.
        pcall(function() light.bReplicates = true end)
        pcall(function() light:SetReplicates(true) end)
        statics:FinishSpawningActor(light, xf, 1)
        light:K2_AttachToActor(pawn, FName("None"), 2, 2, 1, false)   -- snap to the dino
        local comp = light.PointLightComponent
        pcall(function() comp:SetIntensity(8000) end)
        pcall(function() comp:SetLightColor({ R = 0.2, G = 1, B = 0.9, A = 1 }, true) end)
        pcall(function() comp:SetAttenuationRadius(900) end)
        pcall(function() comp:SetCastShadows(false) end)
    end)
    if first then os.remove(L.FLAG); tried = true end
    if not ok then return false, tostring(err) end
    lights[id] = addressOf(light)
    H.log("light: on for " .. id)
    return true
end

--- Take the light off player `id`'s dino (if any).
function L.off(id)
    local light = lightOf(id)
    if light == nil then return true end
    pcall(function() light.PointLightComponent:SetIntensity(0) end)
    pcall(function() light:SetActorHiddenInGame(true) end)
    pcall(function() light:K2_DetachFromActor(1, 1, 1) end)
    if H.isValid(light) then pcall(function() light:K2_DestroyActor() end) end
    lights[id] = nil
    H.log("light: off for " .. id)
    return true
end

return L
