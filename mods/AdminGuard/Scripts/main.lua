-- AdminGuard, an admin whose rights in the game the super admin switched off
-- (panel → Quản trị → Phân quyền, bridge/src/permissions.ts) loses them now,
-- not only at the next restart.
--
--   Mods/shared/isle-admins.json   written by the bridge:
--                                  { "off": ["7656…"], "on": ["7656…"] }
--
-- The game reads its admin list (Game.ini AdminsSteamIDs) when it starts; the
-- bridge already leaves these admins out of it, so from the next restart they
-- are plain players. Until then, on each of their controllers and player
-- states, the game's admin flags that read true are set to false (and back to
-- true if they are switched on again). Whether the game honours the flags for
-- every admin command is not known yet: the first time it finds one, this mod
-- logs which flags it found; the panel's log shows any command such an admin
-- still used (the game logs those, bridge/src/game-admin-log.ts).
--
-- Safety (docs/lua-safety-rules.md): game thread only (H.every); controllers
-- re-found every tick, only SteamIDs kept; scalar bool reads / writes on the
-- player's own controller and player state, each in pcall.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local MOD = "AdminGuard"
local PATH = "Mods/shared/isle-admins.json"
local TICK_MS = 2000
local RELOAD_S = 5
local FLAGS = { "bIsAdmin", "bSafeIsAdmin", "bIsAdminCred" }

local list, raw, readAt = { off = {}, on = {} }, nil, nil

local function current()
    local now = os.time()
    if readAt ~= nil and now - readAt < RELOAD_S then return list end
    readAt = now
    local f = io.open(PATH, "r")
    if not f then list, raw = { off = {}, on = {} }, nil; return list end
    local text = f:read("*a")
    f:close()
    if text == raw then return list end
    local ok, d = pcall(json.decode, text or "")
    if not ok or type(d) ~= "table" then return list end   -- a torn file keeps the last
    raw = text
    local function set(arr)
        local s = {}
        for _, id in ipairs(type(arr) == "table" and arr or {}) do s[tostring(id)] = true end
        return s
    end
    list = { off = set(d.off), on = set(d.on) }
    return list
end

-- SteamID -> { ["PlayerState.bIsAdmin"] = true, … }: what this mod set to false (to put back).
local cleared = {}
local reported = {}

local function holders(ctrl)
    local out = { Controller = ctrl }
    local ok, ps = pcall(function() return ctrl.PlayerState end)
    if ok and H.isValid(ps) then out.PlayerState = ps end
    return out
end

local function readFlag(obj, f)
    local ok, v = pcall(function() return obj[f] end)
    if ok and type(v) == "boolean" then return v end
    return nil
end

local function revoke(ctrl, id)
    local found, done = {}, cleared[id] or {}
    for where, obj in pairs(holders(ctrl)) do
        for _, f in ipairs(FLAGS) do
            local v = readFlag(obj, f)
            if v ~= nil then found[#found + 1] = where .. "." .. f .. "=" .. tostring(v) end
            if v == true and pcall(function() obj[f] = false end) then done[where .. "." .. f] = true end
        end
    end
    cleared[id] = done
    if not reported[id] then
        reported[id] = true
        H.log(string.format("%s: %s is switched off in game, flags read: %s; cleared: %s", MOD, id,
            #found > 0 and table.concat(found, ", ") or "none readable",
            next(done) and table.concat((function() local k = {} for n in pairs(done) do k[#k + 1] = n end return k end)(), ", ") or "none"))
    end
end

local function restore(ctrl, id)
    local done = cleared[id]
    if done == nil then return end
    for where, obj in pairs(holders(ctrl)) do
        for _, f in ipairs(FLAGS) do
            if done[where .. "." .. f] then pcall(function() obj[f] = true end) end
        end
    end
    cleared[id], reported[id] = nil, nil
    H.log(string.format("%s: %s is switched on in game again, flags put back", MOD, id))
end

H.every(TICK_MS, MOD .. " tick", function()
    local l = current()
    if next(l.off) == nil and next(cleared) == nil then return end
    H.forEachPlayer(function(ctrl)
        local id = H.safeSteamId(ctrl)
        if id == nil then return end
        if l.off[id] then revoke(ctrl, id)
        elseif cleared[id] ~= nil and l.on[id] then restore(ctrl, id) end
    end)
end)

H.log(MOD .. ": loaded, list from " .. PATH)
