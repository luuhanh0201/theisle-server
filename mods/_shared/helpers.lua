--[[
    _shared/helpers.lua

    Shared guards for every mod. Read docs/lua-safety-rules.md first.

    Contract for everything in this file:
      * it never raises — engine calls are pcall-wrapped
      * it returns nil / false on failure and logs the reason
      * it re-resolves UObjects instead of trusting cached ones
]]

local M = {}

M.LOG_PREFIX = "[isle]"

--------------------------------------------------------------------------
-- Logging (goes to UE4SS.log)
--------------------------------------------------------------------------

function M.log(msg)
    print(string.format("%s %s\n", M.LOG_PREFIX, tostring(msg)))
end

function M.logError(msg)
    print(string.format("%s [error] %s\n", M.LOG_PREFIX, tostring(msg)))
end

--------------------------------------------------------------------------
-- Safe engine calls
--------------------------------------------------------------------------

--- Run fn in a pcall, log on failure.
-- @return ok, result
function M.try(what, fn, ...)
    local ok, res = pcall(fn, ...)
    if not ok then
        M.logError(tostring(what) .. ": " .. tostring(res))
        return false, nil
    end
    return true, res
end

--- True only if obj is a usable UObject right now.
-- Rule 1: never trust a stored reference; call this at the point of use.
function M.isValid(obj)
    if obj == nil then return false end
    local ok, valid = pcall(function() return obj:IsValid() end)
    return ok and valid == true
end

--------------------------------------------------------------------------
-- Defensive property reads
--------------------------------------------------------------------------

local reportedField = {}

--- Read the first property name that resolves on obj, nil if none do.
-- Evrima property names are not documented, so every mod that reads a pawn
-- carries a list of candidates. A miss is logged once per label and returns
-- nil; it is never a crash and never silent.
function M.readField(obj, candidates, label)
    if obj == nil then return nil end
    for _, name in ipairs(candidates) do
        local ok, v = pcall(function() return obj[name] end)
        if ok and v ~= nil then return v end
    end
    if not reportedField[label] then
        reportedField[label] = true
        M.logError(string.format(
            "readField: no candidate resolved for '%s' (tried: %s) — "
            .. "verify the name with UE4SS Live View", label,
            table.concat(candidates, ", ")))
    end
    return nil
end

--------------------------------------------------------------------------
-- Player / pawn resolution
--------------------------------------------------------------------------

--- Re-resolve the live pawn from a controller.
-- Returns nil if the controller died, unpossessed, or the pawn is stale.
function M.livePawnFromCtrl(ctrl)
    if not M.isValid(ctrl) then return nil end

    local ok, pawn = pcall(function() return ctrl.Pawn end)
    if not ok then return nil end
    if not M.isValid(pawn) then return nil end

    return pawn
end

--- SteamID64 as a string, or nil.
-- The controller exposes GetSteamId() directly; that is what upstream uses and
-- what the chat hook hands us. PlayerState is only a fallback for controllers
-- that do not implement it.
function M.safeSteamId(ctrl)
    if not M.isValid(ctrl) then return nil end

    local ok, id = pcall(function()
        return ctrl:GetSteamId():ToString()
    end)
    if ok and id ~= nil and id ~= "" and id ~= "0" then
        return tostring(id)
    end

    local ok2, id2 = pcall(function()
        local ps = ctrl.PlayerState
        if not M.isValid(ps) then return nil end
        return tostring(ps.PlatformUniqueNetId or ps.UniqueId or "")
    end)
    if not ok2 or id2 == nil or id2 == "" then return nil end
    return id2
end

--- Iterate every currently valid PlayerController.
-- The list is rebuilt on each call; never cache the result.
function M.forEachPlayer(fn)
    local ok, controllers = pcall(function()
        return FindAllOf("PlayerController") or {}
    end)
    if not ok then
        M.logError("forEachPlayer: FindAllOf failed")
        return
    end

    for _, ctrl in ipairs(controllers) do
        if M.isValid(ctrl) then
            M.try("forEachPlayer callback", fn, ctrl)
        end
    end
end

--------------------------------------------------------------------------
-- Messaging
--------------------------------------------------------------------------

--- Send a message to one player. Silently does nothing if they left.
function M.safeNotify(ctrl, msg)
    if not M.isValid(ctrl) then return false end

    local ok = M.try("safeNotify", function()
        ctrl:ClientMessage(tostring(msg))
    end)
    return ok
end

function M.broadcast(msg)
    M.forEachPlayer(function(ctrl) M.safeNotify(ctrl, msg) end)
end

--------------------------------------------------------------------------
-- Deferral
--------------------------------------------------------------------------

local warnedNoGameThread = false

--- Run fn on the game thread. Returns false (and runs nothing) when this UE4SS
-- build has no ExecuteInGameThread.
--
-- Engine objects may only be touched on the game thread. ExecuteWithDelay and
-- LoopAsync callbacks run on UE4SS's async thread, so anything that reads or
-- writes a UObject from there must come through here. Failing closed is
-- deliberate: running the work off-thread instead is the crash this exists to
-- prevent (AGENTS.md: heavy actions run in a game-thread tick).
function M.onGameThread(what, fn)
    if type(ExecuteInGameThread) ~= "function" then
        if not warnedNoGameThread then
            warnedNoGameThread = true
            M.logError("ExecuteInGameThread is not available in this UE4SS build — "
                .. "refusing to touch engine objects off the game thread ('"
                .. tostring(what) .. "' and everything like it will not run)")
        end
        return false
    end
    ExecuteInGameThread(function()
        M.try(what, fn)
    end)
    return true
end

--- Run fn after `ms`, never on the current call stack, and on the game thread.
-- Rule 3/4: use this instead of doing work inside a Pre hook, and re-resolve
-- every object inside fn — the world has moved on by then.
-- The delay itself is ExecuteWithDelay's (async thread); fn is then handed to
-- the game thread, because it almost always touches a pawn or controller.
function M.defer(ms, fn)
    ExecuteWithDelay(ms, function()
        M.onGameThread("deferred callback", fn)
    end)
end

--- Defer an action for a specific player, re-resolving them on the way.
-- Never capture `ctrl` in a deferred closure yourself: this takes the SteamID
-- now and looks the controller up again when the timer fires, so a player who
-- left in between is simply skipped.
function M.deferWithPlayer(ctrl, ms, fn)
    local id = M.safeSteamId(ctrl)
    if not id then return end

    M.defer(ms, function()
        M.forEachPlayer(function(c)
            if M.safeSteamId(c) == id then fn(c) end
        end)
    end)
end

--- Same, but only runs when the player also has a live pawn.
function M.deferWithPawn(ctrl, ms, fn)
    M.deferWithPlayer(ctrl, ms, function(c)
        local pawn = M.livePawnFromCtrl(c)
        if pawn then fn(c, pawn) end
    end)
end

--------------------------------------------------------------------------
-- Chat commands
--------------------------------------------------------------------------

-- The real hook is GetChatMessage on TIPlayerController, and it fires more
-- than once per message. Upstream deduplicates on (sender, message) within a
-- 3 second window; we do the same here, once, so no mod has to repeat it.
--
-- See docs/reference/EVRIMA_DinoStorage_Architecture.md.

local CHAT_HOOK  = "/Script/TheIsle.TIPlayerController:GetChatMessage"
local DEDUP_SECS = 3

local chatHandlers = {}
local chatHooked   = false
local lastSeen     = {}   -- "id\0message" -> timestamp

local function pruneSeen(now)
    for key, ts in pairs(lastSeen) do
        if now - ts > DEDUP_SECS then lastSeen[key] = nil end
    end
end

--- Register a chat handler: fn(ctrl, steamId, message).
-- Handlers run outside the hook (rule 4) and are pcall-wrapped individually,
-- so one bad handler cannot take down the others or the server.
function M.onChat(fn)
    chatHandlers[#chatHandlers + 1] = fn
    if chatHooked then return end
    chatHooked = true

    RegisterHook(CHAT_HOOK, function(ctrlParam, msgParam)
        M.try("chat hook", function()
            local ctrl = ctrlParam and ctrlParam:get()
            if not M.isValid(ctrl) then return end

            local id = M.safeSteamId(ctrl)
            if not id then return end

            local gotMsg, msg = pcall(function() return tostring(msgParam:get()) end)
            if not gotMsg or msg == nil or msg == "" then return end

            local now = os.time()
            pruneSeen(now)
            local key = id .. "\0" .. msg
            if lastSeen[key] ~= nil then return end   -- duplicate fire
            lastSeen[key] = now

            -- Rule 4: never act inside the hook. Re-resolve the player on the
            -- way out so handlers get a controller that is still valid.
            M.deferWithPlayer(ctrl, 0, function(c)
                for _, handler in ipairs(chatHandlers) do
                    M.try("chat handler", handler, c, id, msg)
                end
            end)
        end)
    end)

    M.log("chat hook registered on " .. CHAT_HOOK)
end

--- Parse "!cmd arg1 arg2" into command, { args }. nil if not a command.
function M.parseCommand(msg)
    local body = msg:match("^%s*!(.+)%s*$")
    if not body then return nil end

    local parts = {}
    for word in body:gmatch("%S+") do parts[#parts + 1] = word end
    if #parts == 0 then return nil end

    local cmd = table.remove(parts, 1):lower()
    return cmd, parts
end

return M
