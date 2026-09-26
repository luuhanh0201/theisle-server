--[[
    DinoGarage

    Park the dino you are playing and get it back later.

    Model is upstream's: TRANSFORM-IN-PLACE, NEVER RESPAWN-WITH-CUSTOMIZER.
    The player is never kicked and RequestRespawn is never called — it crashes
    from Lua. See docs/reference/EVRIMA_DinoStorage_Architecture.md.

    Used from the WEB garage (portal → bridge → Saved/inbox.json →
    garage/inbox.lua); the chat commands only point players to the web.

        store    countdown (stand still: 5 m, no damage), then capture and
                 remove the dino in one tick, into the next free slot 1, 2, 3…
                 (the player then picks the SAME species at respawn)
        redeem   restore the stored state onto the fresh juvenile

    Admins can also remove a player's current dino from the panel, the same way.

    This mod mutates game state, which makes it the riskiest thing in the repo.
    Every engine call is guarded, every failure leaves the stored slot intact,
    and a restore that half-applies is reported rather than hidden.
]]

-- Resolve require("shared.isle.*") to Mods/shared/isle/ whatever UE4SS itself
-- puts on package.path. Relative to the server's working directory
-- (Binaries/Win64), like every path the mods use.
if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H       = require("shared.isle.helpers")
local Events  = require("shared.isle.events")
local Msg     = require("shared.isle.messages")
local Storage = require("garage.storage")
local Capture = require("garage.capture")
local Restore = require("garage.restore")
local Inbox   = require("garage.inbox")
local Settings = require("garage.settings")
local PrimeFix = require("garage.primefix")

local MOD = "DinoGarage"

local RESTORE_DELAY_MS = 3000   -- upstream: "!redeem queues restore in 3 seconds"
local INBOX_POLL_MS    = 2000   -- admin commands from the bridge

H.log(MOD .. ": loading")
Storage.loadIndex()

--------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------

local function countSlots(steamId)
    local n = 0
    for _ in pairs(Storage.listSlots(steamId)) do n = n + 1 end
    return n
end

local function speciesOf(pawn)
    local ok, name = pcall(function() return pawn:GetClass():GetFullName() end)
    if not ok or name == nil then return nil end
    return tostring(name)
end

--------------------------------------------------------------------------
-- Store (from the web garage — the chat command is gone)
--------------------------------------------------------------------------
-- The countdown is a stand-still test: until it ends the dino must stay
-- within STORE_RADIUS_CM of where the store started and neither deal nor
-- take damage. Otherwise the store fails AT ONCE with the reason, and a
-- failed store does not start the garage cooldown: the player may try again
-- right away. Slots are numbered 1, 2, 3… (the lowest free number).

local STORE_RADIUS_CM  = 500     -- 5 m
local GUARD_EVERY_MS   = 1000
local HEALTH_SLACK_PCT = 0.01    -- health lost beyond 1 % of max = "took damage"

-- Garage cooldown, per player, in memory (a server restart resets it).
local lastGarageUse = {}

--- Seconds left before this player may use the garage again, or nil.
local function cooldownLeft(steamId, settings)
    local at = lastGarageUse[steamId]
    if at == nil then return nil end
    local left = at + settings.cooldown - os.time()
    if left > 0 then return left end
    return nil
end

-- Stores waiting for their countdown:
-- steamId -> { slot, address, class, origin, health, maxHealth, cmdId }
local pendingStore = {}

local REASON_VI = {
    moved          = "bạn đã rời khỏi bán kính 5 m",
    damage_dealt   = "bạn đã gây sát thương",
    damage_taken   = "bạn đã chịu sát thương",
    left           = "bạn đã thoát game hoặc dino đã chết",
    not_same_dino  = "không còn là con dino lúc bắt đầu cất",
    full           = "gara đã đầy",
    capture_failed = "không đọc được trạng thái dino",
    save_failed    = "không lưu được vào gara",
    kill_failed    = "không gỡ được dino khỏi game",
}

local function addressOf(pawn)
    local ok, a = pcall(function() return pawn:GetAddress() end)
    return ok and a or nil
end

local function locOf(pawn)
    local ok, l = pcall(function()
        local v = pawn:K2_GetActorLocation()
        return { x = v.X, y = v.Y, z = v.Z }
    end)
    if ok and l and type(l.x) == "number" and type(l.y) == "number" and type(l.z) == "number" then return l end
    return nil
end

local function callNumber(pawn, fn)
    local ok, v = pcall(function() return pawn[fn](pawn) end)
    return ok and type(v) == "number" and v or nil
end

local function findCtrl(steamId)
    local found = nil
    H.forEachPlayer(function(c)
        if found == nil and H.safeSteamId(c) == steamId then found = c end
    end)
    return found
end

--- The lowest free slot number, as text: "1", "2", …
local function nextSlot(steamId)
    local slots = Storage.listSlots(steamId)
    local n = 1
    while slots[tostring(n)] ~= nil do n = n + 1 end
    return tostring(n)
end

--- The final outcome of a store, for the web (by the inbox command id).
local function storeResult(steamId, pending, ok, reason)
    Events.emit({
        type = "garage_store_result", id = pending.cmdId, steamId = steamId,
        slot = pending.slot, ok = ok, reason = reason,
    })
end

-- Texts editable on the admin panel (shared/messages.lua): key, default, vars.
local function failMessage(reason)
    local why = Msg.text("garage.reason." .. reason, REASON_VI[reason] or reason) or reason
    return Msg.text("garage.failed", "Cất thất bại: {reason}. Bạn có thể cất lại ngay.", { reason = why })
end

--- End a pending store as failed; its countdown timer then finds nothing to do.
local function failStore(steamId, reason, c)
    local pending = pendingStore[steamId]
    if pending == nil then return end
    pendingStore[steamId] = nil
    storeResult(steamId, pending, false, reason)
    c = c or findCtrl(steamId)
    local text = failMessage(reason)
    if c and text then H.safeNotify(c, text) end
    H.log(MOD .. ": store for " .. steamId .. " failed: " .. reason)
end

local CORPSE_GROWTH = 0.25   -- a stored dino's corpse: a hatchling's

--- Runs when the countdown ends: capture, save, remove the dino — all in
--- this one tick, so there is no moment where both the slot and the live
--- dino exist (a player quitting in between used to keep both).
local function finishStore(c, pawn, steamId, pending)
    local slot = pending.slot
    local settings = Settings.read()
    local function failed(reason)
        storeResult(steamId, pending, false, reason)
        local text = failMessage(reason)
        if text then H.safeNotify(c, text) end
    end
    if addressOf(pawn) ~= pending.address or speciesOf(pawn) ~= pending.class then
        failed("not_same_dino")
        return
    end
    if Storage.listSlots(steamId)[slot] == nil and countSlots(steamId) >= settings.maxSlots then
        failed("full")
        return
    end

    local state, reason = Capture.capture(pawn)
    if not state then
        H.logError(MOD .. ": capture failed for " .. steamId .. ": " .. tostring(reason))
        failed("capture_failed")
        return
    end
    local ok = Storage.put(steamId, slot, state)
    if not ok then
        failed("save_failed")
        return
    end
    -- The corpse left behind is a hatchling's, not the stored dino's: shrunk
    -- to CORPSE_GROWTH first (the slot already holds the real growth), so a
    -- store does not leave a grown dino's worth of meat to eat.
    if H.isValid(pawn) then
        H.try(MOD .. ": SetGrowth(corpse)", function() pawn:SetGrowth(CORPSE_GROWTH) end)
    end
    local killed = H.isValid(pawn) and H.try(MOD .. ": SetHealth(0)", function() pawn:SetHealth(0) end)
    if not killed then
        Storage.discard(steamId, slot)
        failed("kill_failed")
        return
    end
    lastGarageUse[steamId] = os.time()

    Events.emit({
        type    = "garage_store",
        steamId = steamId,
        slot    = slot,
        species = state.classPath,
        growth  = state.growth,
    })
    storeResult(steamId, pending, true, nil)
    Msg.notify(c, "garage.stored", "Đã cất dino vào gara. Respawn đúng loài rồi lấy ra trên trang web.")
end

--- Start a store into the next free slot. `say` gets the immediate replies
--- (the web shows them); `cmdId` ties the final outcome to the web command.
--- Returns true once the countdown has started.
local function doStore(ctrl, steamId, say, cmdId)
    say = say or function(m) H.safeNotify(ctrl, m) end
    if pendingStore[steamId] then
        Msg.say(say, "garage.busy", "Đang có một lần cất đang đếm ngược.")
        return false
    end
    local settings = Settings.read()
    local wait = cooldownLeft(steamId, settings)
    if wait then
        Msg.say(say, "garage.cooldown", "Gara đang hồi: chờ {seconds} giây.", { seconds = wait })
        return false
    end

    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        Msg.say(say, "garage.noDino", "Bạn cần đang điều khiển dino để cất.")
        return false
    end
    if countSlots(steamId) >= settings.maxSlots then
        Msg.say(say, "garage.full", "Gara đã đầy ({maxSlots} slot). Lấy bớt một con ra trước.", { maxSlots = settings.maxSlots })
        return false
    end
    local origin = locOf(pawn)
    if origin == nil then
        Msg.say(say, "garage.noLocation", "Không đọc được vị trí dino. Thử lại.")
        return false
    end

    -- Nothing is saved during the countdown: moving away, fighting, leaving
    -- the game or losing the dino before it ends fails the store.
    local health = callNumber(pawn, "GetHealth")
    local pending = {
        slot = nextSlot(steamId), address = addressOf(pawn), class = speciesOf(pawn),
        origin = origin, health = health, maxHealth = callNumber(pawn, "GetMaxHealth") or health, cmdId = cmdId,
    }
    pendingStore[steamId] = pending
    local seconds = settings.storeCountdown
    if seconds > 0 then
        Msg.say(say, "garage.countdown", "Bắt đầu cất sau {seconds} giây — đứng yên trong bán kính 5 m, không đánh và không bị đánh.", { seconds = seconds })
        if seconds > 10 then
            H.deferWithPlayer(ctrl, (seconds - 10) * 1000, function(c)
                if pendingStore[steamId] == pending then Msg.notify(c, "garage.tenSeconds", "Còn 10 giây là cất xong — đứng yên.") end
            end)
        end
    end
    H.deferWithPawn(ctrl, seconds * 1000, function(c, livePawn)
        if pendingStore[steamId] ~= pending then return end
        pendingStore[steamId] = nil
        finishStore(c, livePawn, steamId, pending)
    end, function()
        if pendingStore[steamId] == pending then
            pendingStore[steamId] = nil
            storeResult(steamId, pending, false, "left")
            H.log(MOD .. ": store for " .. steamId .. " cancelled — player or dino gone before the countdown ended")
        end
    end)
    return true
end

--- Once a second, on the game thread: is every storing dino still in place
--- and unhurt? (Damage from players is also caught at once by the hook below;
--- the health check catches AI bites, falls and bleeding, which fire no hook.)
local function guardStores()
    if next(pendingStore) == nil then return end
    for steamId, pending in pairs(pendingStore) do
        local c = findCtrl(steamId)
        local pawn = c and H.livePawnFromCtrl(c)
        if pawn then   -- gone: the countdown's own onGone handles it
            if addressOf(pawn) ~= pending.address then
                failStore(steamId, "not_same_dino", c)
            else
                local here = locOf(pawn)
                local o = pending.origin
                local health = callNumber(pawn, "GetHealth")
                local slack = math.max(1, (pending.maxHealth or pending.health or 0) * HEALTH_SLACK_PCT)
                if here and math.sqrt((here.x - o.x) ^ 2 + (here.y - o.y) ^ 2 + (here.z - o.z) ^ 2) > STORE_RADIUS_CM then
                    failStore(steamId, "moved", c)
                elseif health and pending.health and health < pending.health - slack then
                    failStore(steamId, "damage_taken", c)
                end
            end
        end
    end
end

-- Player-on-player damage (the same hook StatsLogger reads): a storing dino
-- that hits or is hit fails at once. Reads only; no engine writes in a hook.
pcall(function()
    RegisterHook("/Script/TheIsle.TICharacterBase:ApplyDamage", H.timed(MOD .. ": damage hook", function(selfParam, targetParam)
        if next(pendingStore) == nil then return end
        H.try(MOD .. ": store damage guard", function()
            local attacker = selfParam and selfParam:get()
            local target = targetParam and targetParam:get()
            local a = H.isValid(attacker) and addressOf(attacker) or nil
            local t = H.isValid(target) and addressOf(target) or nil
            for steamId, pending in pairs(pendingStore) do
                if a ~= nil and a == pending.address then
                    failStore(steamId, "damage_dealt")
                elseif t ~= nil and t == pending.address then
                    failStore(steamId, "damage_taken")
                end
            end
        end)
    end))
end)

--------------------------------------------------------------------------
-- !redeem
--------------------------------------------------------------------------

-- "!redeem <slot> cu" — where the dino comes back, when the admin lets the
-- player choose. Vietnamese and English words both work.
local WHERE_STORED = { cu = true, ["cũ"] = true, old = true, stored = true, back = true }
local WHERE_HERE   = { here = true, day = true, ["đây"] = true, current = true }

--- Where to restore: the admin setting, then (in "choice") the player's word.
local function wantsStoredSpot(where)
    local mode = Settings.read().redeemAt
    if mode == "stored" then return true end
    if mode == "choice" then return WHERE_STORED[where or ""] == true end
    return false
end

--- Start a restore. `say` as for doStore. Returns true once the slot is
--- taken out and the restore scheduled.
local function doRedeem(ctrl, steamId, slot, where, say)
    say = say or function(m) H.safeNotify(ctrl, m) end
    -- "!redeem cu" = most recent slot, at the stored spot.
    if where == nil and slot ~= nil and (WHERE_STORED[slot] or WHERE_HERE[slot]) then
        slot, where = nil, slot
    end
    local wait = cooldownLeft(steamId, Settings.read())
    if wait then
        Msg.say(say, "redeem.cooldown", "Garage cooldown: wait {seconds} s.", { seconds = wait })
        return false
    end
    slot = slot or Storage.mostRecent(steamId)
    if slot == nil then
        Msg.say(say, "redeem.empty", "Your garage is empty.")
        return false
    end
    if not Storage.isValidSlot(slot) then
        Msg.say(say, "redeem.unknownSlot", "Unknown slot.")
        return false
    end

    local state = Storage.get(steamId, slot)
    if not state then
        Msg.say(say, "redeem.slotEmpty", "Slot '{slot}' is empty or unreadable.", { slot = slot })
        return false
    end
    -- (checked again by Storage.take below; this one gives the clear message)

    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        Msg.say(say, "redeem.noDino", "Respawn first, then type !redeem.")
        return false
    end

    -- Same-species only. Cross-species restore makes the mesh disappear for
    -- anyone also running a nest-persistence mod.
    local current = speciesOf(pawn)
    if current == nil then
        Msg.say(say, "redeem.unknownSpecies", "Could not identify your current dino. Try again.")
        return false
    end
    if current ~= state.classPath then
        Msg.say(say, "redeem.wrongSpecies", "Wrong species — respawn as the one you stored.")
        return false
    end

    -- A slot is used once. Take it out NOW, before the delay: a second
    -- !redeem in the next seconds finds nothing, and the dino cannot be both
    -- in the garage and in the world. Put back if the restore fails.
    local taken, token = Storage.take(steamId, slot)
    if not taken then
        Msg.say(say, "redeem.takeFailed", "Slot '{slot}' could not be taken out ({error}).", { slot = slot, error = tostring(token) })
        return false
    end
    state = taken

    local toStored = wantsStoredSpot(where)
    if toStored and type(state.location) ~= "table" then
        -- Slots made in the admin panel (and old ones) have no stored spot.
        toStored = false
        Msg.say(say, "redeem.noStoredSpot", "Slot '{slot}' has no stored position — restoring where you stand.", { slot = slot })
    end
    if toStored then
        Msg.say(say, "redeem.restoringStored", "Restoring '{slot}' at the spot you stored it. Hold still for a few seconds.", { slot = slot })
    else
        Msg.say(say, "redeem.restoring", "Restoring '{slot}'. Hold still for a few seconds.", { slot = slot })
    end

    -- Deferred restore: the engine needs the pawn to settle after a spawn.
    H.deferWithPawn(ctrl, RESTORE_DELAY_MS, function(c, livePawn)
        -- Move first, then restore: the vitals and mutations land on the
        -- dino where it will stay.
        local moved = toStored and Restore.teleport(livePawn, state.location, state.rotation) or false
        if toStored and not moved then
            Msg.notify(c, "redeem.moveFailed", "Could not move you to the stored spot — restoring here.")
        end
        Restore.apply(livePawn, state, function(ok)
            if ok then
                lastGarageUse[steamId] = os.time()
                Msg.notify(c, "redeem.done", "Restored '{slot}'. The slot is now empty.", { slot = slot })
            else
                Storage.putBack(token)
                Msg.notify(c, "redeem.failed", "Restore did not finish. Your slot is back in the garage.")
            end
            Events.emit({
                type    = "garage_redeem",
                steamId = steamId,
                slot    = slot,
                species = state.classPath,
                growth  = state.growth,
                at      = moved and "stored" or "current",
                ok      = ok,
            })
        end)
    end, function()
        -- Left or lost the dino during the wait: nothing was restored.
        Storage.putBack(token)
        H.logError(MOD .. ": redeem of " .. steamId .. "/" .. slot .. " abandoned — slot put back")
    end)
    return true
end

--------------------------------------------------------------------------
-- Chat: the garage lives on the web now
--------------------------------------------------------------------------

H.onChat(function(ctrl, _steamId, msg)
    local cmd = H.parseCommand(msg)
    if cmd == "store" or cmd == "redeem" or cmd == "garage" then
        Msg.notify(ctrl, "garage.useWeb", "Gara giờ dùng trên trang web của server (mục Gara): cất và lấy dino ở đó.")
    end
end)

--------------------------------------------------------------------------
-- Commands from the bridge (see garage/inbox.lua): the admin "kill", and the
-- player's own store / redeem from the web garage — the same doStore /
-- doRedeem as the chat commands, so every check (countdown, cooldown, slot
-- count, species, one-use slots) applies unchanged.
--------------------------------------------------------------------------

Inbox.on("store", function(c, cmd, say)
    return doStore(c, cmd.steamId, say, cmd.id)   -- the slot is the next free number
end)
Inbox.on("redeem", function(c, cmd, say)
    return doRedeem(c, cmd.steamId, cmd.slot, cmd.where, say)
end)

-- A game-thread loop (H.every): the poll reads one small file and acts right
-- there. It used to be a LoopAsync handing each command to ExecuteInGameThread
-- — the hand-off that lost callbacks on the server (2026-09-24).
H.every(INBOX_POLL_MS, MOD .. ": inbox poll", Inbox.poll)
H.every(GUARD_EVERY_MS, MOD .. ": store guard", guardStores)
-- Prime progress an admin gives back (garage/primefix.lua).
H.every(5000, MOD .. ": prime fixes", PrimeFix.poll)

H.log(MOD .. ": loaded")
Events.emit({ type = "mod_loaded", mod = MOD })
