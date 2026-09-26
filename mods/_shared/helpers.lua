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

--------------------------------------------------------------------------
-- Timing: how long each loop / hook holds the game thread
--------------------------------------------------------------------------
-- Every H.every loop and every hook wrapped in H.timed is timed with
-- os.clock (wall clock in ms on Windows); every PERF_REPORT_S one line goes to
-- UE4SS.log: "[perf] 300s: X ms on the game thread (Y %) — the top ones".
-- UE4SS's own cost of calling into Lua is not in it.

M.PERF_REPORT_S = 300
local perf, perfSince = {}, nil

function M.perfReport(now)
    now = now or os.time()
    local span = math.max(1, now - (perfSince or now))
    local rows, total = {}, 0
    for what, p in pairs(perf) do
        rows[#rows + 1] = { what = what, p = p }
        total = total + p.ms
    end
    table.sort(rows, function(a, b) return a.p.ms > b.p.ms end)
    local parts = {}
    for i = 1, math.min(#rows, 8) do
        local r = rows[i]
        parts[#parts + 1] = string.format("%s %.0f ms (%dx, max %.0f)", r.what, r.p.ms, r.p.n, r.p.max)
    end
    M.log(string.format("[perf] %s %ds: %.0f ms on the game thread (%.2f%%) — %s",
        M.modName or "?", span, total, total / (span * 10), #parts > 0 and table.concat(parts, " | ") or "nothing ran"))
    perf, perfSince = {}, now
end

local function perfRecord(what, seconds)
    local p = perf[what]
    if p == nil then p = { ms = 0, n = 0, max = 0 }; perf[what] = p end
    local ms = seconds * 1000
    p.ms, p.n = p.ms + ms, p.n + 1
    if ms > p.max then p.max = ms end
    local now = os.time()
    if perfSince == nil then perfSince = now
    elseif now - perfSince >= M.PERF_REPORT_S then M.perfReport(now) end
end

--- fn timed under `what`, errors caught and logged (as M.try). For hooks.
function M.timed(what, fn)
    if M.modName == nil and type(debug) == "table" and debug.getinfo then
        -- Each mod has its own copy of this file: name the report after the
        -- mod that asked (Mods/<name>/Scripts/main.lua).
        for level = 2, 4 do
            local info = debug.getinfo(level, "S")
            local name = info and tostring(info.source):match("Mods[/\\]([^/\\]+)[/\\]Scripts")
            if name then M.modName = name; break end
        end
    end
    return function(...)
        local t0 = os.clock()
        local _, res = M.try(what, fn, ...)
        perfRecord(what, os.clock() - t0)
        return res
    end
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

local reportedVital = {}

--- Read a number vital: the pawn's UFunction getter first, then property names.
-- Evrima keeps vitals in GAS attribute sets (UTIAttributeSetDinosaur), not as
-- pawn properties, so `pawn.Health` is nil; the pawn exposes GetHealth(),
-- GetStamina()… (the same family as the SetHealth() the garage calls). Which
-- path worked is logged once per label, so UE4SS.log shows what the live game
-- answered.
function M.readVital(obj, getter, candidates, label)
    if obj == nil then return nil end
    if getter then
        local ok, v = pcall(function() return obj[getter](obj) end)
        if ok and type(v) == "number" then
            if not reportedVital[label] then
                reportedVital[label] = true
                M.log(string.format("vital '%s' read via %s()", label, getter))
            end
            return v
        end
    end
    return tonumber(M.readField(obj, candidates, label))
end

--- The real field names of a struct VALUE (e.g. pawn.NutrientsStruct), read
--- from the engine's reflection data: value:GetProperty():GetStruct() is the
--- UScriptStruct, whose ForEachProperty lists its fields. Lets a mod copy a
--- whole struct without guessing names. Empty list on any failure.
function M.structFields(value)
    local names = {}
    pcall(function()
        value:GetProperty():GetStruct():ForEachProperty(function(prop)
            names[#names + 1] = prop:GetFName():ToString()
        end)
    end)
    return names
end

local loggedSkinFields = false

--- The dino's skin as the game holds it: pawn.CustomizerData (read-only here).
-- Every *Color field (FLinearColor, linear 0..1 per channel) under its real
-- name, plus PatternIndex / ThemeIndex / SkinVariation / bIsFemale. Names come
-- from reflection, so a renamed or added region shows up without a code change
-- (evrima-dev-knowledge EVRIMA_Customizer_Field_Map: reads are reliable; the
-- GetCustomizerData() wrapper is not what to read). nil when unreadable.
function M.readSkin(pawn)
    local ok, data = pcall(function() return pawn.CustomizerData end)
    if not ok or data == nil then return nil end
    local names = M.structFields(data)
    if #names == 0 then return nil end
    if not loggedSkinFields then
        loggedSkinFields = true
        M.log("skin: CustomizerData fields: " .. table.concat(names, ", "))
    end
    local skin = { colors = {} }
    local function round(v) return math.floor(v * 1000 + 0.5) / 1000 end
    for _, name in ipairs(names) do
        local got, v = pcall(function() return data[name] end)
        if got and v ~= nil then
            if name:match("Color$") then
                local okC, c = pcall(function() return { r = v.R, g = v.G, b = v.B } end)
                if okC and type(c.r) == "number" and type(c.g) == "number" and type(c.b) == "number" then
                    skin.colors[name:gsub("Color$", "")] = { r = round(c.r), g = round(c.g), b = round(c.b) }
                end
            elseif name == "PatternIndex" or name == "ThemeIndex" then
                if type(v) == "number" then skin[name:sub(1, 1):lower() .. name:sub(2)] = v end
            elseif name == "SkinVariation" then
                if type(v) == "number" then skin.variation = round(v) end
            elseif name == "bIsFemale" then
                if type(v) == "boolean" then skin.female = v end
            end
        end
    end
    if next(skin.colors) == nil then return nil end
    return skin
end

--- A stable text form of a skin, to notice a change between two reads.
function M.skinKey(skin)
    if skin == nil then return "" end
    local parts = { tostring(skin.patternIndex), tostring(skin.themeIndex), tostring(skin.variation) }
    local regions = {}
    for k in pairs(skin.colors) do regions[#regions + 1] = k end
    table.sort(regions)
    for _, k in ipairs(regions) do
        local c = skin.colors[k]
        parts[#parts + 1] = string.format("%s=%.3f,%.3f,%.3f", k, c.r, c.g, c.b)
    end
    return table.concat(parts, ";")
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
--
-- Lua does NOT talk to the player directly: sending chat from Lua (UpdateChat)
-- crashes the server below pcall (evrima-dev-knowledge EVRIMA_Chat_System),
-- and ClientMessage is not shown by Evrima's UI. Instead a "notify" event is
-- written; the bridge tails it and delivers it with RCON DirectMessage (0x11),
-- which the game shows to that one player.
function M.safeNotify(ctrl, msg)
    if not M.isValid(ctrl) then return false end
    local id = M.safeSteamId(ctrl)
    if not id then return false end
    -- Required here, not at the top: events.lua requires this module.
    local ok = M.try("safeNotify", function()
        require("shared.isle.events").emit({ type = "notify", steamId = id, message = tostring(msg) })
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
-- Newer UE4SS (the server's experimental build): ExecuteInGameThreadWithDelay
-- waits and runs on the game thread, one call from where we are (a hook).
-- Older builds: ExecuteWithDelay (async thread) then ExecuteInGameThread.
-- Handing a fresh closure from the async thread to the game thread is what
-- lost callbacks on the server ("Ref was not function", 2026-09-24).
function M.defer(ms, fn)
    if type(ExecuteInGameThreadWithDelay) == "function" then
        ExecuteInGameThreadWithDelay(ms, function()
            M.try("deferred callback", fn)
        end)
        return
    end
    ExecuteWithDelay(ms, function()
        M.onGameThread("deferred callback", fn)
    end)
end

--- Run fn on the game thread every `ms`, for as long as the server runs.
-- Preferred: LoopInGameThreadWithDelay — one callback, registered once, run by
-- the game thread itself. Queuing a new ExecuteInGameThread from a LoopAsync
-- tick every second lost callbacks on the server's experimental UE4SS
-- ("Ref was not function", 2026-09-24) and, with a "still queued" flag, a
-- lost one stopped the loop for good. The fallback (older builds) therefore
-- re-queues when a callback has not run for STUCK_AFTER_S.
local STUCK_AFTER_S = 15
function M.every(ms, what, fn)
    if type(LoopInGameThreadWithDelay) == "function" then
        local timedFn = M.timed(what, fn)
        LoopInGameThreadWithDelay(ms, function() timedFn() end)
        return true
    end
    local queuedAt = nil
    LoopAsync(ms, function()
        if queuedAt ~= nil and os.time() - queuedAt < STUCK_AFTER_S then return false end
        if queuedAt ~= nil then
            M.logError(tostring(what) .. ": game-thread callback lost, queueing it again")
        end
        queuedAt = os.time()
        local timedFn = M.timed(what, fn)
        local queued = M.onGameThread(what, function()
            queuedAt = nil
            timedFn()
        end)
        if not queued then queuedAt = nil end
        return false
    end)
    return true
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
-- onGone (optional) runs instead when, after the wait, the player has left or
-- has no dino — for callers that must undo something (a taken garage slot).
function M.deferWithPawn(ctrl, ms, fn, onGone)
    local id = M.safeSteamId(ctrl)
    if not id then
        if onGone then M.try("deferWithPawn onGone", onGone) end
        return
    end
    M.defer(ms, function()
        local ran = false
        M.forEachPlayer(function(c)
            if ran or M.safeSteamId(c) ~= id then return end
            local pawn = M.livePawnFromCtrl(c)
            if pawn then
                ran = true
                fn(c, pawn)
            end
        end)
        if not ran and onGone then M.try("deferWithPawn onGone", onGone) end
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

--- The text of an FText / FString / FName hook value, or nil.
-- tostring() on an FText gives "FText: 0000733DB33B7B08" — an address, not
-- the words — so every chat command silently failed to match.
function M.textOf(v)
    if type(v) == "string" then return v end
    if v == nil then return nil end
    local ok, s = pcall(function() return v:ToString() end)
    if ok and type(s) == "string" then return s end
    return nil
end

--- Register a chat handler: fn(ctrl, steamId, message).
-- Handlers run outside the hook (rule 4) and are pcall-wrapped individually,
-- so one bad handler cannot take down the others or the server.
function M.onChat(fn)
    chatHandlers[#chatHandlers + 1] = fn
    if chatHooked then return end
    chatHooked = true

    -- GetChatMessage(NewText, ChatPlayerController, ChatMode, NoFilterMsg) runs
    -- on the RECEIVING controller (self); the SENDER is ChatPlayerController.
    -- Taking self as the sender would run a command as whoever received it.
    RegisterHook(CHAT_HOOK, M.timed("chat hook", function(selfParam, textParam, senderParam)
        local ctrl = senderParam and senderParam:get()
        if not M.isValid(ctrl) then return end

        local id = M.safeSteamId(ctrl)
        if not id then return end

        local gotMsg, msg = pcall(function() return M.textOf(textParam:get()) end)
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
    end))

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
