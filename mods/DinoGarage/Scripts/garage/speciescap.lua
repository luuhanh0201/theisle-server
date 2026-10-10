--[[
    DinoGarage/speciescap.lua

    The species limit (owner, 2026-10-10: "server chỉ cho 8 T-Rex thì người thứ
    9 không thấy T-Rex trên bảng chọn dino"). The bridge (species-cap.ts) counts
    the dinos alive, takes a full species off the game's picker (RCON) and, for
    a player with no priority slot (not VIP / SVip / admin) who still came in
    as one past the common slots (picked a moment before it went off, or into
    a priority slot), writes them here:

        Mods/DinoGarage/Saved/species-cap.json
        { "over": [ { "id": 12, "steamId": "7656…", "species": "Tyrannosaurus", "killAt": <unix s> } ] }

    This module, on the game thread (H.every):
      * tells them once (cap.over), with the seconds left
      * at killAt, the same dino still alive: health 0 (as !slay and the
        garage's store), so they pick another species; told (cap.killed)
      * a dino that changed meanwhile (died, stored, another one): nothing,
        that entry is done (a new spawn gets a new id from the bridge)
    and the garage refuses a redeem to anyone listed (M.blocked): the young
    dino of a full species would else take a stored one out and be killed
    with it.

    Safety (docs/lua-safety-rules.md): nothing kept but SteamIDs, ids and a
    pawn's address (compared, never used); every pawn re-resolved from its
    controller each tick; engine calls in pcall. File read at most every
    RELOAD_S; a torn file keeps the last list.
]]

local H      = require("shared.isle.helpers")
local json   = require("shared.isle.json")
local Msg    = require("shared.isle.messages")
local Events = require("shared.isle.events")

local M = {}

M.PATH = "Mods/DinoGarage/Saved/species-cap.json"
M.TICK_MS = 2500   -- not 2000: the inbox poll's (tests find loops by period)
local RELOAD_S = 2

local over, readAt = {}, nil   -- steamId -> { id, species, killAt }
local seen = {}                -- id -> pawn address when first seen
local done = {}                -- id -> true (killed, or its dino gone)

local function current()
    local now = os.time()
    if readAt ~= nil and now - readAt < RELOAD_S then return over end
    readAt = now
    local f = io.open(M.PATH, "r")
    if not f then over = {}; return over end
    local raw = f:read("*a")
    f:close()
    local ok, d = pcall(json.decode, raw or "")
    if not ok or type(d) ~= "table" then return over end
    local list = {}
    for _, e in ipairs(type(d.over) == "table" and d.over or {}) do
        local id, killAt = tonumber(type(e) == "table" and e.id), tonumber(type(e) == "table" and e.killAt)
        if id and killAt and type(e.steamId) == "string" and type(e.species) == "string" then
            list[e.steamId] = { id = id, species = e.species, killAt = killAt }
        end
    end
    over = list
    return over
end

--- Whether the garage must refuse this player a redeem now.
function M.blocked(steamId)
    local e = current()[tostring(steamId)]
    return e ~= nil and not done[e.id]
end

local function call(pawn, fn)
    local ok, v = pcall(function() return pawn[fn](pawn) end)
    return ok and type(v) == "number" and v or nil
end

--- "BP_Tyrannosaurus_C" -> "Tyrannosaurus"
local function speciesOf(pawn)
    local ok, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    if not ok or n == nil then return nil end
    local cls = tostring(n):match("([%w_]+)$") or tostring(n)
    return (cls:gsub("^BP_", ""):gsub("_C$", ""))
end

local function addressOf(pawn)
    local ok, a = pcall(function() return pawn:GetAddress() end)
    return ok and a or nil
end

--- One pass (game thread).
function M.guard()
    local list = current()
    if next(list) == nil then return end
    local now = os.time()
    H.forEachPlayer(function(ctrl)
        local id = H.safeSteamId(ctrl)
        local e = id and list[id]
        if not e or done[e.id] then return end
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local hp = call(pawn, "GetHealth")
        local addr = addressOf(pawn)
        if (hp ~= nil and hp <= 0) or speciesOf(pawn) ~= e.species or addr == nil then
            -- Dead, or another species: that dino is gone, the entry with it.
            if seen[e.id] ~= nil then done[e.id] = true end
            return
        end
        if seen[e.id] == nil then
            seen[e.id] = addr
            Msg.notify(ctrl, "cap.over",
                "{species} đã đủ suất cho người chơi thường. Dino này sẽ bị xoá sau {seconds} giây, hãy chọn loài khác.",
                { species = e.species, seconds = math.max(0, math.floor(e.killAt - now)) })
            H.log(string.format("speciescap: %s came in as a %s past the limit, removed at %d", id, e.species, e.killAt))
        elseif seen[e.id] ~= addr then
            done[e.id] = true   -- another dino since (stored, died and back): not this one
            return
        end
        if now < e.killAt then return end
        done[e.id] = true
        if not pcall(function() pawn:SetHealth(0) end) then
            H.logError("speciescap: SetHealth(0) failed for " .. id)
            return
        end
        Msg.notify(ctrl, "cap.killed", "{species} đã đủ suất: dino đã được xoá, hãy chọn loài khác.", { species = e.species })
        Events.emit({ type = "species_cap_kill", steamId = id, species = e.species, capId = e.id })
        H.log(string.format("speciescap: %s's %s removed (over the limit)", id, e.species))
    end)
end

--- Forget the cached file and what was seen (tests).
function M.reset() over, readAt, seen, done = {}, nil, {}, {} end

return M
