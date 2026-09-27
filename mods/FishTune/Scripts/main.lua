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
-- A fish with a long despawn delay could not be caught: bitten, it went
-- without feeding the crocodile (2026-09-27). So a fish is kept only while
-- nobody is within keepFromM (80 m), and handed back to the game (25 s) as
-- soon as a player comes within releaseM (40 m) — before they can bite it.
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
--
-- Watching (Saved/watch.json, read only — writes nothing on the game):
--   { "enabled": true, "classes": ["BP_Coalecanth_C", "BP_Catfish_C"], "nearM": 30 }
-- Why a big fish bitten by a crocodile can go without feeding it (2026-09-27:
-- a 44 % Deinosuchus ate one, a 27 % one bit one and it was gone). Each fish
-- of those kinds that comes within nearM of a player is logged once with its
-- size (GetActorScale3D, an AActor function like K2_GetActorLocation) and that
-- player's dino (class, growth, stomach). When it goes while a player was that
-- close, the same, then 2, 6 and 12 s later: the player's stomach again, and
-- what is at that spot — Pawns (a fish the game turned into a creature, a
-- carcass) and fish of that kind. A jump (> 60 m in one look) is logged too.

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

local GAME_DELAY = 25    -- the game's own DespawnDelaySeconds

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
    if k == nil or k.enabled ~= true then
        -- Turned off: every fish still kept goes back to the game's delay.
        if next(kept) ~= nil then
            local okF, all = pcall(function() return FindAllOf("TIAmbientFish") or {} end)
            local back = 0
            for _, a in ipairs(okF and all or {}) do
                local addr = addressOf(a)
                if addr and kept[addr] and pcall(function() a.DespawnDelaySeconds = GAME_DELAY end) then back = back + 1 end
            end
            kept = {}
            H.log(string.format("%s: keep turned off — %d fish handed back to the game", MOD, back))
        end
        return
    end
    local delay = tonumber(k.despawnDelay) or 3600
    local maxTotal = math.floor(tonumber(k.maxTotal) or 60)
    local perWindow = math.floor(tonumber(k.perWindow) or 1000)
    local windowSec = tonumber(k.windowSec) or 300
    local nearCm = (tonumber(k.nearM) or 0) * 100
    local releaseCm = (tonumber(k.releaseM) or 40) * 100
    local keepFromCm = math.max((tonumber(k.keepFromM) or 80) * 100, releaseCm)
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
    local seen, count, placed, fresh, released = {}, 0, 0, 0, 0
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
                if only ~= nil and not kept[addr] then
                    local okC, n = pcall(function() return a:GetClass():GetFName():ToString() end)
                    wanted = okC and only[tostring(n)] == true
                end
                local nd = nearestOf(players, v.X, v.Y)
                if kept[addr] and nd ~= nil and nd < releaseCm then
                    -- A player is coming: a plain fish again, so it can be caught.
                    pcall(function() a.DespawnDelaySeconds = GAME_DELAY end)
                    kept[addr] = nil
                    released = released + 1
                end
                if not kept[addr] and nd ~= nil and nd < keepFromCm then wanted = false end
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
    if ((fresh > 0 or released > 0) and now - keptLog >= 60) or now - keptLog >= 300 then
        keptLog = now
        H.log(string.format("%s: keep — %d fish kept (+%d, %d handed back: a player near), %d placed in all, %d near %d crocodile(s), max %d, %d/%d this window",
            MOD, count, fresh, released, placed, #near, #crocs, maxTotal, windowCount, perWindow))
    end
end

-- Watching (see the top): read only.
local watch = {}         -- address -> { cls, x, y, z, since, near, who, scale }
local kinds = {}         -- address -> class name, read once per fish
local JUMP_CM = 6000     -- more than 60 m in one 2 s look: moved, not swum
local LOOK_CM = 2500     -- after a fish went: what is within 25 m of its spot
local LOOKS_MS = { 2000, 6000, 12000 }

local function metres(cm) return cm and string.format("%.0f", cm / 100) or "?" end

--- The dino of player `id` now (game thread): "BP_Deinosuchus_C 0.28, stomach 1.8/13.5".
local function dinoOf(id)
    local out = nil
    H.forEachPlayer(function(ctrl)
        if out ~= nil or H.safeSteamId(ctrl) ~= id then return end
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local function num(fn)
            local ok, v = pcall(function() return pawn[fn](pawn) end)
            return ok and type(v) == "number" and v or nil
        end
        local okC, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
        out = { cls = okC and tostring(n) or "?", growth = num("GetGrowth"), hunger = num("GetHunger"), maxHunger = num("GetMaxHunger") }
    end)
    return out
end
local function dinoText(d)
    if d == nil then return "dino ?" end
    return string.format("%s %.2f, stomach %.1f/%.1f", d.cls, d.growth or -1, d.hunger or -1, d.maxHunger or -1)
end

local function scaleOf(a)
    local ok, s = pcall(function()
        local v = a:GetActorScale3D()
        return string.format("%.2f/%.2f/%.2f", v.X, v.Y, v.Z)
    end)
    return ok and s or "?"
end

--- What is at a spot a fish left (game thread): non-player Pawns and fish of that kind.
local function lookAt(t, id, before, ms)
    local found = {}
    local players = {}
    H.forEachPlayer(function(ctrl)
        local p = H.livePawnFromCtrl(ctrl)
        local addr = p and addressOf(p)
        if addr then players[addr] = true end
    end)
    local function near(obj)
        local okL, v = pcall(function() return obj:K2_GetActorLocation() end)
        if not (okL and v) then return nil end
        local d = math.sqrt((v.X - t.x) ^ 2 + (v.Y - t.y) ^ 2 + (v.Z - t.z) ^ 2)
        return d <= LOOK_CM and d or nil
    end
    local okP, pawns = pcall(function() return FindAllOf("Pawn") or {} end)
    for _, p in ipairs(okP and pawns or {}) do
        local addr = addressOf(p)
        if addr and not players[addr] then
            local d = near(p)
            if d then
                local okC, n = pcall(function() return p:GetClass():GetFName():ToString() end)
                local okH, hp = pcall(function() return p:GetHealth() end)
                found[#found + 1] = string.format("pawn %s hp %s at %s m", okC and tostring(n) or "?",
                    (okH and type(hp) == "number") and string.format("%.0f", hp) or "?", metres(d))
            end
        end
    end
    local okF, same = pcall(function() return FindAllOf(t.cls) or {} end)
    for _, f in ipairs(okF and same or {}) do
        local d = near(f)
        if d then found[#found + 1] = string.format("%s at %s m", t.cls, metres(d)) end
    end
    local now = dinoOf(id)
    local fed = (now and now.hunger and before and before.hunger) and string.format("%+.1f", now.hunger - before.hunger) or "?"
    H.log(string.format("%s: watch +%d s — %s stomach %s since (%s); at the spot: %s", MOD, ms / 1000, tostring(id), fed,
        dinoText(now), #found > 0 and table.concat(found, ", ") or "nothing"))
end

local function watchFish()
    local w = readJson(DIR .. "watch.json")
    if w == nil or w.enabled ~= true then watch, kinds = {}, {}; return end
    local classes = {}
    for _, c in ipairs(type(w.classes) == "table" and w.classes or {}) do
        if type(c) == "string" then classes[c] = true end
    end
    local nearCm = (tonumber(w.nearM) or 30) * 100
    local okF, all = pcall(function() return FindAllOf("TIAmbientFish") or {} end)
    if not okF then return end
    local now = os.time()
    local players = allPlayers()
    local seen = {}
    for _, a in ipairs(all) do
        local addr = addressOf(a)
        local okL, v = pcall(function() return a:K2_GetActorLocation() end)
        local placed = addr and okL and v and (math.abs(v.X) + math.abs(v.Y) + math.abs(v.Z)) >= 1
        if placed then
            seen[addr] = true
            if kinds[addr] == nil then
                local okC, n = pcall(function() return a:GetClass():GetFName():ToString() end)
                kinds[addr] = okC and tostring(n) or "?"
            end
            local cls = kinds[addr]
            if classes[cls] then
                local t = watch[addr]
                if t == nil then
                    t = { cls = cls, x = v.X, y = v.Y, z = v.Z, since = now }
                    watch[addr] = t
                end
                local jump = math.sqrt((v.X - t.x) ^ 2 + (v.Y - t.y) ^ 2 + (v.Z - t.z) ^ 2)
                local d, who = nearestOf(players, v.X, v.Y)
                if jump > JUMP_CM then
                    H.log(string.format("%s: fish moved — %s jumped %s m in one look (nearest player %s m, %s)",
                        MOD, cls, metres(jump), metres(d), tostring(who)))
                end
                t.x, t.y, t.z, t.near, t.who = v.X, v.Y, v.Z, d, who
                if d ~= nil and d <= nearCm and t.scale == nil then
                    t.scale = scaleOf(a)
                    H.log(string.format("%s: fish near — %s size %s, %s m from %s (%s)", MOD, cls, t.scale, metres(d),
                        tostring(who), dinoText(dinoOf(who))))
                end
            end
        end
    end
    for addr in pairs(kinds) do if not seen[addr] then kinds[addr] = nil end end
    for addr, t in pairs(watch) do
        if not seen[addr] then
            watch[addr] = nil
            if t.scale ~= nil then
                local close = t.near ~= nil and t.near <= nearCm
                local before = close and dinoOf(t.who) or nil
                H.log(string.format("%s: fish gone — %s size %s after %d s, last seen %s m from %s%s", MOD, t.cls, t.scale,
                    now - t.since, metres(t.near), tostring(t.who), close and (" (" .. dinoText(before) .. ")") or " — nobody near"))
                if close then
                    for _, ms in ipairs(LOOKS_MS) do
                        H.defer(ms, function() lookAt(t, t.who, before, ms) end)
                    end
                end
            end
        end
    end
end

-- Every 2 s: a crocodile swims ~5 m/s, so a kept fish is handed back well
-- before one closing in from 40 m can bite it.
H.every(2000, MOD .. ": poll", function() poll(); keepFish(); watchFish() end)
local ws = spawner()
H.log(MOD .. ": loaded — spawner now " .. (ws and json.encode(readBack(ws)) or "not found yet"))
