--[[
    IsleProbe — one-shot diagnostics for a new server / UE4SS build.

    Every other mod here rests on names nobody has documented: property names
    (Health, Growth…), the class-path format DinoGarage compares on !redeem,
    mutation FNames, hook parameter order, and which UE4SS functions exist.
    This mod checks them against the live game once and writes the answers to
    UE4SS.log, ending with a PROBE SUMMARY block to paste back.

    STRICTLY READ-ONLY:
      * never calls a setter — for Set* functions it only checks they exist
      * writes one file only: Mods/IsleProbe/census-started, just before the
        world census, so a census that crashes the server does not run again
        on every restart (deploy removes the file: one census per deploy)
      * logs SteamIDs masked to the last 4 digits, player names as a length

    Threads: hooks log on the game thread (they already run there); the pawn
    probe is scheduled onto the game thread from a slow LoopAsync, which stops
    itself once done. See docs/first-run.md for how to run it and what to send.

    Turn it off in ue4ss/mods.txt (IsleProbe : 0) once the summary is clean.
]]

-- Resolve require("shared.isle.*") to Mods/shared/isle/ whatever UE4SS itself
-- puts on package.path. Relative to the server's working directory
-- (Binaries/Win64), like every path the mods use.
if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H = require("shared.isle.helpers")

local MOD = "IsleProbe"
local PREFIX = "[isle-probe]"

local POLL_MS          = 5000
local MAX_SPECIES      = 3      -- probe this many different species, then stop
local MAX_HOOK_SAMPLES = 3      -- log the first few fires of each hook
local GIVE_UP_AFTER_S  = 12 * 60 * 60   -- a quiet server may see its first spawn hours after a restart

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
    local f = io.open("Mods/" .. MOD .. "/Scripts/main.lua", "r")
    if f then f:close() end
    note("relative paths", f ~= nil,
        f and "Mods/... resolves from the working directory"
          or "Mods/... does NOT resolve — every mod's files would go missing")
    out("relative path Mods/%s/Scripts/main.lua readable: %s", MOD, tostring(f ~= nil))
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
    -- helpers.lua reads (self = receiver, NewText, ChatPlayerController = sender).
    -- The text must come back as words: tostring() on an FText returns
    -- "FText: <address>", which is what this check used to accept.
    sampleHook("/Script/TheIsle.TIPlayerController:GetChatMessage", "GetChatMessage", function(_, textP, senderP)
        local okC, ctrl = pcall(function() return senderP:get() end)
        local hasSteam = okC and pcall(function() return ctrl:GetSteamId():ToString() end)
        local okM, msg = pcall(function() return H.textOf(textP:get()) end)
        local isWords = okM and type(msg) == "string" and not msg:find("^FText: ")
        note("GetChatMessage params", hasSteam and isWords,
            string.format("sender (param 2) has GetSteamId: %s, text (param 1) readable as words: %s",
                tostring(hasSteam), tostring(isWords)))
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

--- Every NutrientsStruct field with its value (real names, from reflection),
--- and what the prime getters answer. Read-only.
local function probeNutrientsAndPrime(pawn)
    local ok, struct = pcall(function() return pawn.NutrientsStruct end)
    if ok and struct ~= nil then
        local names = H.structFields(struct)
        local parts = {}
        for _, name in ipairs(names) do
            local got, v = pcall(function() return struct[name] end)
            parts[#parts + 1] = name .. "=" .. (got and show(v) or "?")
        end
        out("  NutrientsStruct (%d fields): %s", #names, table.concat(parts, ", "))
        note("nutrient fields", #names > 0, #names > 0 and (#names .. " fields readable by name")
            or "reflection gave no field names")
    else
        out("  NutrientsStruct: unreadable")
        note("nutrient fields", false, "NutrientsStruct unreadable")
    end
    for _, fn in ipairs({ "IsPrimeElder", "GetIsEligiblePrimeElder", "GetMaxHunger", "GetMaxHealth" }) do
        local got, v = pcall(function() return pawn[fn](pawn) end)
        out("  %s() -> %s", fn, got and show(v) or ("error: " .. tostring(v)))
    end
end

--- Every reflected property whose name looks like quests / prime / elder, on
--- the object's class AND its parents, with its value (structs field by
--- field). Read-only. Used to find where Evrima keeps prime-quest progress:
--- the native binary has no quest names, so they live in Blueprints.
local DISCOVER = { "Quest", "Prime", "Elder", "Mission", "Objective", "Task", "Lineage" }
local function describe(v)
    local t = type(v)
    if v == nil or t == "number" or t == "boolean" or t == "string" then return show(v) end
    local okN, n = pcall(function() return v:GetArrayNum() end)
    if okN and type(n) == "number" then
        local items = {}
        pcall(function() v:ForEach(function(_, e)
            if #items < 12 then
                local ev = e:get()
                local fields = H.structFields(ev)
                if #fields > 0 then
                    local parts = {}
                    for _, f in ipairs(fields) do
                        local okF, fv = pcall(function() return ev[f] end)
                        parts[#parts + 1] = f .. "=" .. (okF and show(fv) or "?")
                    end
                    items[#items + 1] = "{" .. table.concat(parts, ", ") .. "}"
                else
                    items[#items + 1] = show(ev)
                end
            end
        end) end)
        return string.format("array[%d] %s", n, table.concat(items, " "))
    end
    local fields = H.structFields(v)
    if #fields > 0 then
        local parts = {}
        for _, f in ipairs(fields) do
            local okF, fv = pcall(function() return v[f] end)
            parts[#parts + 1] = f .. "=" .. (okF and show(fv) or "?")
        end
        return "{" .. table.concat(parts, ", ") .. "}"
    end
    return show(v)
end

local function discoverOn(obj, label)
    if not H.isValid(obj) then out("  %s: not available", label); return end
    local found = 0
    local ok = pcall(function()
        local cls = obj:GetClass()
        local depth = 0
        while cls ~= nil and depth < 12 and pcall(function() return cls:IsValid() end) and cls:IsValid() do
            cls:ForEachProperty(function(prop)
                local name = prop:GetFName():ToString()
                for _, word in ipairs(DISCOVER) do
                    if name:find(word, 1, true) then
                        found = found + 1
                        local okV, v = pcall(function() return obj[name] end)
                        out("  %s.%s : %s = %s", label, name, prop:GetClass():GetFName():ToString(),
                            okV and describe(v) or "<unreadable>")
                        break
                    end
                end
            end)
            local okS, super = pcall(function() return cls:GetSuperStruct() end)
            cls = okS and super or nil
            depth = depth + 1
        end
    end)
    out("  %s: %d quest/prime/elder properties%s", label, found, ok and "" or " (walk stopped early)")
    note("quest/prime " .. label, ok and found > 0, found .. " matching properties")
end

local function discoverPrimeAndQuests(ctrl, pawn)
    out("  --- prime / quest discovery ---")
    for _, fn in ipairs({ "IsElder", "IsPrimeElder", "GetIsEligiblePrimeElder", "GetElderReplicationStacks" }) do
        local got, v = pcall(function() return pawn[fn](pawn) end)
        out("  %s() -> %s", fn, got and show(v) or ("error: " .. tostring(v)))
    end
    local got, data = pcall(function() return pawn:GetEligiblePrimeElderData() end)
    out("  GetEligiblePrimeElderData() -> %s", got and describe(data) or ("error: " .. tostring(data)))
    discoverOn(pawn, "pawn")
    discoverOn(ctrl, "controller")
    local okPS, ps = pcall(function() return ctrl.PlayerState end)
    discoverOn(okPS and ps or nil, "playerState")
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
    probeNutrientsAndPrime(pawn)
    discoverPrimeAndQuests(ctrl, pawn)
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

--------------------------------------------------------------------------
-- Game config dump (game thread only, once)
--
-- Every property the session and game-state classes declare, with its type
-- and live value, so the admin panel only offers Game.ini keys this build
-- really has — and in the class (= Game.ini section) that owns them. Read-only.
-- Secrets are masked; arrays are printed as a count (they hold SteamIDs).
--------------------------------------------------------------------------

local CONFIG_CLASSES = { "TIGameSession", "TIGameStateBase" }
local configDumped = false

-- Arrays whose elements are printed (names of species, AI, mutations). The
-- SteamID arrays (AdminsSteamIDs, WhitelistIDs, VIPs, VIPQueue) stay a count.
local LIST_ELEMENTS = { AllowedClasses = true, DisallowedAIClasses = true, EnabledMutations = true }
local MAX_ELEMENTS = 80

local function configValue(inst, name)
    if name:lower():find("password", 1, true) then return "<masked>" end
    local ok, v = pcall(function() return inst[name] end)
    if not ok then return "<unreadable>" end
    local t = type(v)
    if v == nil or t == "number" or t == "boolean" then return tostring(v) end
    local okN, n = pcall(function() return v:GetArrayNum() end)
    if okN and type(n) == "number" then
        if not LIST_ELEMENTS[name] or n == 0 then return "array[" .. n .. "]" end
        local items = {}
        pcall(function()
            v:ForEach(function(_, elem)
                if #items < MAX_ELEMENTS then items[#items + 1] = show(elem:get()) end
            end)
        end)
        return string.format("array[%d] %s", n, table.concat(items, ", "))
    end
    return show(v)
end

local function dumpConfig()
    local okF, session = pcall(FindFirstOf, "TIGameSession")
    if not okF then configDumped = true; out("config dump: FindFirstOf failed"); return end
    if not H.isValid(session) then return end        -- world not up yet: next poll
    configDumped = true
    for _, short in ipairs(CONFIG_CLASSES) do
        local cls = StaticFindObject("/Script/TheIsle." .. short)
        local inst = short == "TIGameSession" and session or FindFirstOf(short)
        if not H.isValid(cls) then
            out("config %s: class not found", short)
        else
            local n = 0
            local ok, err = pcall(function()
                cls:ForEachProperty(function(prop)
                    local name = prop:GetFName():ToString()
                    local ptype = prop:GetClass():GetFName():ToString()
                    n = n + 1
                    out("config %s.%s : %s = %s", short, name, ptype,
                        H.isValid(inst) and configValue(inst, name) or "-")
                end)
            end)
            out("config %s: %d properties%s", short, n, ok and "" or (" (stopped: " .. tostring(err) .. ")"))
            note("config " .. short, ok and n > 0, string.format("%d properties dumped", n))
        end
    end
end

-- --- world census ------------------------------------------------------------
-- What the live map could draw from the server itself instead of a static
-- community map: which actor classes exist (AI, zones, water, food…), where,
-- and what their Blueprints expose. Read-only, twice per run:
--   * CENSUS_BOOT_AFTER_S after load: every actor, by class (one long read,
--     done while the server is most likely empty);
--   * CENSUS_PLAYERS_AFTER_S after the first player pawn: pawns only, since
--     Evrima spawns AI around players.

local CENSUS_BOOT_AFTER_S    = 120
local CENSUS_PLAYERS_AFTER_S = 180
local CENSUS_TOP             = 150   -- most common classes listed in full
local CENSUS_DUMP_CLASSES    = 30    -- interesting classes whose properties are dumped
local CENSUS_DUMP_PROPS      = 30    -- properties per dumped class
local INTEREST = { "Zone", "Migrat", "Patrol", "Sanct", "Water", "Lake", "River", "Salt", "Lick",
    "Food", "Fruit", "Plant", "Bush", "Mushroom", "Carcass", "Corpse", "Fish", "Nest", "Egg",
    "Spawn", "AI", "Herd", "Mud", "Wallow", "Critter", "Animal", "Boar", "Deer", "Crab", "Frog",
    "Turtle", "Chicken", "Rabbit", "Goat", "Weather", "Region" }
local censusBootDone, censusPlayersDone, firstPawnAt = false, false, nil

local function classOf(obj)
    local ok, name = pcall(function() return obj:GetClass():GetFName():ToString() end)
    return ok and type(name) == "string" and name or nil
end

local function whereText(actor)
    local ok, s = pcall(function()
        local l = actor:K2_GetActorLocation()
        return string.format("(%d, %d, %d)", math.floor(l.X + 0.5), math.floor(l.Y + 0.5), math.floor(l.Z + 0.5))
    end)
    return ok and s or "?"
end

local function interesting(name)
    for _, word in ipairs(INTEREST) do
        if name:find(word, 1, true) then return true end
    end
    return false
end

--- The Blueprint-level properties of one actor with their values, stopping at
--- the engine's own base classes (their properties are the same everywhere).
--- ONLY scalar properties are read. Reading any property of an arbitrary actor
--- crashed the server in UE4SS.dll (2026-09-24, right after
--- TIGoreBase.bIsSolid) — a native crash pcall cannot catch. Other kinds are
--- listed by name and type, never read.
local ENGINE_BASES = { Actor = true, Pawn = true, Character = true, Object = true, Info = true, Volume = true }
local SCALAR = { BoolProperty = true, IntProperty = true, Int64Property = true, FloatProperty = true,
    DoubleProperty = true, ByteProperty = true, EnumProperty = true, NameProperty = true, StrProperty = true }
local function dumpProps(obj, label)
    local n = 0
    pcall(function()
        local cls = obj:GetClass()
        local depth = 0
        while cls ~= nil and depth < 8 and n < CENSUS_DUMP_PROPS do
            local cname = cls:GetFName():ToString()
            if ENGINE_BASES[cname] then break end
            cls:ForEachProperty(function(prop)
                if n >= CENSUS_DUMP_PROPS then return end
                n = n + 1
                local pname = prop:GetFName():ToString()
                local ptype = prop:GetClass():GetFName():ToString()
                if SCALAR[ptype] then
                    local okV, v = pcall(function() return obj[pname] end)
                    out("    %s.%s : %s = %s", cname, pname, ptype, okV and show(v) or "<unreadable>")
                else
                    out("    %s.%s : %s (not read)", cname, pname, ptype)
                end
            end)
            local okS, super = pcall(function() return cls:GetSuperStruct() end)
            cls = okS and super or nil
            depth = depth + 1
        end
    end)
    out("    (%s: %d properties shown)", label, n)
end

--- Group objects by a key, most common first.
local function tally(list, keyOf)
    local count, first, order = {}, {}, {}
    for _, obj in ipairs(list) do
        local key = keyOf(obj)
        if key ~= nil then
            if count[key] == nil then count[key] = 0; first[key] = obj; order[#order + 1] = key end
            count[key] = count[key] + 1
        end
    end
    table.sort(order, function(a, b) return count[a] > count[b] or (count[a] == count[b] and a < b) end)
    return count, first, order
end

local function actorCensus()
    local ok, actors = pcall(FindAllOf, "Actor")
    if not ok or type(actors) ~= "table" then
        out("world census: FindAllOf(Actor) failed: %s", tostring(actors))
        note("world census", false, "FindAllOf(Actor) failed")
        return
    end
    local count, first, order = tally(actors, classOf)
    out("================ WORLD CENSUS: %d actors, %d classes ================", #actors, #order)
    for i, name in ipairs(order) do
        if i <= CENSUS_TOP or interesting(name) then
            out("  %6d  %s  e.g. at %s", count[name], name, whereText(first[name]))
        end
    end
    local dumped = 0
    for _, name in ipairs(order) do
        if dumped >= CENSUS_DUMP_CLASSES then break end
        if interesting(name) and H.isValid(first[name]) then
            dumped = dumped + 1
            out("  --- %s (x%d) ---", name, count[name])
            dumpProps(first[name], name)
        end
    end
    out("================ END WORLD CENSUS ================")
    note("world census", true, string.format("%d actors, %d classes", #actors, #order))
end

--- Pawns grouped by class and by who controls them: player-controlled vs AI.
local function pawnCensus(label)
    local ok, pawns = pcall(FindAllOf, "Pawn")
    if not ok or type(pawns) ~= "table" then
        out("pawn census: FindAllOf(Pawn) failed: %s", tostring(pawns))
        note("pawn census " .. label, false, "FindAllOf(Pawn) failed")
        return
    end
    local count, first, order = tally(pawns, function(p)
        local okC, ctrl = pcall(function() return p.Controller end)
        local by = okC and H.isValid(ctrl) and classOf(ctrl) or "no controller"
        return (classOf(p) or "?") .. "  <- " .. by
    end)
    out("================ PAWN CENSUS (%s): %d pawns ================", label, #pawns)
    for _, key in ipairs(order) do
        out("  %5d  %s  e.g. at %s", count[key], key, whereText(first[key]))
    end
    -- What an AI pawn answers to: the live map needs "alive?" and a name.
    local shown = 0
    for _, key in ipairs(order) do
        if shown >= 6 then break end
        local p = first[key]
        if not key:find("PlayerController", 1, true) and H.isValid(p) then
            shown = shown + 1
            local parts = {}
            for _, fn in ipairs({ "GetHealth", "GetMaxHealth", "IsDead", "GetIsDead", "IsAlive", "GetGrowth" }) do
                local okF, v = pcall(function() return p[fn](p) end)
                parts[#parts + 1] = fn .. "=" .. (okF and show(v) or "n/a")
            end
            out("  AI sample %s: %s", key, table.concat(parts, " "))
        end
    end
    out("================ END PAWN CENSUS ================")
    note("pawn census " .. label, true, string.format("%d pawns, %d kinds", #pawns, #order))
end

-- A census that crashes the server must not run again on every restart.
local CENSUS_MARK = "Mods/IsleProbe/census-started"
local function censusAlreadyStarted()
    local f = io.open(CENSUS_MARK, "r")
    if f then f:close(); return true end
    return false
end
local function markCensusStarted()
    local f = io.open(CENSUS_MARK, "w")
    if not f then return false end
    f:write(os.date("!%Y-%m-%dT%H:%M:%SZ"), "\n")
    f:close()
    return true
end

local function censusOnGameThread()
    local now = os.time()
    if firstPawnAt == nil then
        H.forEachPlayer(function(ctrl)
            if firstPawnAt == nil and H.livePawnFromCtrl(ctrl) then firstPawnAt = now end
        end)
    end
    if not censusBootDone and now - startedAt >= CENSUS_BOOT_AFTER_S then
        censusBootDone = true
        if censusAlreadyStarted() then
            out("world census skipped: %s exists (it ran, or crashed, since the last deploy)", CENSUS_MARK)
            censusPlayersDone = true
            return
        end
        if not markCensusStarted() then
            out("world census skipped: cannot write %s", CENSUS_MARK)
            censusPlayersDone = true
            return
        end
        H.try(MOD .. ": world census", actorCensus)
        H.try(MOD .. ": pawn census", pawnCensus, "boot")
        printSummary()
    end
    if not censusPlayersDone and firstPawnAt ~= nil and now - firstPawnAt >= CENSUS_PLAYERS_AFTER_S then
        censusPlayersDone = true
        H.try(MOD .. ": pawn census", pawnCensus, "players online")
        printSummary()
    end
end

local function probeOnGameThread()
    busy = false
    if not configDumped then H.try(MOD .. ": config dump", dumpConfig) end
    if not finished then
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
    censusOnGameThread()
end

LoopAsync(POLL_MS, function()
    if finished and censusBootDone and censusPlayersDone then return true end   -- stop the loop
    if os.time() - startedAt > GIVE_UP_AFTER_S then
        finished, censusBootDone, censusPlayersDone = true, true, true
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
