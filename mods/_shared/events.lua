--[[
    _shared/events.lua

    Append-only NDJSON streams that the bridge service tails.

    TWO streams, deliberately:

      events.ndjson     kills, damage, chat, sessions, garage, growth
                        milestones. Low volume, long retention. This is the
                        record you go back to when moderating or building a
                        leaderboard.

      snapshots.ndjson  the vitals + position firehose, one line per online
                        player every few seconds. High volume, short
                        retention. Feeds the live map and current-state views.

    One combined stream would mean a busy evening of snapshots rotates the
    chat log and the killfeed out of existence. They have different retention
    needs, so they are different files.

    Writing never raises. A full disk, a missing directory or an unencodable
    value costs an event and a log line, never the server.
]]

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local E = {}

-- The directory belongs to StatsLogger because that mod produces nearly all
-- of the volume; the paths live here so nobody hard-codes them twice.
local ROOT = "ue4ss/Mods/StatsLogger/Saved"

E.STREAMS = {
    events    = { path = ROOT .. "/events.ndjson",    rotate = 50 * 1024 * 1024 },
    snapshots = { path = ROOT .. "/snapshots.ndjson", rotate = 50 * 1024 * 1024 },
}

-- Kept for readability at call sites and in log lines.
E.PATH = E.STREAMS.events.path

local function rotateIfNeeded(stream)
    local f = io.open(stream.path, "r")
    if not f then return end
    local size = f:seek("end")
    f:close()
    if size < stream.rotate then return end

    local rotated = stream.path .. "." .. os.date("!%Y%m%dT%H%M%SZ")
    local ok, err = os.rename(stream.path, rotated)
    if ok then
        H.log("events: rotated to " .. rotated)
    else
        H.logError("events: rotate failed: " .. tostring(err))
    end
end

--- Append a batch to one stream in a single open/close.
-- @param streamName "events" or "snapshots"
function E.emitManyTo(streamName, events)
    if #events == 0 then return end

    local stream = E.STREAMS[streamName]
    if stream == nil then
        H.logError("events: unknown stream '" .. tostring(streamName) .. "'")
        return
    end

    local lines = {}
    for _, event in ipairs(events) do
        event.t    = event.t or os.time()
        event.type = event.type or "unknown"
        local ok, line = pcall(json.encode, event)
        if ok then
            lines[#lines + 1] = line
        else
            H.logError("events: encode failed: " .. tostring(line))
        end
    end
    if #lines == 0 then return end

    rotateIfNeeded(stream)

    local f = io.open(stream.path, "a")
    if not f then
        H.logError("events: cannot open " .. stream.path)
        return
    end
    f:write(table.concat(lines, "\n"), "\n")
    f:close()
end

function E.emitTo(streamName, event)
    E.emitManyTo(streamName, { event })
end

-- Convenience wrappers for the common stream.
function E.emitMany(events) E.emitManyTo("events", events) end
function E.emit(event)      E.emitTo("events", event) end

return E
