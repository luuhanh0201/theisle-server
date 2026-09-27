-- MutLab — TEST SERVER ONLY (off in ue4ss/mods.txt; turned on by hand in the
-- test copy). Why a quest mutation ("Reniculate Kidneys": drink saltwater)
-- came out of the garage neither shown nor working (2026-09-27), though the
-- slot was written back: the game also keeps the quest-unlocked mutations in
-- MutationsRequirementsData.UnlockRequiredMutations (TArray<FName>), which the
-- garage never stored. On a Deinosuchus spawned for the test (no player
-- needed), writes Mods/MutLab/Saved/mutlab.txt:
--   1. read   — every field of MutationsRequirementsData and of
--               ReplicatedMutationsData, and the pawn's functions whose name
--               has "Mutation" in it (a setter to push the struct?)
--   2. unlock — append "Reniculate Kidneys" to UnlockRequiredMutations (a
--               TArray write from Lua), push it with the setter if one exists,
--               read it back
--   3. slot   — "Reniculate Kidneys" into MutationSlot3 +
--               SetReplicatedMutationsData(struct, true), read back both
-- Each step is flagged (Saved/<step>.trying): a crash in one is named at the
-- next start and that step is not run again.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H = require("shared.isle.helpers")

local MOD  = "MutLab"
local DIR  = "Mods/MutLab/Saved/"
local OUT  = DIR .. "mutlab.txt"
local DINO = "/Game/TheIsle/Core/Characters/Dinosaurs/Deinosuchus/BP_Deinosuchus.BP_Deinosuchus_C"
local STATICS = "/Script/Engine.Default__GameplayStatics"
local AT = { X = 350856, Y = -354551, Z = 39315 }
local START_AFTER_S = 90
local QUEST_MUTATION = "Reniculate Kidneys"

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

local STEPS = { "read", "unlock", "slot", "setter" }
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

--- A value as text: numbers, booleans, FNames, arrays of FNames / numbers.
local function show(v)
    local t = type(v)
    if v == nil then return "nil" end
    if t == "number" or t == "boolean" or t == "string" then return tostring(v) end
    local okN, n = pcall(function() return v:GetArrayNum() end)
    if okN and type(n) == "number" then
        local items = {}
        pcall(function() v:ForEach(function(_, e)
            local ev = e:get()
            local okS, s = pcall(function() return ev:ToString() end)
            items[#items + 1] = okS and tostring(s) or tostring(ev)
        end) end)
        return string.format("array[%d] [%s]", n, table.concat(items, ", "))
    end
    local okS, s = pcall(function() return v:ToString() end)
    if okS and s ~= nil then return tostring(s) end
    return tostring(v)
end

--- Every field of a struct value, "name = value".
local function dump(label, struct)
    local fields = H.structFields(struct)
    out("%s: %d fields", label, #fields)
    for _, f in ipairs(fields) do
        local ok, v = pcall(function() return struct[f] end)
        out("  %s.%s = %s", label, f, ok and show(v) or "<unreadable>")
    end
end

--- Names of the pawn's functions (its class and parents) that contain `word`.
local function functionsWith(obj, word)
    local names = {}
    pcall(function()
        local cls = obj:GetClass()
        local depth = 0
        while cls ~= nil and depth < 12 and pcall(function() return cls:IsValid() end) and cls:IsValid() do
            pcall(function() cls:ForEachFunction(function(fn)
                local n = fn:GetFName():ToString()
                if n:find(word, 1, true) then names[#names + 1] = n end
            end) end)
            local okS, super = pcall(function() return cls:GetSuperStruct() end)
            cls = okS and super or nil
            depth = depth + 1
        end
    end)
    return names
end

--- "Name(Type param, …)" of one of the pawn's functions, from its reflected parameters (metadata only).
local function signature(obj, name)
    local sig = nil
    pcall(function()
        local cls = obj:GetClass()
        local depth = 0
        while sig == nil and cls ~= nil and depth < 12 and cls:IsValid() do
            pcall(function() cls:ForEachFunction(function(fn)
                if sig == nil and fn:GetFName():ToString() == name then
                    local params = {}
                    fn:ForEachProperty(function(prop)
                        params[#params + 1] = prop:GetClass():GetFName():ToString() .. " " .. prop:GetFName():ToString()
                    end)
                    sig = name .. "(" .. table.concat(params, ", ") .. ")"
                end
            end) end)
            local okS, super = pcall(function() return cls:GetSuperStruct() end)
            cls = okS and super or nil
            depth = depth + 1
        end
    end)
    return sig or (name .. ": not found")
end

local dinoAddr = nil
local function theDino()
    if dinoAddr == nil then return nil end
    local ok, all = pcall(function() return FindAllOf("BP_Deinosuchus_C") or {} end)
    for _, p in ipairs(ok and all or {}) do if addressOf(p) == dinoAddr and isValid(p) then return p end end
    return nil
end

local setterName = nil
local phase, loadedAt, nextAt = 0, os.time(), 0
H.every(2000, MOD .. ": step", function()
    local now = os.time()
    if now < loadedAt + START_AFTER_S or now < nextAt or phase > 5 then return end
    local okG, world = pcall(function()
        local gs = FindFirstOf("TIGameStateBase")
        return isValid(gs) and gs:GetWorld() or nil
    end)
    if not (okG and isValid(world)) then return end

    if phase == 0 then
        local statics, cls = find(STATICS), find(DINO)
        if cls == nil and type(LoadAsset) == "function" then pcall(function() LoadAsset(DINO) end); cls = find(DINO) end
        if not (statics and cls) then out("dino: class not found"); phase = 6; return end
        pcall(function()
            local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = AT, Scale3D = { X = 1, Y = 1, Z = 1 } }
            local a = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
            if a ~= nil and addressOf(a) ~= nil then statics:FinishSpawningActor(a, xf, 1); dinoAddr = addressOf(a) end
        end)
        out("dino: %s", dinoAddr and "a Deinosuchus spawned" or "nothing made")
        if dinoAddr == nil then phase = 6; return end
        phase, nextAt = 1, now + 4
        return
    end
    local pawn = theDino()
    if pawn == nil then out("dino: gone"); phase = 6; return end

    if phase == 1 then
        step("read", function()
            local okR, req = pcall(function() return pawn.MutationsRequirementsData end)
            if okR and req ~= nil then dump("MutationsRequirementsData", req) else out("MutationsRequirementsData: unreadable") end
            local okM, mut = pcall(function() return pawn.ReplicatedMutationsData end)
            if okM and mut ~= nil then dump("ReplicatedMutationsData", mut) else out("ReplicatedMutationsData: unreadable") end
            local fns = functionsWith(pawn, "Mutation")
            out("functions with 'Mutation': %s", #fns > 0 and table.concat(fns, ", ") or "none")
            for _, n in ipairs(fns) do
                if n:find("^Set") and n:find("Requirement") then setterName = n end
            end
            out("setter for the requirements: %s", setterName or "none found")
            for _, n in ipairs({ "SetMutationRequirementsData", "SetReplicatedMutationsData", "ClientUpdateMutations",
                "SetSlot3EquippedMutation", "RequestAvailableLifecycleMutationsList", "IsLifecycleMutationEquipped" }) do
                out("signature: %s", signature(pawn, n))
            end
        end)
        phase, nextAt = 2, now + 2
    elseif phase == 2 then
        step("unlock", function()
            local req = pawn.MutationsRequirementsData
            local arr = req.UnlockRequiredMutations
            local n = arr:GetArrayNum()
            out("unlock: before %s", show(arr))
            local okW, err = pcall(function() arr[n + 1] = FName(QUEST_MUTATION) end)
            out("unlock: append by index %d: %s", n + 1, okW and "ok" or ("error " .. tostring(err)))
            out("unlock: after the write, same struct: %s", show(req.UnlockRequiredMutations))

            out("unlock: read fresh from the pawn: %s", show(pawn.MutationsRequirementsData.UnlockRequiredMutations))
        end)
        phase, nextAt = 3, now + 2
    elseif phase == 3 then
        step("slot", function()
            local mut = pawn.ReplicatedMutationsData
            mut.MutationSlot3 = FName(QUEST_MUTATION)
            local okS, errS = pcall(function() pawn:SetReplicatedMutationsData(mut, true) end)
            out("slot: SetReplicatedMutationsData: %s", okS and "ok" or ("error " .. tostring(errS)))
            out("slot: MutationSlot3 read fresh = %s", show(pawn.ReplicatedMutationsData.MutationSlot3))
            out("slot: UnlockRequiredMutations read fresh = %s", show(pawn.MutationsRequirementsData.UnlockRequiredMutations))
        end)
        phase, nextAt = 4, now + 2
    elseif phase == 4 then
        step("setter", function()
            local req = pawn.MutationsRequirementsData
            local okS, errS = pcall(function() pawn:SetMutationRequirementsData(req) end)
            out("setter: SetMutationRequirementsData(struct): %s", okS and "ok" or ("error " .. tostring(errS)))
            out("setter: UnlockRequiredMutations read fresh = %s", show(pawn.MutationsRequirementsData.UnlockRequiredMutations))
            local okC, errC = pcall(function() pawn:ClientUpdateMutations() end)
            out("setter: ClientUpdateMutations(): %s", okC and "ok" or ("error " .. tostring(errC)))
        end)
        phase, nextAt = 5, now + 2
    elseif phase == 5 then
        out("DONE")
        phase = 6
    end
end)

out("loaded — the probe starts %d s after load", START_AFTER_S)
