-- FishTune — more ambient fish, by writing the world AI
-- spawner's fish numbers (MaxAmbientFishPerPlayer 12, AmbientFishSoftLimitPerWater
-- 28, AmbientFishSpawnAttemptsPerPlayer 1, AmbientFishSpawnCooldown 0.5 — the
-- game's). Game.ini [/Script/TheIsle.TIAIWorldSpawner] is NOT read (read back on
-- the test server, 2026-09-27). A Lua write on this spawner (GlobalAISpawnLimit,
-- FishControl) crash-looped the live server on 2026-09-26; these four fish
-- numbers were written on the test server with no crash (2026-09-27). Runs only
-- where an admin made Mods/FishTune/ENABLED (a second server on the same VPS
-- could not be joined — its listing pointed at the live port).
--
-- It writes nothing by itself. An admin drops Mods/FishTune/Saved/apply.json:
--   { "id": "a1", "perPlayer": 24, "perWater": 60, "attempts": 3, "cooldown": 0.25 }
-- (any field left out is not written); each new id is applied once, on the
-- game thread, then read back into Saved/applied.json and UE4SS.log.
-- Flag first: Saved/writing.flag is written before a write and removed a
-- minute later; found at load, no write is made again (a crash stays one crash).

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local MOD  = "FishTune"
local DIR  = "Mods/FishTune/Saved/"
local FLAG = DIR .. "writing.flag"

local marker = io.open("Mods/FishTune/ENABLED", "r")
if not marker then
    H.log(MOD .. ": off (no Mods/FishTune/ENABLED) — nothing to do")
    return
end
marker:close()

local blocked = false
do
    local f = io.open(FLAG, "r")
    if f then
        f:close()
        blocked = true
        H.logError(MOD .. ": the last run stopped during a write — no more writes. Delete " .. FLAG .. " to try again.")
    end
end

local FIELDS = {
    { key = "perPlayer", prop = "MaxAmbientFishPerPlayer", lo = 1, hi = 60 },
    { key = "perWater",  prop = "AmbientFishSoftLimitPerWater", lo = 1, hi = 300 },
    { key = "attempts",  prop = "AmbientFishSpawnAttemptsPerPlayer", lo = 1, hi = 10 },
    { key = "cooldown",  prop = "AmbientFishSpawnCooldown", lo = 0.05, hi = 10 },
}

local function readJson(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local raw = f:read("*a")
    f:close()
    local ok, d = pcall(json.decode, raw or "")
    return ok and type(d) == "table" and d or nil
end

local function writeFile(path, text)
    local f = io.open(path, "w")
    if f then f:write(text); f:close() end
end

local function spawner()
    local ok, all = pcall(function() return FindAllOf("TIAIWorldSpawner") or {} end)
    local ws = ok and all[1] or nil
    return (ws ~= nil and H.isValid(ws)) and ws or nil
end

local function readBack(ws)
    local out = {}
    for _, f in ipairs(FIELDS) do
        local ok, v = pcall(function() return ws[f.prop] end)
        out[f.key] = ok and type(v) == "number" and v or nil
    end
    return out
end

local lastId = nil
local clearFlagAt = nil

local function poll()
    if clearFlagAt ~= nil and os.time() >= clearFlagAt then
        os.remove(FLAG)
        clearFlagAt = nil
    end
    if blocked then return end
    local req = readJson(DIR .. "apply.json")
    if req == nil or type(req.id) ~= "string" or req.id == lastId then return end
    lastId = req.id
    local ws = spawner()
    if ws == nil then H.logError(MOD .. ": no TIAIWorldSpawner"); return end
    local before = readBack(ws)
    writeFile(FLAG, tostring(os.time()))
    local wrote = {}
    for _, f in ipairs(FIELDS) do
        local v = tonumber(req[f.key])
        if v ~= nil and v >= f.lo and v <= f.hi then
            if f.key ~= "cooldown" then v = math.floor(v) end
            if pcall(function() ws[f.prop] = v end) then wrote[#wrote + 1] = f.prop .. "=" .. tostring(v) end
        end
    end
    clearFlagAt = os.time() + 60
    local after = readBack(ws)
    H.log(string.format("%s: %s — wrote %s | before %s | after %s", MOD, req.id, table.concat(wrote, ", "),
        json.encode(before), json.encode(after)))
    writeFile(DIR .. "applied.json", json.encode({ id = req.id, t = os.time(), before = before, after = after }))
end

H.every(5000, MOD .. ": poll", poll)
local ws = spawner()
H.log(MOD .. ": loaded — spawner now " .. (ws and json.encode(readBack(ws)) or "not found yet"))
