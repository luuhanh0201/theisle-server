-- LightLab — TEST SERVER ONLY (off in ue4ss/mods.txt; turned on in the test
-- copy by hand). Can a dino glow at night? Writes what it finds to
-- Mods/LightLab/Saved/lightlab.txt:
--   1. census (read only): every actor in the world counted by class, and the
--      classes that look like fireflies / insects / glow / lights / Niagara —
--      is a firefly something the SERVER has (and could replicate), or only
--      the players' machines?
--   2. spawn a Deinosuchus and an engine PointLight (deferred spawn, as
--      AIZones), mark the light replicated, attach it to the dino, set its
--      colour / intensity / radius, read them back
-- Each step is flagged (Saved/<step>.trying): a crash in one is named at the
-- next start and that step is not run again.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local MOD  = "LightLab"
local DIR  = "Mods/LightLab/Saved/"
local OUT  = DIR .. "lightlab.txt"
local DINO = "/Game/TheIsle/Core/Characters/Dinosaurs/Deinosuchus/BP_Deinosuchus.BP_Deinosuchus_C"
local LIGHT = "/Script/Engine.PointLight"
local STATICS = "/Script/Engine.Default__GameplayStatics"
local AT = { X = 350856, Y = -354551, Z = 39315 }
local START_AFTER_S = 90
local LOOK = { "firefl", "fire_fl", "insect", "bug", "glow", "lumin", "light", "niagara", "vfx", "fx_", "particle", "emitter", "ambient" }

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

local STEPS = { "census", "spawn", "light" }
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

local dinoAddr, lightAddr = nil, nil
local function byAddr(cls, addr)
    if addr == nil then return nil end
    local ok, all = pcall(function() return FindAllOf(cls) or {} end)
    for _, o in ipairs(ok and all or {}) do if addressOf(o) == addr then return o end end
    return nil
end

local phase, loadedAt, nextAt = 1, os.time(), 0
H.every(2000, MOD .. ": step", function()
    local now = os.time()
    if now < loadedAt + START_AFTER_S or now < nextAt or phase > 4 then return end
    local okG, world = pcall(function()
        local gs = FindFirstOf("TIGameStateBase")
        return isValid(gs) and gs:GetWorld() or nil
    end)
    if not (okG and isValid(world)) then return end

    if phase == 1 then
        step("census", function()
            local ok, all = pcall(function() return FindAllOf("Actor") or {} end)
            local counts, total = {}, 0
            for _, a in ipairs(ok and all or {}) do
                local c = className(a)
                counts[c] = (counts[c] or 0) + 1
                total = total + 1
            end
            local list, hits = {}, {}
            for c, n in pairs(counts) do
                list[#list + 1] = { c, n }
                local low = c:lower()
                for _, k in ipairs(LOOK) do if low:find(k, 1, true) then hits[#hits + 1] = c .. " x" .. n; break end end
            end
            table.sort(list, function(a, b) return a[2] > b[2] end)
            local top = {}
            for i = 1, math.min(40, #list) do top[#top + 1] = list[i][1] .. " x" .. list[i][2] end
            table.sort(hits)
            out("census: %d actors, %d classes", total, #list)
            out("census: top classes: %s", table.concat(top, ", "))
            out("census: looks like firefly / insect / glow / light / fx: %s", #hits > 0 and table.concat(hits, ", ") or "none")
            for _, cls in ipairs({ "NiagaraComponent", "NiagaraActor", "PointLightComponent", "SpotLightComponent", "ParticleSystemComponent" }) do
                local okC, xs = pcall(function() return FindAllOf(cls) or {} end)
                local owners = {}
                for i, x in ipairs(okC and xs or {}) do
                    if i > 12 then break end
                    local okO, o = pcall(function() return x:GetOwner() end)
                    owners[#owners + 1] = (okO and isValid(o)) and className(o) or "-"
                end
                out("census: %s x%d, owners: %s", cls, okC and #xs or -1, table.concat(owners, ", "))
            end
        end)
        phase, nextAt = 2, now + 2
    elseif phase == 2 then
        step("spawn", function()
            local statics = find(STATICS)
            local function spawn(path, loc)
                local cls = find(path)
                if cls == nil and type(LoadAsset) == "function" then pcall(function() LoadAsset(path) end); cls = find(path) end
                if cls == nil then out("spawn: class not found %s", path); return nil end
                local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = loc, Scale3D = { X = 1, Y = 1, Z = 1 } }
                local a = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
                if a == nil or addressOf(a) == nil then out("spawn: nothing made for %s", path); return nil end
                if path == LIGHT then
                    -- Replicated from its very spawn (a dynamic actor is sent to clients only if bReplicates at spawn).
                    local okB = pcall(function() a.bReplicates = true end)
                    local okS = pcall(function() a:SetReplicates(true) end)
                    out("spawn: light bReplicates=true before finishing %s, SetReplicates %s", okB and "ok" or "FAILED", okS and "ok" or "FAILED")
                end
                statics:FinishSpawningActor(a, xf, 1)
                return a
            end
            local dino = spawn(DINO, AT)
            local light = spawn(LIGHT, { X = AT.X, Y = AT.Y, Z = AT.Z + 200 })
            dinoAddr, lightAddr = addressOf(dino), addressOf(light)
            out("spawn: dino %s, light %s (%s)", tostring(dinoAddr ~= nil), tostring(lightAddr ~= nil), light and className(light) or "-")
        end)
        phase, nextAt = 3, now + 4
    elseif phase == 3 then
        step("light", function()
            local dino, light = byAddr("BP_Deinosuchus_C", dinoAddr), byAddr("PointLight", lightAddr)
            if not (dino and light) then out("light: dino or light gone"); return end
            local function try(what, fn) local ok, err = pcall(fn); out("light: %s %s", what, ok and "ok" or ("FAILED " .. tostring(err))) end
            try("SetReplicates(true)", function() light:SetReplicates(true) end)
            try("K2_AttachToActor(dino, SnapToTarget)", function() light:K2_AttachToActor(dino, FName("None"), 2, 2, 1, false) end)
            local comp = nil
            try("PointLightComponent", function() comp = light.PointLightComponent; assert(isValid(comp)) end)
            if comp then
                try("SetIntensity(8000)", function() comp:SetIntensity(8000) end)
                try("SetLightColor(cyan)", function() comp:SetLightColor({ R = 0.2, G = 1, B = 0.9, A = 1 }, true) end)
                try("SetAttenuationRadius(900)", function() comp:SetAttenuationRadius(900) end)
                try("SetCastShadows(false)", function() comp:SetCastShadows(false) end)
                local function num(n) local ok, v = pcall(function() return comp[n] end); return ok and type(v) == "number" and v or nil end
                out("light: read back Intensity=%s AttenuationRadius=%s", tostring(num("Intensity")), tostring(num("AttenuationRadius")))
                local okB, brep = pcall(function() return light.bReplicates end)
                out("light: bReplicates field = %s", tostring(okB and brep))
                local okR, rep = pcall(function() return light:GetIsReplicated() end)
                local okCR, crep = pcall(function() return comp:GetIsReplicated() end)
                out("light: actor replicated=%s, component replicated=%s", tostring(okR and rep), tostring(okCR and crep))
            end
            local okP, parent = pcall(function() return light:GetAttachParentActor() end)
            out("light: attached to %s", (okP and isValid(parent)) and className(parent) or "nothing")
        end)
        phase, nextAt = 4, now + 10
    elseif phase == 4 then
        local dino, light = byAddr("BP_Deinosuchus_C", dinoAddr), byAddr("PointLight", lightAddr)
        out("after 10 s: dino %s, light %s", tostring(dino ~= nil), tostring(light ~= nil))
        out("DONE")
        phase = 5
    end
end)

out("loaded — the test starts %d s after load", START_AFTER_S)
