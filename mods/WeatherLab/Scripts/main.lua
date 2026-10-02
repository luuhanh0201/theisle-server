-- WeatherLab — TEST SERVER ONLY (off in ue4ss/mods.txt; turned on by hand in the
-- test copy). READ ONLY: writes nothing on the game.
--
-- The owner wants rain and storms gone, other weather kept (2026-10-02). Game.ini
-- only has bRandomWeatherEnabled (all or nothing). Where does the game keep the
-- weather, and which value says "rain"? This finds out:
--   1. 90 s after load: every actor class whose name looks like weather / sky,
--      with its scalar properties and their values (scalars only: reading any
--      other kind on an unknown actor crashed the server, lua-safety-rules §2);
--      and TIGameStateBase's scalar properties named like weather.
--   2. then every 30 s for 60 minutes: the same values again, a line only for
--      what changed — the weather changes every Min/MaxWeatherVariationInterval
--      (set short in the test copy's Game.ini), so a change shows which value moves.
-- Writes Mods/WeatherLab/Saved/weatherlab.txt.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H = require("shared.isle.helpers")

local MOD = "WeatherLab"
local OUT = "Mods/WeatherLab/Saved/weatherlab.txt"
local START_AFTER_S = 90
local EVERY_S = 30
local WATCH_S = 3600
local MAX_PROPS = 120      -- per class
local WORDS = { "Weather", "Rain", "Storm", "Sky", "Cloud", "Precip", "Fog", "Wind", "Thunder", "Lightning", "Wet", "Season" }
local ENGINE_BASES = { Actor = true, Pawn = true, Character = true, Object = true, Info = true, Volume = true }
local SCALAR = { BoolProperty = true, IntProperty = true, Int64Property = true, FloatProperty = true,
    DoubleProperty = true, ByteProperty = true, EnumProperty = true, NameProperty = true, StrProperty = true }

local rows = {}
local function out(fmt, ...)
    local line = string.format(fmt, ...)
    rows[#rows + 1] = os.date("!%H:%M:%S ") .. line
    if #rows > 6000 then table.remove(rows, 1) end
    local f = io.open(OUT, "w")
    if f then f:write(table.concat(rows, "\n"), "\n"); f:close() end
end

local function weathery(name)
    for _, w in ipairs(WORDS) do if name:find(w, 1, true) then return true end end
    return false
end
local function show(v)
    local t = type(v)
    if t == "number" or t == "boolean" or t == "string" then return tostring(v) end
    local ok, s = pcall(function() return v:ToString() end)
    return ok and tostring(s) or ("<" .. t .. ">")
end
local function classOf(obj)
    local ok, name = pcall(function() return obj:GetClass():GetFName():ToString() end)
    return ok and type(name) == "string" and name or nil
end

--- { "Class.prop" = value } of an object's scalar properties (filter: names to keep, or nil = all).
local function scalars(obj, filter, listing)
    local vals, n = {}, 0
    pcall(function()
        local cls = obj:GetClass()
        local depth = 0
        while cls ~= nil and depth < 8 and n < MAX_PROPS do
            local cname = cls:GetFName():ToString()
            if ENGINE_BASES[cname] then break end
            cls:ForEachProperty(function(prop)
                if n >= MAX_PROPS then return end
                local pname = prop:GetFName():ToString()
                local ptype = prop:GetClass():GetFName():ToString()
                if filter and not filter(pname) then return end
                n = n + 1
                if SCALAR[ptype] then
                    local okV, v = pcall(function() return obj[pname] end)
                    vals[cname .. "." .. pname] = okV and show(v) or "<unreadable>"
                elseif listing then
                    listing[#listing + 1] = string.format("%s.%s : %s (not read)", cname, pname, ptype)
                end
            end)
            local okS, super = pcall(function() return cls:GetSuperStruct() end)
            cls = okS and super or nil
            depth = depth + 1
        end
    end)
    return vals
end

-- What is watched: { label, find = fn() -> object or nil, filter }
local watched = {}
local last = {}
local loadedAt, phase, startedAt, nextAt = os.time(), 0, nil, 0

local function census()
    local ok, actors = pcall(FindAllOf, "Actor")
    if not ok or type(actors) ~= "table" then out("FindAllOf(Actor) failed: %s", tostring(actors)); return end
    local seen = {}
    for _, a in ipairs(actors) do
        local name = classOf(a)
        if name and not seen[name] and weathery(name) then
            seen[name] = true
            out("=== actor class %s ===", name)
            local listing = {}
            local vals = scalars(a, nil, listing)
            local keys = {}
            for k in pairs(vals) do keys[#keys + 1] = k end
            table.sort(keys)
            for _, k in ipairs(keys) do out("  %s = %s", k, vals[k]) end
            for _, l in ipairs(listing) do out("  %s", l) end
            local cls = name
            watched[#watched + 1] = { label = cls, find = function() return FindFirstOf(cls) end }
        end
    end
    out("census: %d actors, %d weather-like classes", #actors, #watched)
    local gsFilter = function(p) return weathery(p) end
    watched[#watched + 1] = { label = "TIGameStateBase", find = function() return FindFirstOf("TIGameStateBase") end, filter = gsFilter }
    local gs = FindFirstOf("TIGameStateBase")
    if gs and H.isValid(gs) then
        out("=== TIGameStateBase (weather-named properties) ===")
        local listing = {}
        local vals = scalars(gs, gsFilter, listing)
        for k, v in pairs(vals) do out("  %s = %s", k, v) end
        for _, l in ipairs(listing) do out("  %s", l) end
    end
end

local function watch(t)
    local changed = 0
    for _, w in ipairs(watched) do
        local ok, obj = pcall(w.find)
        if ok and obj ~= nil and H.isValid(obj) then
            local vals = scalars(obj, w.filter, nil)
            for k, v in pairs(vals) do
                local key = w.label .. "|" .. k
                if last[key] ~= nil and last[key] ~= v then
                    out("t=%ds CHANGED %s: %s -> %s", t, k, last[key], v)
                    changed = changed + 1
                end
                last[key] = v
            end
        end
    end
    if changed == 0 then out("t=%ds no change", t) end
end

H.every(2000, MOD .. ": step", function()
    local now = os.time()
    if phase >= 99 or now < loadedAt + START_AFTER_S or now < nextAt then return end
    if phase == 0 then
        census()
        watch(0)
        phase, startedAt, nextAt = 1, now, now + EVERY_S
        return
    end
    local t = now - startedAt
    watch(t)
    if t >= WATCH_S then out("DONE"); phase = 99; return end
    nextAt = now + EVERY_S
end)

out("loaded — census %d s after load, then a watch every %d s for %d s", START_AFTER_S, EVERY_S, WATCH_S)
