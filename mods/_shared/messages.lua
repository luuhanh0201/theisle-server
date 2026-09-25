--[[
    _shared/messages.lua

    Every text a mod sends to players, editable on the admin panel
    (tab Thông báo). Each call names a key and carries its default text, so a
    mod works without the file and the panel can list the defaults
    (bridge/src/messages.ts keeps the same catalog; a bridge test checks that
    the two agree).

        Mods/shared/isle-messages.json   written by the bridge:
                                         { "texts": { key: "text with {name}" } }

    Only the texts an admin changed are in the file. An empty text means
    "do not send this one". {name} is filled from the call's vars; an unknown
    one is left as written. File I/O only: safe on any thread.
]]

local json = require("shared.isle.json")

local M = {}

M.PATH = "Mods/shared/isle-messages.json"
local RELOAD_S = 5            -- re-read the file at most this often

local texts, readAt = {}, nil

local function current()
    local now = os.time()
    if readAt ~= nil and now - readAt < RELOAD_S then return texts end
    readAt = now
    local f = io.open(M.PATH, "r")
    if not f then texts = {}; return texts end
    local raw = f:read("*a")
    f:close()
    local ok, data = pcall(json.decode, raw or "")
    -- A torn or broken file keeps the previous texts.
    if ok and type(data) == "table" and type(data.texts) == "table" then texts = data.texts end
    return texts
end

--- The text for `key` (the admin's, else `default`) with {name} filled from
--- `vars`, or nil when the admin turned it off (empty text).
function M.text(key, default, vars)
    local t = current()[key]
    if type(t) ~= "string" then t = default end
    if t == nil or t == "" then return nil end
    return (t:gsub("{(%w+)}", function(name)
        local v = vars and vars[name]
        if v == nil then return "{" .. name .. "}" end
        return tostring(v)
    end))
end

--- Send `key` to one player (H.safeNotify). False when turned off or not sent.
function M.notify(ctrl, key, default, vars)
    local text = M.text(key, default, vars)
    if text == nil then return false end
    return require("shared.isle.helpers").safeNotify(ctrl, text)
end

--- For the garage's `say` (in-game and on the web): send if not turned off.
function M.say(say, key, default, vars)
    local text = M.text(key, default, vars)
    if text ~= nil then say(text) end
end

--- Forget the cached file (tests).
function M.reset() texts, readAt = {}, nil end

return M
