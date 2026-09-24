--[[
    DinoGarage/inbox.lua

    Admin commands from the bridge service — the CommandBridge pattern
    (docs/architecture.md): the bridge cannot touch the game, so it writes a
    file and this mod polls it.

        Saved/inbox.json      written by the bridge (atomically, via rename)
                              { "commands": [ { id, type, steamId, reason,
                                                createdAt, expiresAt } ] }
        Saved/inbox.ack.json  written here: { "lastId": n }

    Every command runs AT MOST ONCE:
      * ids only grow; anything <= lastId is already handled
      * lastId is persisted, so a server restart does not replay old commands
      * a command past expiresAt is refused, not run late — an admin who
        clicked "kill" a minute ago is no longer looking at the same situation

    The outcome of each command is emitted as an `admin_kill` event, which the
    bridge reads back from events.ndjson.

    Supported: "kill" — SetHealth(0) on the player's current dino, exactly what
    !store does. Nothing else is accepted.

    Threads: poll() runs on the async thread and only reads/writes files. The
    kill, including finding the player, runs on the game thread. Its outcome
    is queued and written by the NEXT poll, up to one poll (2s) later.
]]

local H      = require("shared.isle.helpers")
local Events = require("shared.isle.events")
local json   = require("shared.isle.json")

local I = {}

I.INBOX_PATH = "Mods/DinoGarage/Saved/inbox.json"
I.ACK_PATH   = "Mods/DinoGarage/Saved/inbox.ack.json"

local lastId = nil   -- loaded lazily from the ack file

local function readJson(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local raw = f:read("*a")
    f:close()
    if raw == nil or raw == "" then return nil end
    local ok, data = pcall(json.decode, raw)
    if not ok then
        H.logError("inbox: " .. path .. " is unreadable: " .. tostring(data))
        return nil
    end
    return data
end

local function writeAck(id)
    local tmp = I.ACK_PATH .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then
        H.logError("inbox: cannot write " .. tmp)
        return false
    end
    f:write(json.encode({ lastId = id }))
    f:close()
    os.remove(I.ACK_PATH)
    local ok, err = os.rename(tmp, I.ACK_PATH)
    if not ok then H.logError("inbox: ack rename failed: " .. tostring(err)) end
    return ok
end

local function loadLastId()
    if lastId ~= nil then return lastId end
    local ack = readJson(I.ACK_PATH)
    lastId = (type(ack) == "table" and tonumber(ack.lastId)) or 0
    return lastId
end

local function findCtrl(steamId)
    local found = nil
    H.forEachPlayer(function(c)
        if found == nil and H.safeSteamId(c) == steamId then found = c end
    end)
    return found
end

-- Outcomes are queued, not written: results decided on the game thread must
-- not do file I/O there. The next poll (async) writes them.
local pendingResults = {}

local function result(cmd, ok, fields)
    local event = {
        type    = "admin_kill",
        id      = cmd.id,
        steamId = cmd.steamId,
        reason  = cmd.reason,
        ok      = ok,
        t       = os.time(),
    }
    for k, v in pairs(fields or {}) do event[k] = v end
    pendingResults[#pendingResults + 1] = event
end

local function writeResults()
    if #pendingResults == 0 then return end
    local batch = pendingResults
    pendingResults = {}
    Events.emitMany(batch)
end

--- Kill one player's current dino. EVERYTHING that touches the engine —
--- finding the controller, reading the pawn, SetHealth — runs on the game
--- thread; this function itself runs on the async polling thread.
local function kill(cmd)
    local queued = H.onGameThread("inbox: kill " .. cmd.steamId, function()
        local c = findCtrl(cmd.steamId)
        if c == nil then
            result(cmd, false, { error = "offline" })
            return
        end
        local pawn = H.livePawnFromCtrl(c)
        if pawn == nil then
            result(cmd, false, { error = "no_dino" })
            return
        end

        local species, growth = nil, nil
        pcall(function() species = pawn:GetClass():GetFName():ToString() end)
        growth = tonumber(H.readField(pawn, { "Growth", "GrowthPercent" }, "growth"))

        local ok = H.try("inbox: SetHealth(0)", function() pawn:SetHealth(0) end)
        if ok then
            local msg = "An admin removed your dino."
            if type(cmd.reason) == "string" and cmd.reason ~= "" then
                msg = msg .. " Reason: " .. cmd.reason
            end
            H.safeNotify(c, msg)
        end
        result(cmd, ok, {
            species = species and tostring(species) or nil,
            growth  = growth,
            error   = (not ok) and "set_health_failed" or nil,
        })
    end)
    if not queued then
        -- No game thread in this UE4SS build: refuse rather than run it here.
        result(cmd, false, { error = "no_game_thread" })
    end
end

--- One poll: run every new, unexpired command once, then persist the ack.
function I.poll()
    -- Outcomes from the previous poll's game-thread work.
    writeResults()

    local inbox = readJson(I.INBOX_PATH)
    if type(inbox) ~= "table" or type(inbox.commands) ~= "table" then return end

    local seen = loadLastId()
    local now = os.time()
    local highest = seen

    -- Oldest first, so a later command never overtakes an earlier one.
    local pending = {}
    for _, cmd in ipairs(inbox.commands) do
        local id = type(cmd) == "table" and tonumber(cmd.id) or nil
        if id ~= nil and id > seen then pending[#pending + 1] = cmd end
    end
    table.sort(pending, function(a, b) return tonumber(a.id) < tonumber(b.id) end)

    for _, cmd in ipairs(pending) do
        local id = tonumber(cmd.id)
        highest = math.max(highest, id)
        -- Ack BEFORE acting: if we crash mid-command, it is skipped on the
        -- next start rather than run twice.
        lastId = highest
        writeAck(highest)

        local steamOk = type(cmd.steamId) == "string" and cmd.steamId:match("^%d+$") ~= nil
        if not steamOk then
            H.logError("inbox: command " .. id .. " has no valid steamId")
        elseif tonumber(cmd.expiresAt) == nil or now > tonumber(cmd.expiresAt) then
            result(cmd, false, { error = "expired" })
        elseif cmd.type == "kill" then
            H.log("inbox: kill " .. cmd.steamId .. " (command " .. id .. ")")
            kill(cmd)
        else
            H.logError("inbox: unknown command type '" .. tostring(cmd.type) .. "'")
            result(cmd, false, { error = "unknown_command" })
        end
    end
end

return I
