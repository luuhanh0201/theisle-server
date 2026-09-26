--[[
    DinoGarage/primefix.lua

    Prime progress given back by an admin. Before 2026-09-26 the garage did
    not keep the prime conditions (migration / patrol zones visited…) and
    never read back a stored dino's prime: a dino that went through the
    garage lost both. The bridge writes the fixes (from the events that show
    what each dino had); this applies each one ONCE, when its player is online
    on the right dino.

        Saved/prime-fixes.json       written by the bridge
            { "fixes": [ { id, steamId, species ("BP_Triceratops_C"),
                           minGrowth, maxGrowth,
                           primeData { cond1..cond10, eligible }, prime,
                           expiresAt } ] }
        Saved/prime-fixes.done.json  written here: { "done": { "<id>": t } }

    A fix waits (up to expiresAt) until that player plays that species within
    that growth range — a dino still in the garage is fixed right after it is
    taken out. Game thread (H.every in main.lua): reads one small file.
]]

local H       = require("shared.isle.helpers")
local Events  = require("shared.isle.events")
local json    = require("shared.isle.json")
local Msg     = require("shared.isle.messages")
local Restore = require("garage.restore")

local P = {}

P.FIXES_PATH = "Mods/DinoGarage/Saved/prime-fixes.json"
P.DONE_PATH  = "Mods/DinoGarage/Saved/prime-fixes.done.json"

local function readJson(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local raw = f:read("*a")
    f:close()
    local ok, d = pcall(json.decode, raw or "")
    return ok and type(d) == "table" and d or nil
end

local done = nil   -- id -> os.time(), loaded lazily

local function loadDone()
    if done == nil then
        local d = readJson(P.DONE_PATH)
        done = type(d) == "table" and type(d.done) == "table" and d.done or {}
    end
    return done
end

local function saveDone()
    local tmp = P.DONE_PATH .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then H.logError("primefix: cannot write " .. tmp); return end
    f:write(json.encode({ done = done }))
    f:close()
    os.remove(P.DONE_PATH)
    os.rename(tmp, P.DONE_PATH)
end

--- "BlueprintGeneratedClass /Game/…/BP_Triceratops.BP_Triceratops_C" -> "BP_Triceratops_C"
local function classOf(pawn)
    local ok, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    if not ok or n == nil then return nil end
    return tostring(n):match("([%w_]+)$")
end

local function valid(fix)
    return type(fix) == "table" and type(fix.id) == "string" and fix.id:match("^[%w_%-]+$") ~= nil
        and type(fix.steamId) == "string" and fix.steamId:match("^%d+$") ~= nil
        and type(fix.species) == "string" and tonumber(fix.minGrowth) ~= nil and tonumber(fix.maxGrowth) ~= nil
        and (type(fix.primeData) == "table" or fix.prime == true)
end

--- One pass: every open fix whose player is on the right dino now.
function P.poll()
    local d = readJson(P.FIXES_PATH)
    if type(d) ~= "table" or type(d.fixes) ~= "table" then return end
    local now = os.time()
    local open = {}
    for _, fix in ipairs(d.fixes) do
        if valid(fix) and loadDone()[fix.id] == nil and now <= (tonumber(fix.expiresAt) or 0) then
            open[fix.steamId] = open[fix.steamId] or {}
            table.insert(open[fix.steamId], fix)
        end
    end
    if next(open) == nil then return end

    local changed = false
    H.forEachPlayer(function(ctrl)
        local id = H.safeSteamId(ctrl)
        local fixes = id and open[id]
        if not fixes then return end
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local okH, hp = pcall(function() return pawn:GetHealth() end)
        if okH and type(hp) == "number" and hp <= 0 then return end   -- a corpse: wait for the next dino
        local cls = classOf(pawn)
        local okG, g = pcall(function() return pawn:GetGrowth() end)
        if not (cls and okG and type(g) == "number") then return end
        for _, fix in ipairs(fixes) do
            if cls == fix.species and g >= tonumber(fix.minGrowth) and g <= tonumber(fix.maxGrowth) then
                -- Given back only: a condition the dino has gained since stays.
                local give = {}
                for k, v in pairs(type(fix.primeData) == "table" and fix.primeData or {}) do
                    if v == true then give[k] = true end
                end
                local wrote, isPrime = Restore.applyPrime(pawn, give, fix.prime == true)
                done[fix.id] = now
                changed = true
                H.log(string.format("primefix: %s for %s (%s %.2f) — %d conditions, prime %s",
                    fix.id, id, cls, g, wrote, tostring(isPrime)))
                Events.emit({ type = "prime_fix", id = fix.id, steamId = id, species = cls, growth = g,
                    conditions = wrote, prime = isPrime, t = now })
                Msg.notify(ctrl, "garage.primeFixed",
                    "Đã khôi phục tiến độ prime (các vùng di cư, tuần tra…) mà gara làm mất. Xin lỗi vì sự cố!")
                break   -- one fix per dino per pass
            end
        end
    end)
    if changed then saveDone() end
end

return P
