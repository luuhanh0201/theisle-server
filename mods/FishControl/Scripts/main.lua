-- FishControl — the island's fish, as the admin sets them (panel → Server →
-- Cấu hình → Cá).
--
-- The game spawns ambient fish around players in the water (TIAIWorldSpawner,
-- FishProbe 2026-09-26): 6 species (BP_Catfish_C, BP_Coalecanth_C,
-- BP_Forktail_C, BP_Hoplo_C, BP_Longear_C, BP_Muskel_C), at most
-- MaxAmbientFishPerPlayer (12) around a player, AmbientFishSoftLimitPerWater
-- (28) in one body of water, one try every AmbientFishSpawnCooldown (0.5 s).
--
--   * density: those three numbers are set on the spawner from settings.json
--     (written by the bridge); the game's own are remembered and put back when
--     the control is off. Numbers only — nothing else is written.
--   * tune: any other NUMBER of the spawner the admin sets (settings.tune,
--     { PropertyName = value }) — e.g. how much land AI it keeps around each
--     player. Only a property the class itself lists as Int/Float/Double is
--     written; the game's value is remembered and put back when the entry goes.
--   * species: not here — the bridge adds the species left out to the game's
--     own DisallowedAIClasses (Game.ini + RCON), the game's mechanism.
--   * a census, every CENSUS_MS while players are online: live fish counted by
--     species → Mods/FishControl/Saved/fish.json, so the panel shows what is
--     really in the water (and whether a species left out is gone).
--
-- Game thread for engine work (H.every); the file is written on the async one.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local MOD = "FishControl"
local DIR = "Mods/FishControl/Saved/"
local SETTINGS_PATH = DIR .. "settings.json"
local OUT = DIR .. "fish.json"
local APPLY_MS = 30000
local CENSUS_MS = 60000
local FISH = { BP_Catfish_C = true, BP_Coalecanth_C = true, BP_Forktail_C = true, BP_Hoplo_C = true,
               BP_Longear_C = true, BP_Muskel_C = true }
local FIELDS = {   -- setting -> the spawner's property, kind
    perPlayer = { "MaxAmbientFishPerPlayer", "int", 0, 60 },
    perWater = { "AmbientFishSoftLimitPerWater", "int", 0, 200 },
    cooldownSec = { "AmbientFishSpawnCooldown", "float", 0.1, 30 },
}

local function readSettings()
    local f = io.open(SETTINGS_PATH, "r")
    if not f then return { control = false } end
    local raw = f:read("*a")
    f:close()
    local ok, d = pcall(json.decode, raw or "")
    if not ok or type(d) ~= "table" then return nil end   -- torn: keep what is set
    return d
end

local function spawner()
    local ok, all = pcall(function() return FindAllOf("TIAIWorldSpawner") or {} end)
    local ws = ok and all[1] or nil
    if ws ~= nil and H.isValid(ws) then return ws end
    return nil
end

local function num(obj, name)
    local ok, v = pcall(function() return obj[name] end)
    if ok and type(v) == "number" then return v end
    return nil
end

local orig = nil         -- the game's own values, first seen
local applied = false

--- name -> "int" | "float": the spawner's numeric properties, from its class (metadata only, once).
local numeric = nil
local function numericOf(ws)
    if numeric then return numeric end
    numeric = {}
    local okC, cls = pcall(function() return ws:GetClass() end)
    local depth = 0
    cls = okC and cls or nil
    while cls ~= nil and depth < 8 do
        pcall(function()
            cls:ForEachProperty(function(p)
                local okN, n = pcall(function() return p:GetFName():ToString() end)
                local okT, t = pcall(function() return p:GetClass():GetFName():ToString() end)
                if okN and okT then
                    t = tostring(t)
                    if t == "IntProperty" then numeric[tostring(n)] = "int"
                    elseif t == "FloatProperty" or t == "DoubleProperty" then numeric[tostring(n)] = "float" end
                end
            end)
        end)
        local okS, sup = pcall(function() return cls:GetSuperStruct() end)
        cls = okS and sup or nil
        depth = depth + 1
    end
    return numeric
end

local OWN = {}
for _, f in pairs(FIELDS) do OWN[f[1]] = true end
local tuneOrig = {}      -- property -> the game's value before the admin's

local function applyTune(ws, tune)
    local kinds = numericOf(ws)
    local want = {}
    for name, v in pairs(type(tune) == "table" and tune or {}) do
        name = tostring(name)
        if kinds[name] and not OWN[name] and tonumber(v) then want[name] = tonumber(v) end
    end
    local changed = {}
    for name, o in pairs(tuneOrig) do
        if want[name] == nil then
            if pcall(function() ws[name] = o end) then changed[#changed + 1] = name .. "=" .. tostring(o) .. " (game's)" end
            tuneOrig[name] = nil
        end
    end
    for name, v in pairs(want) do
        local cur = num(ws, name)
        if cur ~= nil then
            if tuneOrig[name] == nil then tuneOrig[name] = cur end
            if kinds[name] == "int" then v = math.floor(v + 0.5) end
            if math.abs(cur - v) > 1e-6 and pcall(function() ws[name] = v end) then changed[#changed + 1] = name .. "=" .. tostring(v) end
        end
    end
    if #changed > 0 then H.log(MOD .. ": tune " .. table.concat(changed, ", ")) end
end

local function apply()
    local s = readSettings()
    if s == nil then return end
    local on = s.control == true
    local ws0 = (s.tune ~= nil or next(tuneOrig) ~= nil) and spawner() or nil
    if ws0 ~= nil then applyTune(ws0, s.tune) end
    if not on and not applied then return end
    local ws = ws0 or spawner()
    if ws == nil then return end
    if orig == nil then
        orig = {}
        for key, f in pairs(FIELDS) do orig[key] = num(ws, f[1]) end
    end
    local changed = {}
    for key, f in pairs(FIELDS) do
        local want = orig[key]
        if on and tonumber(s[key]) ~= nil then
            want = math.max(f[3], math.min(f[4], tonumber(s[key])))
            if f[2] == "int" then want = math.floor(want + 0.5) end
        end
        local cur = num(ws, f[1])
        if want ~= nil and cur ~= nil and math.abs(cur - want) > 1e-6 then
            if pcall(function() ws[f[1]] = want end) then changed[#changed + 1] = f[1] .. "=" .. tostring(want) end
        end
    end
    if #changed > 0 then
        H.log(MOD .. ": " .. (on and "set " or "put back (off) ") .. table.concat(changed, ", "))
    end
    applied = on
end

local census = nil
local function count()
    local online = 0
    H.forEachPlayer(function() online = online + 1 end)
    if online == 0 then return end
    -- Among the Pawns and by each fish class (a fish may not be a Pawn), once each.
    local by, total, seen = {}, 0, {}
    local function tally(list)
        for _, p in ipairs(list) do
            local okC, n = pcall(function() return p:GetClass():GetFName():ToString() end)
            n = okC and n and (tostring(n):match("([%w_]+)$") or tostring(n)) or nil
            local okA, addr = pcall(function() return p:GetAddress() end)
            if n and FISH[n] and okA and addr and addr ~= 0 and not seen[addr] then
                seen[addr] = true
                by[n] = (by[n] or 0) + 1
                total = total + 1
            end
        end
    end
    local ok, all = pcall(function() return FindAllOf("Pawn") or {} end)
    tally(ok and all or {})
    for cls in pairs(FISH) do
        local okF, found = pcall(function() return FindAllOf(cls) or {} end)
        tally(okF and found or {})
    end
    local ws = spawner()
    census = { t = os.time(), online = online, total = total, species = by,
        perPlayer = ws and num(ws, "MaxAmbientFishPerPlayer"), perWater = ws and num(ws, "AmbientFishSoftLimitPerWater"),
        cooldownSec = ws and num(ws, "AmbientFishSpawnCooldown") }
end

local function write()
    if census == nil then return end
    local data = census
    census = nil
    local ok, text = pcall(json.encode, data)
    if not ok then return end
    local tmp = OUT .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then return end
    f:write(text)
    f:close()
    os.remove(OUT)
    os.rename(tmp, OUT)
end

H.every(APPLY_MS, MOD .. " apply", apply)
H.every(CENSUS_MS, MOD .. " census", count)
LoopAsync(10000, function() write(); return false end)
H.log(MOD .. ": loaded — settings from " .. SETTINGS_PATH)
