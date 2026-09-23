--[[
    DinoGarage/storage.lua

    On-disk layout, following docs/reference/EVRIMA_DinoStorage_Architecture.md:

        Saved/storage.json          index, rebuildable
        Saved/stored/<steam>/<slot>.json

    Write order is per-slot file FIRST, index SECOND. A crash between the two
    leaves the index stale, but redeem reads the slot file, so nothing is lost
    and `rebuildIndex` can repair it.
]]

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local S = {}

S.ROOT        = "ue4ss/Mods/DinoGarage/Saved"
S.INDEX_PATH  = S.ROOT .. "/storage.json"
S.SCHEMA      = 4    -- index format version, upstream
S.SLOT_VERSION = 1   -- per-slot file version, upstream

--------------------------------------------------------------------------
-- Paths
--------------------------------------------------------------------------

-- Slot names come from chat, so they are untrusted. Anything outside this set
-- is rejected rather than sanitised — a silently renamed slot is worse than a
-- refusal the player can see.
function S.isValidSlot(name)
    return type(name) == "string"
        and #name > 0 and #name <= 32
        and name:match("^[%w_%-]+$") ~= nil
end

-- FLAT layout, one directory: stored/<steam>__<slot>.json
--
-- Upstream nests these as stored/<steam>/<slot>.json, but Lua has no mkdir and
-- io.open will not create a missing directory. A per-player directory would
-- therefore never exist for a first-time player and every store would fail.
-- Shelling out to mkdir from inside the game process under Wine is not a trade
-- worth making, so the layout is flat and install.sh creates the one directory.
--
-- SteamID64 is always 17 digits, so the name parses back unambiguously; the
-- bridge service splits it the same way.
function S.slotPath(steamId, slot)
    return S.ROOT .. "/stored/" .. steamId .. "__" .. slot .. ".json"
end

--------------------------------------------------------------------------
-- Raw file helpers
--------------------------------------------------------------------------

local function readJson(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local raw = f:read("*a")
    f:close()

    local ok, data = pcall(json.decode, raw)
    if not ok then 
        H.logError("storage: " .. path .. " is unreadable: " .. tostring(data))
        return nil
    end
    return data
end

-- Write to a temp file and rename, so a crash mid-write cannot leave a
-- truncated slot file where a valid one used to be.
local function writeJson(path, value)
    local ok, encoded = pcall(json.encode, value)
    if not ok then
        H.logError("storage: encode failed for " .. path .. ": " .. tostring(encoded))
        return false
    end

    local tmp = path .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then
        H.logError("storage: cannot write " .. tmp .. " (does the directory exist?)")
        return false
    end
    f:write(encoded)
    f:close()

    os.remove(path)
    local renamed, err = os.rename(tmp, path)
    if not renamed then
        H.logError("storage: rename failed for " .. path .. ": " .. tostring(err))
        return false
    end
    return true
end

--------------------------------------------------------------------------
-- Index
--------------------------------------------------------------------------

local index = { schema = S.SCHEMA, players = {} }

function S.loadIndex()
    local data = readJson(S.INDEX_PATH)
    if type(data) == "table" and type(data.players) == "table" then
        index = data
        index.schema = S.SCHEMA
    else
        index = { schema = S.SCHEMA, players = {} }
    end
end

local function saveIndex()
    return writeJson(S.INDEX_PATH, index)
end

--- Slots for one player, always read fresh from disk.
-- The bridge service writes slot files and the index while the server is
-- running (that is how an admin puts a dino straight into someone's garage),
-- so an index cached at boot would hide them. The file is small and this is
-- only called from chat commands.
function S.listSlots(steamId)
    S.loadIndex()
    local entry = index.players[steamId]
    if type(entry) ~= "table" then return {} end
    return entry
end

--------------------------------------------------------------------------
-- Public API
--------------------------------------------------------------------------

--- Persist one captured state. Slot file first, then index.
function S.put(steamId, slot, state)
    state.version    = S.SLOT_VERSION
    state.slot       = slot
    state.capturedAt = os.time()

    if not writeJson(S.slotPath(steamId, slot), state) then
        return false, "could not write the slot file"
    end

    index.players[steamId] = index.players[steamId] or {}
    index.players[steamId][slot] = {
        classPath  = state.classPath,
        growth     = state.growth,
        capturedAt = state.capturedAt,
    }
    if not saveIndex() then
        -- The slot file is on disk and redeem reads that, so this is a warning,
        -- not a failure. rebuildIndex() repairs it.
        H.logError("storage: slot saved but index update failed for " .. steamId)
    end
    return true
end

--- Read one slot back. Returns nil when the slot does not exist or is corrupt.
function S.get(steamId, slot)
    local state = readJson(S.slotPath(steamId, slot))
    if type(state) ~= "table" then return nil end
    if state.version ~= S.SLOT_VERSION then
        H.logError(string.format(
            "storage: %s/%s has version %s, expected %d — refusing to apply",
            steamId, slot, tostring(state.version), S.SLOT_VERSION))
        return nil
    end
    return state
end

--- The slot captured most recently, as `!redeem` with no argument uses.
function S.mostRecent(steamId)
    local best, bestAt = nil, -1
    for slot, meta in pairs(S.listSlots(steamId)) do
        local at = tonumber(meta.capturedAt) or 0
        if at > bestAt then best, bestAt = slot, at end
    end
    return best
end

--- Forget a slot. The file is left on disk on purpose: dropping a player's
--- dino because an index write failed is not a trade we make.
function S.forget(steamId, slot)
    local entry = index.players[steamId]
    if entry == nil then return end
    entry[slot] = nil
    saveIndex()
end

return S
