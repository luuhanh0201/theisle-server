--[[
    DinoGarage

    Park the dino you are playing and get it back later.

    Model is upstream's: TRANSFORM-IN-PLACE, NEVER RESPAWN-WITH-CUSTOMIZER.
    The player is never kicked and RequestRespawn is never called — it crashes
    from Lua. See docs/reference/EVRIMA_DinoStorage_Architecture.md.

        !store  [slot]   capture, then kill the dino 3s later
                         (the player then picks the SAME species at respawn)
        !redeem [slot]   restore the stored state onto the fresh juvenile
        !garage          list slots

    Admins can also remove a player's current dino from the panel; the bridge
    drops a command in Saved/inbox.json and garage/inbox.lua runs it.

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
local Storage = require("garage.storage")
local Capture = require("garage.capture")
local Restore = require("garage.restore")
local Inbox   = require("garage.inbox")
local Settings = require("garage.settings")

local MOD = "DinoGarage"

local RESTORE_DELAY_MS = 3000   -- upstream: "!redeem queues restore in 3 seconds"
local DEFAULT_SLOT     = "default"
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
-- !store
--------------------------------------------------------------------------

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

-- Stores waiting for their countdown: steamId -> { slot, address, class }.
local pendingStore = {}

local function addressOf(pawn)
    local ok, a = pcall(function() return pawn:GetAddress() end)
    return ok and a or nil
end

--- Runs when the countdown ends: capture, save, remove the dino — all in
--- this one tick, so there is no moment where both the slot and the live
--- dino exist (a player quitting in between used to keep both).
local function finishStore(c, pawn, steamId, pending)
    local slot = pending.slot
    local settings = Settings.read()
    if addressOf(pawn) ~= pending.address or speciesOf(pawn) ~= pending.class then
        H.safeNotify(c, "Store cancelled: that is not the dino you started storing.")
        return
    end
    local existing = Storage.listSlots(steamId)[slot] ~= nil
    if not existing and countSlots(steamId) >= settings.maxSlots then
        H.safeNotify(c, "Store cancelled: your garage is full (" .. settings.maxSlots .. " slots).")
        return
    end

    local state, reason = Capture.capture(pawn)
    if not state then
        H.safeNotify(c, "Store failed: " .. (reason or "unknown") .. ".")
        H.logError(MOD .. ": capture failed for " .. steamId .. ": " .. tostring(reason))
        return
    end
    local ok, err = Storage.put(steamId, slot, state)
    if not ok then
        H.safeNotify(c, "Store failed: " .. (err or "could not save") .. ".")
        return
    end
    local killed = H.isValid(pawn) and H.try(MOD .. ": SetHealth(0)", function() pawn:SetHealth(0) end)
    if not killed then
        Storage.discard(steamId, slot)
        H.safeNotify(c, "Store cancelled: your dino could not be removed, so it stays with you.")
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
    H.safeNotify(c, string.format(
        "Stored in '%s'. Respawn as the SAME species, then type !redeem %s", slot, slot))
end

local function doStore(ctrl, steamId, slot)
    if not Storage.isValidSlot(slot) then
        H.safeNotify(ctrl, "Slot names may only use letters, numbers, - and _.")
        return
    end
    if pendingStore[steamId] then
        H.safeNotify(ctrl, "A store is already counting down.")
        return
    end
    local settings = Settings.read()
    local wait = cooldownLeft(steamId, settings)
    if wait then
        H.safeNotify(ctrl, "Garage cooldown: wait " .. wait .. " s.")
        return
    end

    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        H.safeNotify(ctrl, "You need to be playing a dino to store it.")
        return
    end

    local existing = Storage.listSlots(steamId)[slot] ~= nil
    if not existing and countSlots(steamId) >= settings.maxSlots then
        H.safeNotify(ctrl, "Your garage is full (" .. settings.maxSlots .. " slots). Redeem one first.")
        return
    end

    -- Nothing is saved during the countdown: leaving the game or losing the
    -- dino before it ends simply cancels the store.
    local pending = { slot = slot, address = addressOf(pawn), class = speciesOf(pawn) }
    pendingStore[steamId] = pending
    local seconds = settings.storeCountdown
    if seconds > 0 then
        H.safeNotify(ctrl, string.format("Storing into '%s' in %d seconds — stay in the game.", slot, seconds))
        if seconds > 10 then
            H.deferWithPlayer(ctrl, (seconds - 10) * 1000, function(c)
                if pendingStore[steamId] == pending then H.safeNotify(c, "10 seconds until your dino is stored.") end
            end)
        end
    end
    H.deferWithPawn(ctrl, seconds * 1000, function(c, livePawn)
        if pendingStore[steamId] ~= pending then return end
        pendingStore[steamId] = nil
        finishStore(c, livePawn, steamId, pending)
    end, function()
        if pendingStore[steamId] == pending then pendingStore[steamId] = nil end
        H.log(MOD .. ": store for " .. steamId .. " cancelled — player or dino gone before the countdown ended")
    end)
end

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

local function doRedeem(ctrl, steamId, slot, where)
    -- "!redeem cu" = most recent slot, at the stored spot.
    if where == nil and slot ~= nil and (WHERE_STORED[slot] or WHERE_HERE[slot]) then
        slot, where = nil, slot
    end
    local wait = cooldownLeft(steamId, Settings.read())
    if wait then
        H.safeNotify(ctrl, "Garage cooldown: wait " .. wait .. " s.")
        return
    end
    slot = slot or Storage.mostRecent(steamId)
    if slot == nil then
        H.safeNotify(ctrl, "Your garage is empty.")
        return
    end
    if not Storage.isValidSlot(slot) then
        H.safeNotify(ctrl, "Unknown slot.")
        return
    end

    local state = Storage.get(steamId, slot)
    if not state then
        H.safeNotify(ctrl, "Slot '" .. slot .. "' is empty or unreadable.")
        return
    end
    -- (checked again by Storage.take below; this one gives the clear message)

    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        H.safeNotify(ctrl, "Respawn first, then type !redeem.")
        return
    end

    -- Same-species only. Cross-species restore makes the mesh disappear for
    -- anyone also running a nest-persistence mod.
    local current = speciesOf(pawn)
    if current == nil then
        H.safeNotify(ctrl, "Could not identify your current dino. Try again.")
        return
    end
    if current ~= state.classPath then
        H.safeNotify(ctrl, "Wrong species — respawn as the one you stored.")
        return
    end

    -- A slot is used once. Take it out NOW, before the delay: a second
    -- !redeem in the next seconds finds nothing, and the dino cannot be both
    -- in the garage and in the world. Put back if the restore fails.
    local taken, token = Storage.take(steamId, slot)
    if not taken then
        H.safeNotify(ctrl, "Slot '" .. slot .. "' could not be taken out (" .. tostring(token) .. ").")
        return
    end
    state = taken

    local toStored = wantsStoredSpot(where)
    if toStored and type(state.location) ~= "table" then
        -- Slots made in the admin panel (and old ones) have no stored spot.
        toStored = false
        H.safeNotify(ctrl, "Slot '" .. slot .. "' has no stored position — restoring where you stand.")
    end
    H.safeNotify(ctrl, "Restoring '" .. slot .. "'" .. (toStored and " at the spot you stored it" or "")
        .. ". Hold still for a few seconds.")

    -- Deferred restore: the engine needs the pawn to settle after a spawn.
    H.deferWithPawn(ctrl, RESTORE_DELAY_MS, function(c, livePawn)
        -- Move first, then restore: the vitals and mutations land on the
        -- dino where it will stay.
        local moved = toStored and Restore.teleport(livePawn, state.location, state.rotation) or false
        if toStored and not moved then
            H.safeNotify(c, "Could not move you to the stored spot — restoring here.")
        end
        Restore.apply(livePawn, state, function(ok)
            if ok then
                lastGarageUse[steamId] = os.time()
                H.safeNotify(c, "Restored '" .. slot .. "'. The slot is now empty.")
            else
                Storage.putBack(token)
                H.safeNotify(c, "Restore did not finish. Your slot is back in the garage.")
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
end

--------------------------------------------------------------------------
-- !garage
--------------------------------------------------------------------------

local function doList(ctrl, steamId)
    local slots = Storage.listSlots(steamId)
    local any = false

    H.safeNotify(ctrl, "Your garage:")
    for slot, meta in pairs(slots) do
        any = true
        H.safeNotify(ctrl, string.format("  %s — %s (growth %.2f)",
            slot, tostring(meta.classPath), tonumber(meta.growth) or 0))
    end
    if not any then
        H.safeNotify(ctrl, "  (empty)")
    end
end

--------------------------------------------------------------------------
-- Chat
--------------------------------------------------------------------------

H.onChat(function(ctrl, steamId, msg)
    local cmd, args = H.parseCommand(msg)
    if cmd == nil then return end

    if cmd == "store" then
        doStore(ctrl, steamId, args[1] or DEFAULT_SLOT)
    elseif cmd == "redeem" then
        doRedeem(ctrl, steamId, args[1], args[2])
    elseif cmd == "garage" then
        doList(ctrl, steamId)
    end
end)

--------------------------------------------------------------------------
-- Admin commands from the bridge (see garage/inbox.lua)
--------------------------------------------------------------------------
-- The poll only reads a small file and queues; the kill itself is handed to
-- the game thread inside Inbox.

LoopAsync(INBOX_POLL_MS, function()
    H.try(MOD .. ": inbox poll", Inbox.poll)
    return false   -- keep looping
end)

H.log(MOD .. ": loaded")
Events.emit({ type = "mod_loaded", mod = MOD })
