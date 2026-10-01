--[[
    _shared/prison.lua

    Who is serving a prison sentence (mods/Prison, bridge/src/prison.ts), for
    the mods that must refuse them something: !slay / !unstuck
    (PlayerCommands), being carried off by a Pteranodon (PteraCarry).

        Mods/shared/isle-prison.json   written by the bridge:
                                       { "inmates": ["7656119…", …] }

    An escaped inmate is still an inmate. No file = nobody. File I/O only, at
    most every RELOAD_S: safe on any thread.
]]

local json = require("shared.isle.json")

local P = {}

P.PATH = "Mods/shared/isle-prison.json"
local RELOAD_S = 5

local inmates, readAt = {}, nil

local function current()
    local now = os.time()
    if readAt ~= nil and now - readAt < RELOAD_S then return inmates end
    readAt = now
    local f = io.open(P.PATH, "r")
    if not f then inmates = {}; return inmates end
    local raw = f:read("*a")
    f:close()
    local ok, data = pcall(json.decode, raw or "")
    -- A torn or broken file keeps the previous list.
    if ok and type(data) == "table" and type(data.inmates) == "table" then
        local set = {}
        for _, id in ipairs(data.inmates) do set[tostring(id)] = true end
        inmates = set
    end
    return inmates
end

--- True while this SteamID has a sentence to serve.
function P.isInmate(steamId)
    if steamId == nil then return false end
    return current()[tostring(steamId)] == true
end

--- Forget the cached file (tests).
function P.reset() inmates, readAt = {}, nil end

return P
