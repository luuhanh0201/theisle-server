--[[
    IsleProbe — one-shot diagnostics for a new server / UE4SS build.

    Every other mod here rests on names nobody has documented: property names
    (Health, Growth…), the class-path format DinoGarage compares on !redeem,
    mutation FNames, hook parameter order, and which UE4SS functions exist.
    This mod checks them against the live game once and writes the answers to
    ue4ss/UE4SS.log, ending with a PROBE SUMMARY block to paste back.

    STRICTLY READ-ONLY:
      * never calls a setter — for Set* functions it only checks they exist
      * never writes a file (not even under Saved/)
      * logs SteamIDs masked to the last 4 digits, player names as a length

    Threads: hooks log on the game thread (they already run there); the pawn
    probe is scheduled onto the game thread from a slow LoopAsync, which stops
    itself once done. See docs/first-run.md for how to run it and what to send.

    Turn it off in ue4ss/mods.txt (IsleProbe : 0) once the summary is clean.
]]

local H = require("shared.isle.helpers")

local MOD = "IsleProbe"
local PREFIX = "[isle-probe]"

local POLL_MS          = 5000
local MAX_SPECIES      = 3      -- probe this many different species, then stop
local MAX_HOOK_SAMPLES = 3      -- log the first few fires of each hook
local GIVE_UP_AFTER_S  = 60 * 60

-- What the other mods read, in the same candidate order they use.
local CANDIDATES = {
    health  = { "Health", "CurrentHealth" },
    stamina = { "Stamina", "CurrentStamina" },
    hunger  = { "Hunger", "CurrentHunger" },
    thirst  = { "Thirst", "CurrentThirst" },
    oxygen  = { "Oxygen", "CurrentOxygen" },
    blood   = { "Blood", "CurrentBlood" },
    growth  = { "Growth", "GrowthPercent" },
    food         = { "Food", "FoodValue" },
    waterLevel   = { "WaterLevel" },
    lockedDamage = { "LockedDamage" },
    rottenValue  = { "RottenValue" },
    maxHunger    = { "MaxHunger" },
    maxFoodValue = { "MaxFoodValue" },
    maxThirst    = { "MaxThirst" },
    maxStamina   = { "MaxStamina" },
    isFemale     = { "bIsFemale", "IsFemale" },
}
-- Stable output order.
local CANDIDATE_ORDER = {
    "health", "stamina", "hunger", "thirst", "oxygen", "blood", "growth", "food",
    "waterLevel", "lockedDamage", "rottenValue", "maxHunger", "maxFoodValue",
    "maxThirst", "maxStamina", "isFemale",
}

-- Functions DinoGarage calls on a pawn. Checked for existence only.
local PAWN_FUNCTIONS = {
    "SetGrowth", "SetHealth", "SetStamina", "SetHunger", "SetThirst", "SetOxygen",
    "SetBlood", "SetFood", "SetWaterLevel", "SetMaxHunger", "SetMaxFoodValue",
    "SetMaxThirst", "SetMaxStamina", "ServerSetPrimeEligible",
    "SetReplicatedMutationsData", "SetNutrientsStruct", "SetElderReplicationStacks",
    "GetElderReplicationStacks", "K2_GetActorLocation", "K2_GetActorRotation",
}

local MUTATION_FIELDS = {
    "MutationSlot1", "MutationSlot2", "MutationSlot3", "MutationSlot4",
    "ParentMutationSlot1", "ParentMutationSlot2", "ParentMutationSlot3", "ParentMutationSlot4",
    "ElderMutationSlot1A", "ElderMutationSlot1B", "ElderMutationSlot2A", "ElderMutationSlot2B",
    "ElderMutationSlot3A", "ElderMutationSlot3B", "ElderMutationSlot4A", "ElderMutationSlot4B",
}

local NUTRIENT_FIELDS = {
    "CarbValue", "ProteinValue", "LipidValue", "BonesValue", "CannibalValue",
    "MagyValue", "RottenFleshValue", "MushroomsValue", "bMalnutrition",
}

--------------------------------------------------------------------------
-- Output
--------------------------------------------------------------------------

local function out(fmt, ...)
    print(string.format("%s " .. fmt .. "\n", PREFIX, ...))
end

local function mask(steamId)
    steamId = tostring(steamId or "")
    if #steamId <= 4 then return "…" .. steamId end
    return "…" .. steamId:sub(-4)
end

--- tostring that never raises and never prints a whole UObject dump.
local function show(v)
    local t = type(v)
    if v == nil then return "nil" end
    if t == "number" or t == "boolean" then return tostring(v) end
    if t == "string" then return string.format("%q", v) end
    local ok, s = pcall(function() return v:ToString() end)
    if ok and s ~= nil then return string.format("%q", tostring(s)) end
    local okName, name = pcall(function() return v:GetFullName() end)
    if okName and name ~= nil then return "<" .. tostring(name) .. ">" end
    return "<" .. t .. ">"
end

-- summary[key] = { ok = true | false | nil, detail = string }
-- ok = nil means "not observed yet" (a hook that has not fired).
local summary = {}
local function note(key, ok, detail)
    -- A later success upgrades an earlier miss (a second species may have it).
    local prev = summary[key]
    if prev ~= nil and prev.ok == true and ok ~= true then return end
    summary[key] = { ok = ok, detail = detail }
end

--------------------------------------------------------------------------
-- Environment (safe at load: no engine objects)
--------------------------------------------------------------------------

local function probeEnvironment()
    out("=== environment ===")
    out("lua: %s", tostring(_VERSION))
    local fns = {
        "ExecuteInGameThread", "ExecuteWithDelay", "LoopAsync", "LoopInGameThreadWithDelay",
        "RegisterHook", "NotifyOnNewObject", "FindAllOf", "FindFirstOf", "FName", "StaticFindObject",
    }
    for _, name in ipairs(fns) do
        out("global %-26s %s", name, type(_G[name]))
    end
    note("ExecuteInGameThread", type(ExecuteInGameThread) == "function",
        "needed by every deferred action, the StatsLogger read and the admin kill")

    local ok, version = pcall(function()
        if type(UE4SS) == "table" and type(UE4SS.GetVersion) == "function" then
            local a, b, c = UE4SS.GetVersion()
            return string.format("%s.%s.%s", tostring(a), tostring(b), tostring(c))
        end
        return nil
    end)
    out("ue4ss version: %s", ok and tostring(version) or "unknown")

    -- The mods open files by paths relative to the process working directory
    -- (Binaries/Win64). Reading our own script proves that resolves; nothing
    -- is written.
    local f = io.open("ue4ss/Mods/" .. MOD .. "/Scripts/main.lua", "r")
    if f then f:close() end
    note("relative paths", f ~= nil,
        f and "ue4ss/Mods/... resolves from the working directory"
          or "ue4ss/Mods/... does NOT resolve — every mod's files would go missing")
    out("relative path ue4ss/Mods/%s/Scripts/main.lua readable: %s", MOD, tostring(f ~= nil))
end

--------------------------------------------------------------------------
-- Hooks: parameter shapes on the first few fires
--------------------------------------------------------------------------

--- Log each hook parameter's type and class. With `redact`, text values are
--- shown as their length only (chat messages stay out of the log).
local function describeParams(label, redact, ...)
    local n = select("#", ...)
    out("%s fired with %d params", label, n)
    for i = 1, n do
        local p = select(i, ...)
        local ok, v = pcall(function() return p:get() end)
        if not ok then
            out("  param %d: :get() failed (%s)", i, tostring(v))
        else
            local cls = nil
            pcall(function() cls = v:GetClass():GetFName():ToString() end)
            local shown = show(v)
            if redact and cls == nil and type(v) ~= "number" and type(v) ~= "boolean" then
                shown = "<text, " .. #tostring(shown) .. " chars — redacted>"
            end
            out("  param %d: %s%s", i, shown, cls and ("  class=" .. tostring(cls)) or "")
        end
    end
end

local function sampleHook(path, label, onSample, redact)
    local fired = 0
    local ok, err = pcall(function()
        RegisterHook(path, function(...)
            if fired >= MAX_HOOK_SAMPLES then return end
            fired = fired + 1
            pcall(describeParams, label .. " #" .. fired, redact == true, ...)
            if onSample then pcall(onSample, ...) end
        end)
    end)
    out("hook %s: %s", path, ok and "registered" or ("FAILED: " .. tostring(err)))
    note("hook " .. label, ok, ok and "registered (fires are logged above when they happen)"
        or ("could not register: " .. tostring(err)))
end

local function probeHooks()
    out("=== hooks ===")
    note("ApplyDamage param order", nil, "not observed yet — have one player bite another once")
    note("GetChatMessage params", nil, "not observed yet — type anything in chat once")
    -- StatsLogger reads (self = attacker pawn, param 2 = target pawn, param 3 = amount).
    sampleHook("/Script/TheIsle.TICharacterBase:ApplyDamage", "ApplyDamage", function(selfP, targetP, amountP)
        local okT, target = pcall(function() return targetP:get() end)
        local okA, amount = pcall(function() return amountP:get() end)
        local targetIsPawn = okT and pcall(function() return target:GetClass() end)
        note("ApplyDamage param order", targetIsPawn and okA and type(amount) == "number",
            string.format("param2 is a pawn: %s, param3 is a number: %s (%s)",
                tostring(targetIsPawn), tostring(okA and type(amount) == "number"), show(amount)))
    end)
    -- helpers.lua reads (param 1 = controller, param 2 = message).
    sampleHook("/Script/TheIsle.TIPlayerController:GetChatMessage", "GetChatMessage", function(ctrlP, msgP)
        local okC, ctrl = pcall(function() return ctrlP:get() end)
        local hasSteam = okC and pcall(function() return ctrl:GetSteamId():ToString() end)
        local okM, msg = pcall(function() return tostring(msgP:get()) end)
        note("GetChatMessage params", hasSteam and okM,
            string.format("param1 has GetSteamId: %s, param2 as text: %s",
                tostring(hasSteam), okM and "ok" or "failed"))
    end, true)   -- never log what players wrote
end

--------------------------------------------------------------------------
-- Pawn probe (game thread only)
--------------------------------------------------------------------------

local probedSpecies = {}
local probedCount = 0

local function probeMutations(pawn)
    local ok, struct = pcall(function() return pawn.ReplicatedMutationsData end)
    if not ok or struct == nil then
        out("  ReplicatedMutationsData: unreadable")
        note("mutations", false, "ReplicatedMutationsData unreadable")
        return
    end
    local readable, filled = 0, 0
    for _, field in ipairs(MUTATION_FIELDS) do
        local okF, v = pcall(function() return struct[field]:ToString() end)
        out("  mutation %-22s %s", field, okF and string.format("%q", tostring(v)) or "unreadable")
        if okF then readable = readable + 1 end
        if okF and v ~= nil and v ~= "" and v ~= "None" then filled = filled + 1 end
    end
    -- All 16 must read: capture and restore use every one of them.
    note("mutations", readable == #MUTATION_FIELDS,
        string.format("%d/%d slot fields readable, %d filled on this dino",
            readable, #MUTATION_FIELDS, filled))

    -- Quest-unlocked mutation names (TArray<FName>), when present.
    local okR, names = pcall(function()
        local list = {}
        pawn.MutationsRequirementsData.UnlockRequiredMutations:ForEach(function(_, elem)
            list[#list + 1] = tostring(elem:get():ToString())
        end)
        return list
    end)
    out("  UnlockRequiredMutations: %s", okR and ("[" .. table.concat(names, ", ") .. "]") or "unreadable")
end

local function probeNutrients(pawn)
    local ok, struct = pcall(function() return pawn.NutrientsStruct end)
    if not ok or struct == nil then
        out("  NutrientsStruct: unreadable")
        note("nutrients", false, "NutrientsStruct unreadable")
        return
    end
    local readable = 0
    for _, field in ipairs(NUTRIENT_FIELDS) do
        local okF, v = pcall(function() return struct[field] end)
        out("  nutrient %-18s %s", field, okF and show(v) or "unreadable")
        if okF and v ~= nil then readable = readable + 1 end
    end
    note("nutrients", readable > 0, string.format("%d/%d fields readable", readable, #NUTRIENT_FIELDS))
end

local function probePawn(ctrl, pawn)
    local species = "unknown"
    pcall(function() species = tostring(pawn:GetClass():GetFName():ToString()) end)
    if probedSpecies[species] then return end
    probedSpecies[species] = true
    probedCount = probedCount + 1

    local steamOk, steam = pcall(function() return ctrl:GetSteamId():ToString() end)
    out("=== pawn %d: %s (player %s) ===", probedCount, species, steamOk and mask(steam) or "?")
    note("SteamID via ctrl:GetSteamId()", steamOk and steam ~= nil and steam ~= "",
        steamOk and "ok" or "failed — StatsLogger/garage fall back to PlayerState")

    local okName, name = pcall(function() return ctrl.PlayerState:GetPlayerName():ToString() end)
    out("player name via PlayerState:GetPlayerName(): %s",
        okName and name and ("ok (" .. #tostring(name) .. " chars)") or "failed")
    note("player name", okName and name ~= nil and name ~= "",
        okName and "PlayerState:GetPlayerName() works" or "names will show as SteamIDs")

    -- Object validity: the mods use IsValid(); AGENTS.md also names
    -- GetAddress() ~= 0. Report both so the rule can be settled.
    local okValid, valid = pcall(function() return pawn:IsValid() end)
    local okAddr, addr = pcall(function() return pawn:GetAddress() end)
    out("pawn:IsValid(): %s · pawn:GetAddress(): %s",
        okValid and tostring(valid) or "FAILED", okAddr and tostring(addr) or "FAILED")
    note("pawn:IsValid()", okValid and valid == true, okValid and "works (the mods rely on it)" or "FAILED")
    note("pawn:GetAddress()", okAddr and tonumber(addr) ~= nil and tonumber(addr) ~= 0,
        okAddr and ("returns " .. tostring(addr)) or "not available")

    -- Class identity: the exact string !redeem compares.
    local okCP, classPath = pcall(function() return pawn:GetClass():GetFullName() end)
    local okFN, fname = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    out("class GetFullName(): %s", okCP and string.format("%q", tostring(classPath)) or "FAILED")
    out("class GetFName():    %s", okFN and string.format("%q", tostring(fname)) or "FAILED")
    note("classPath (GetClass():GetFullName())", okCP and classPath ~= nil,
        okCP and string.format("%q", tostring(classPath)) or "unreadable — species list and !redeem break")

    for _, key in ipairs(CANDIDATE_ORDER) do
        local found = nil
        for _, prop in ipairs(CANDIDATES[key]) do
            local ok, v = pcall(function() return pawn[prop] end)
            out("  prop %-14s %-16s %s", key, prop, ok and show(v) or "error")
            if found == nil and ok and v ~= nil then found = prop .. " = " .. show(v) end
        end
        note("field " .. key, found ~= nil, found or ("none of: " .. table.concat(CANDIDATES[key], ", ")))
    end

    for _, fn in ipairs(PAWN_FUNCTIONS) do
        local ok, v = pcall(function() return pawn[fn] end)
        local present = ok and v ~= nil
        out("  function %-28s %s", fn, present and "present" or "MISSING")
        note("function " .. fn, present, present and "present" or "missing")
    end

    -- Read-only getters are safe to call.
    local okL, loc = pcall(function()
        local v = pawn:K2_GetActorLocation()
        return string.format("%.0f, %.0f, %.0f", v.X, v.Y, v.Z)
    end)
    out("  K2_GetActorLocation(): %s", okL and loc or "FAILED")
    note("position (K2_GetActorLocation)", okL, okL and "ok" or "live map will be empty")

    probeMutations(pawn)
    probeNutrients(pawn)
end

local function printSummary()
    out("================ PROBE SUMMARY ================")
    local keys = {}
    for k in pairs(summary) do keys[#keys + 1] = k end
    table.sort(keys)
    local bad, waiting = 0, 0
    for _, k in ipairs(keys) do
        local s = summary[k]
        local tag = s.ok == true and "OK  " or s.ok == false and "FAIL" or "WAIT"
        if s.ok == false then bad = bad + 1 elseif s.ok == nil then waiting = waiting + 1 end
        out("%s %-38s %s", tag, k, s.detail)
    end
    out("species probed: %d · problems: %d · not observed yet: %d", probedCount, bad, waiting)
    out("================ END SUMMARY ==================")
end

--------------------------------------------------------------------------
-- Run
--------------------------------------------------------------------------

probeEnvironment()
probeHooks()

local startedAt = os.time()
local busy = false
local finished = false

local function probeOnGameThread()
    busy = false
    local before = probedCount
    H.forEachPlayer(function(ctrl)
        if probedCount >= MAX_SPECIES then return end
        local pawn = H.livePawnFromCtrl(ctrl)
        if pawn then probePawn(ctrl, pawn) end
    end)
    -- Reprint the cumulative summary after every new species, so one admin
    -- spawning once is enough to get an answer.
    if probedCount > before then printSummary() end
    if probedCount >= MAX_SPECIES then finished = true end
end

LoopAsync(POLL_MS, function()
    if finished then return true end                     -- stop the loop
    if os.time() - startedAt > GIVE_UP_AFTER_S then
        finished = true
        out("giving up after %d min with %d species probed", GIVE_UP_AFTER_S // 60, probedCount)
        printSummary()
        return true
    end
    if not busy then
        busy = H.onGameThread(MOD .. ": probe", probeOnGameThread)
        if not busy and type(ExecuteInGameThread) ~= "function" then
            -- Without a game thread we must not read pawns at all.
            finished = true
            out("ExecuteInGameThread missing — pawn probe skipped (it would read off-thread)")
            printSummary()
            return true
        end
    end
    return false
end)

out("%s loaded — join and spawn a dino; a PROBE SUMMARY prints after each new species "
    .. "(up to %d). Nothing is changed in the game.", MOD, MAX_SPECIES)
