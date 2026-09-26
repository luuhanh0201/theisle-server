-- FishFind — where are the fish classes? (for fish zones, like the AI zones)
--
-- Enumerating classes and GetFullName() crashed this server (2026-09-26 15:47,
-- docs/lua-safety-rules.md), so this only asks the engine for GUESSED paths
-- with StaticFindObject — what AIZones does for every AI it spawns, and which
-- answers nil for a wrong path. The 6 short names are the game's own
-- (TIAIWorldSpawner.AIAmbientFishClasses, FishProbe). For a class found, its
-- parents' names (GetSuperStruct + the name, as FishProbe already did).
--
-- Only while nobody is online. Once: a flag is written first (Mods/AIZones/Saved/fishfind.flag), so a
-- crash is not repeated on the next start. Output: fishfind.txt there.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H = require("shared.isle.helpers")

local MOD = "FishFind"
local DIR = "Mods/AIZones/Saved/"
local FLAG = DIR .. "fishfind.flag"
local OUT = DIR .. "fishfind.txt"
local AFTER_MS = 90000

local FISH = { "Catfish", "Coalecanth", "Forktail", "Hoplo", "Longear", "Muskel" }
local ROOTS = {
    "/Game/TheIsle/Core/Characters/Animals/%s",
    "/Game/TheIsle/Core/Characters/Animals/Fish/%s",
    "/Game/TheIsle/Core/Characters/Animals/Fish",
    "/Game/TheIsle/Core/Characters/Animals/Fishes/%s",
    "/Game/TheIsle/Core/Characters/Animals/AmbientFish/%s",
    "/Game/TheIsle/Core/Characters/Animals/AmbientFish",
    "/Game/TheIsle/Core/Characters/Animals/Fish/Ambient",
    "/Game/TheIsle/Core/Characters/Fish/%s",
    "/Game/TheIsle/Core/Characters/Fish",
    "/Game/TheIsle/Core/Characters/AmbientFish",
    "/Game/TheIsle/Core/AI/Fish/%s",
    "/Game/TheIsle/Core/AI/Fish",
    "/Game/TheIsle/Core/AI/AmbientFish",
    "/Game/TheIsle/Core/Fish/%s",
    "/Game/TheIsle/Core/Fish",
}
local NATIVE = {
    "TIAIFishController", "TIAIAmbientFishController", "TIAmbientFishController", "TIFishAIController",
    "TIAICatfishController", "TIFish", "TIAmbientFish", "TIFishCharacter", "TIAIFish", "TIAmbientFishBase",
    "TIFishBase", "TIAIFishCharacter", "TIAquaticCharacter", "TIAIAquaticController", "TIAISeaturtleController",
}
local BP_CTRL = "/Game/TheIsle/Core/AI/Controllers/Animals/%s.%s_C"
local BP_CTRL_NAMES = { "BP_AI_Fish_Controller", "BP_AI_AmbientFish_Controller", "BP_AI_Catfish_Controller", "BP_Fish_Controller" }

local lines = {}
local function out(fmt, ...) lines[#lines + 1] = string.format(fmt, ...) end
local function nameOf(o)
    local ok, n = pcall(function() return o:GetFName():ToString() end)
    return ok and tostring(n) or "?"
end
local function find(path)
    local ok, o = pcall(function() return StaticFindObject(path) end)
    if ok and o ~= nil and H.isValid(o) then return o end
    return nil
end
local function chain(cls)
    local names, c, d = {}, cls, 0
    while c ~= nil and d < 8 do
        names[#names + 1] = nameOf(c)
        local okS, s = pcall(function() return c:GetSuperStruct() end)
        c = okS and s or nil
        d = d + 1
    end
    return table.concat(names, " < ")
end
local function flush()
    local f = io.open(OUT, "w")
    if f then f:write(table.concat(lines, "\n"), "\n"); f:close() end
end

local function probe()
    local f = io.open(FLAG, "w")
    if f then f:write(tostring(os.time())); f:close() end
    out("FishFind ran at %s", os.date("!%Y-%m-%d %H:%M:%S UTC"))
    for _, fish in ipairs(FISH) do
        local hit = nil
        for _, root in ipairs(ROOTS) do
            local dir = root:find("%s", 1, true) and root:format(fish) or root
            local path = string.format("%s/BP_%s.BP_%s_C", dir, fish, fish)
            local cls = find(path)
            if cls then hit = path; out("FOUND %s  (%s)", path, chain(cls)); break end
        end
        if not hit then out("not found: %s", fish) end
        flush()
    end
    for _, n in ipairs(NATIVE) do
        local path = "/Script/TheIsle." .. n
        if find(path) then out("FOUND native %s", path) end
    end
    for _, n in ipairs(BP_CTRL_NAMES) do
        local path = BP_CTRL:format(n, n)
        if find(path) then out("FOUND controller %s", path) end
    end
    out("done")
    flush()
    H.log(MOD .. ": done -> " .. OUT)
end

-- Step 2 CRASHED the server (2026-09-26 16:25) before writing a line: its
-- first call was GetSuperStruct() on the native fish classes found by
-- StaticFindObject — the 15:47 crash also walked parents of fish classes.
-- Never walk a fish class's parents. Its flag (fishfind2.flag) stays.
--
-- Step 3: only each spawner entry's GetFullName() (what StatsLogger calls on
-- every player's class) — no parents. Flag: fishfind3.flag.
local FLAG3 = DIR .. "fishfind3.flag"
local OUT3 = DIR .. "fishfind3.txt"
local function probe3()
    local f = io.open(FLAG3, "w")
    if f then f:write(tostring(os.time())); f:close() end
    local rows = { "FishFind step 3 at " .. os.date("!%Y-%m-%d %H:%M:%S UTC") }
    local function save()
        local o = io.open(OUT3, "w")
        if o then o:write(table.concat(rows, "\n"), "\n"); o:close() end
    end
    save()
    local okA, all = pcall(function() return FindAllOf("TIAIWorldSpawner") or {} end)
    local ws = okA and all[1] or nil
    if ws ~= nil and H.isValid(ws) then
        pcall(function()
            ws.AIAmbientFishClasses:ForEach(function(_, e)
                local okC, c = pcall(function() return e:get() end)
                if okC and c ~= nil then
                    local okN, full = pcall(function() return c:GetFullName() end)
                    rows[#rows + 1] = "fish: " .. (okN and tostring(full) or "?")
                    save()
                end
            end)
        end)
    else
        rows[#rows + 1] = "no TIAIWorldSpawner"
    end
    rows[#rows + 1] = "done"
    save()
    H.log(MOD .. ": step 3 done -> " .. OUT3)
end
local again = io.open(FLAG3, "r")
if again then again:close() else
    local done3, since3 = false, os.time()
    H.every(30000, MOD .. " wait 3", function()
        if done3 or os.time() - since3 < AFTER_MS / 1000 then return end
        local online = 0
        H.forEachPlayer(function() online = online + 1 end)
        if online > 0 then return end
        done3 = true
        H.try(MOD .. ": step 3", probe3)
    end)
end

local already = io.open(FLAG, "r")
if already then
    already:close()
    H.log(MOD .. ": already ran (" .. FLAG .. ") — nothing to do")
else
    -- Only while nobody plays: a crash here must not throw anyone out.
    local done, since = false, os.time()
    H.every(30000, MOD .. " wait", function()
        if done or os.time() - since < AFTER_MS / 1000 then return end
        local online = 0
        H.forEachPlayer(function() online = online + 1 end)
        if online > 0 then return end
        done = true
        H.try(MOD .. ": probe", probe)
    end)
    H.log(MOD .. ": loaded — looks for the fish classes once nobody is online")
end
