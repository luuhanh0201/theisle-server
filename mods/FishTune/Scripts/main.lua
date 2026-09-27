-- FishTune — more ambient fish, by writing the world AI
-- spawner's fish numbers (MaxAmbientFishPerPlayer 12, AmbientFishSoftLimitPerWater
-- 28, AmbientFishSpawnAttemptsPerPlayer 1, AmbientFishSpawnCooldown 0.5 — the
-- game's). Game.ini [/Script/TheIsle.TIAIWorldSpawner] is NOT read (read back on
-- the test server, 2026-09-27). A Lua write on this spawner (GlobalAISpawnLimit,
-- FishControl) crash-looped the live server on 2026-09-26; these four fish
-- numbers were written on the test server with no crash (2026-09-27). Runs only
-- where an admin made Mods/FishTune/Saved/ENABLED — in Saved/, which a deploy
-- leaves alone (a marker next to Scripts/ was deleted by one; a second server on the same VPS
-- could not be joined — its listing pointed at the live port).
--
-- It writes nothing by itself. An admin drops Mods/FishTune/Saved/apply.json:
--   { "id": "a1", "perPlayer": 24, "perWater": 60, "attempts": 3, "cooldown": 0.25,
--     "minDist": 1000, "radius": 5000, "forwardDot": -1, "searchRadius": 2500,
--     "separation": 120, "debug": true, "census": true }
-- (any field left out is not written); each new id is applied once, on the
-- game thread, then read back into Saved/applied.json and UE4SS.log.
--
-- Keeping fish (Saved/keep.json, read every 5 s, kept across restarts):
--   { "enabled": true, "despawnDelay": 3600, "maxTotal": 60,
--     "perWindow": 10, "windowSec": 300,
--     "nearClass": "BP_Deinosuchus_C", "nearM": 5000,
--     "onlyClasses": ["BP_Catfish_C", "BP_Coalecanth_C", "BP_Muskel_C", "BP_Forktail_C"] }
-- onlyClasses: only these kinds are kept (the big and middle ones), the rest
-- go after 25 s as the game has it — DisallowedAIClasses does not stop fish.
-- Each fish the game places gets DespawnDelaySeconds = despawnDelay (game:
-- 25 s once no player is within its RelevanceDistance, 100 m), so fish stay
-- in the waters players have left: spread over the map instead of only
-- around players. RelevanceDistance is left alone (likely also who gets the
-- fish over the network). Past maxTotal kept fish, or past perWindow new ones
-- in windowSec, new ones are left to the game. Fish within nearM metres of a
-- player on nearClass (the crocodiles) are kept first. The mod cannot make
-- fish (the game parks and removes any it did not place): only the game's
-- spawner, around players near water, does. Flag first on the first write of
-- a run, like the spawner writes.
-- "debug" turns the game's own fish-spawn logging on (bDebugAmbientFishVerbose:
-- why a spawn failed, in TheIsle.log). "census" counts every TIAmbientFish the
-- game made — placed, or parked at (0, 0, 0) — by class.
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

local marker = io.open("Mods/FishTune/Saved/ENABLED", "r")
if not marker then
    H.log(MOD .. ": off (no Mods/FishTune/Saved/ENABLED) — nothing to do")
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
    -- Where a fish may appear: 30–70 m from the player, out of its sight
    -- (forward dot <= 0), searched 12.5 m around the chosen point (game's).
    { key = "minDist",      prop = "AmbientFishMinSpawnDistance", lo = 0, hi = 20000 },
    { key = "radius",       prop = "AmbientFishSpawnRadius", lo = 500, hi = 30000 },
    { key = "forwardDot",   prop = "AmbientFishHiddenSpawnForwardDot", lo = -1, hi = 1 },
    { key = "searchRadius", prop = "AmbientFishHiddenSpawnSearchRadius", lo = 100, hi = 10000 },
    { key = "separation",   prop = "AmbientFishMinSeparationDistance", lo = 0, hi = 2000 },
}
local INTS = { perPlayer = true, perWater = true, attempts = true }

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
            if INTS[f.key] then v = math.floor(v) end
            if pcall(function() ws[f.prop] = v end) then wrote[#wrote + 1] = f.prop .. "=" .. tostring(v) end
        end
    end
    if type(req.debug) == "boolean" then
        if pcall(function() ws.bDebugAmbientFishVerbose = req.debug end) then
            wrote[#wrote + 1] = "bDebugAmbientFishVerbose=" .. tostring(req.debug)
        end
    end
    clearFlagAt = os.time() + 60
    local after = readBack(ws)
    local census = nil
    if req.census == true then
        census = { placed = 0, parked = 0, byClass = {} }
        local okF, all = pcall(function() return FindAllOf("TIAmbientFish") or {} end)
        for _, a in ipairs(okF and all or {}) do
            local okL, v = pcall(function() return a:K2_GetActorLocation() end)
            local okC, n = pcall(function() return a:GetClass():GetFName():ToString() end)
            local cls = okC and tostring(n) or "?"
            if okL and v and (math.abs(v.X) + math.abs(v.Y) + math.abs(v.Z)) < 1 then census.parked = census.parked + 1
            else census.placed = census.placed + 1 end
            census.byClass[cls] = (census.byClass[cls] or 0) + 1
        end
        H.log(string.format("%s: %s — census: %d placed, %d parked, %s", MOD, req.id, census.placed, census.parked,
            json.encode(census.byClass)))
    end
    H.log(string.format("%s: %s — wrote %s | before %s | after %s", MOD, req.id, table.concat(wrote, ", "),
        json.encode(before), json.encode(after)))
    writeFile(DIR .. "applied.json", json.encode({ id = req.id, t = os.time(), before = before, after = after, census = census }))
end

-- Keeping fish: every placed fish written once (by address), up to maxTotal.
local kept = {}          -- address -> true: fish given the long despawn delay
local keptLog = 0
local function addressOf(obj)
    local ok, a = pcall(function() return obj:GetAddress() end)
    return ok and type(a) == "number" and a ~= 0 and a or nil
end
local windowStart, windowCount = 0, 0

-- Watching the kept kinds (onlyClasses): each fish's last place, so a fish
-- that jumps (moved by the game) or goes away is logged with how far the
-- nearest player was when last seen — eaten, removed by the game, or moved.
local track = {}         -- address -> { cls, x, y, z, since, near, who }
local JUMP_CM = 6000     -- more than 60 m in one 5 s look: moved, not swum

--- Every player's place (game thread): { {id, x, y}, … }.
local function allPlayers()
    local out = {}
    H.forEachPlayer(function(ctrl)
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local okL, v = pcall(function() return pawn:K2_GetActorLocation() end)
        if okL and v then out[#out + 1] = { H.safeSteamId(ctrl) or "?", v.X, v.Y } end
    end)
    return out
end
local function nearestOf(players, x, y)
    local best, who = nil, nil
    for _, p in ipairs(players) do
        local d = math.sqrt((x - p[2]) ^ 2 + (y - p[3]) ^ 2)
        if best == nil or d < best then best, who = d, p[1] end
    end
    return best, who
end

--- Where the players on `cls` are (game thread): { {x, y}, … }.
local function playersOn(cls)
    local out = {}
    if type(cls) ~= "string" or cls == "" then return out end
    H.forEachPlayer(function(ctrl)
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local okC, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
        if not (okC and tostring(n) == cls) then return end
        local okL, v = pcall(function() return pawn:K2_GetActorLocation() end)
        if okL and v then out[#out + 1] = { v.X, v.Y } end
    end)
    return out
end

local function keepFish()
    if blocked then return end
    local k = readJson(DIR .. "keep.json")
    if k == nil or k.enabled ~= true then return end
    local delay = tonumber(k.despawnDelay) or 3600
    local maxTotal = math.floor(tonumber(k.maxTotal) or 60)
    local perWindow = math.floor(tonumber(k.perWindow) or 1000)
    local windowSec = tonumber(k.windowSec) or 300
    local nearCm = (tonumber(k.nearM) or 0) * 100
    if delay < 25 or delay > 604800 or maxTotal < 0 or maxTotal > 1000 or perWindow < 0 or windowSec < 10 then return end
    local now = os.time()
    if now - windowStart >= windowSec then windowStart, windowCount = now, 0 end

    local okF, all = pcall(function() return FindAllOf("TIAmbientFish") or {} end)
    if not okF then return end
    local crocs = nearCm > 0 and playersOn(k.nearClass) or {}
    local only = nil
    if type(k.onlyClasses) == "table" and #k.onlyClasses > 0 then
        only = {}
        for _, c in ipairs(k.onlyClasses) do if type(c) == "string" then only[c] = true end end
    end
    local seen, count, placed, fresh = {}, 0, 0, 0
    local near, far = {}, {}
    local players = allPlayers()
    for _, a in ipairs(all) do
        local addr = addressOf(a)
        if addr then
            local okL, v = pcall(function() return a:K2_GetActorLocation() end)
            local parked = okL and v and (math.abs(v.X) + math.abs(v.Y) + math.abs(v.Z)) < 1
            if okL and v and not parked then
                placed = placed + 1
                seen[addr] = true
                local wanted = true
                local t = track[addr]
                if only ~= nil and not kept[addr] and t == nil then
                    local okC, n = pcall(function() return a:GetClass():GetFName():ToString() end)
                    wanted = okC and only[tostring(n)] == true
                    if wanted then
                        t = { cls = tostring(n), x = v.X, y = v.Y, z = v.Z, since = now }
                        track[addr] = t
                    end
                end
                if t ~= nil then
                    local jump = math.sqrt((v.X - t.x) ^ 2 + (v.Y - t.y) ^ 2 + (v.Z - t.z) ^ 2)
                    if jump > JUMP_CM then
                        local d, who = nearestOf(players, v.X, v.Y)
                        H.log(string.format("%s: fish moved — %s jumped %.0f m in one look (nearest player %s m, %s)",
                            MOD, t.cls, jump / 100, d and string.format("%.0f", d / 100) or "?", tostring(who)))
                    end
                    t.x, t.y, t.z = v.X, v.Y, v.Z
                    t.near, t.who = nearestOf(players, v.X, v.Y)
                end
                if kept[addr] then
                    count = count + 1
                elseif wanted then
                    local close = false
                    for _, c in ipairs(crocs) do
                        if (v.X - c[1]) ^ 2 + (v.Y - c[2]) ^ 2 <= nearCm ^ 2 then close = true; break end
                    end
                    table.insert(close and near or far, { a = a, addr = addr })
                end
            end
        end
    end
    -- Near the crocodiles first, then the rest, within both limits.
    for _, list in ipairs({ near, far }) do
        for _, f in ipairs(list) do
            if count >= maxTotal or windowCount >= perWindow then break end
            local first = clearFlagAt == nil and next(kept) == nil
            if first then writeFile(FLAG, tostring(now)); clearFlagAt = now + 60 end
            if pcall(function() f.a.DespawnDelaySeconds = delay end) then
                kept[f.addr] = true
                count, fresh, windowCount = count + 1, fresh + 1, windowCount + 1
            end
        end
    end
    for addr in pairs(kept) do if not seen[addr] then kept[addr] = nil end end
    for addr, t in pairs(track) do
        if not seen[addr] then
            H.log(string.format("%s: fish gone — %s after %d s; last seen %s m from the nearest player (%s)%s", MOD,
                t.cls, now - t.since, t.near and string.format("%.0f", t.near / 100) or "?", tostring(t.who),
                (t.near and t.near <= 800) and " — close by: eaten, or removed by the game" or " — nobody near: removed by the game"))
            track[addr] = nil
        end
    end
    if (fresh > 0 and now - keptLog >= 60) or now - keptLog >= 300 then
        keptLog = now
        H.log(string.format("%s: keep — %d fish kept (+%d), %d placed in all, %d near %d crocodile(s), max %d, %d/%d this window",
            MOD, count, fresh, placed, #near, #crocs, maxTotal, windowCount, perWindow))
    end
end

H.every(5000, MOD .. ": poll", function() poll(); keepFish() end)
local ws = spawner()
H.log(MOD .. ": loaded — spawner now " .. (ws and json.encode(readBack(ws)) or "not found yet"))
