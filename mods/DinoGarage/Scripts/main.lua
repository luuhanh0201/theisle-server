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

local H       = require("shared.isle.helpers")
local Events  = require("shared.isle.events")
local Storage = require("garage.storage")
local Capture = require("garage.capture")
local Restore = require("garage.restore")
local Inbox   = require("garage.inbox")

local MOD = "DinoGarage"

local KILL_DELAY_MS    = 3000   -- upstream: "!store queues kill in 3 seconds"
local RESTORE_DELAY_MS = 3000   -- upstream: "!redeem queues restore in 3 seconds"
local DEFAULT_SLOT     = "default"
local MAX_SLOTS        = 5
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

local function doStore(ctrl, steamId, slot)
    if not Storage.isValidSlot(slot) then
        H.safeNotify(ctrl, "Slot names may only use letters, numbers, - and _.")
        return
    end

    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        H.safeNotify(ctrl, "You need to be playing a dino to store it.")
        return
    end

    local existing = Storage.listSlots(steamId)[slot] ~= nil
    if not existing and countSlots(steamId) >= MAX_SLOTS then
        H.safeNotify(ctrl, "Your garage is full (" .. MAX_SLOTS .. " slots).")
        return
    end

    -- Synchronous capture, deferred kill. If capture fails the dino is left
    -- completely alone — that is the whole point of doing it in this order.
    local state, reason = Capture.capture(pawn)
    if not state then
        H.safeNotify(ctrl, "Store failed: " .. (reason or "unknown") .. ".")
        H.logError(MOD .. ": capture failed for " .. steamId .. ": " .. tostring(reason))
        return
    end

    local ok, err = Storage.put(steamId, slot, state)
    if not ok then
        H.safeNotify(ctrl, "Store failed: " .. (err or "could not save") .. ".")
        return
    end

    Events.emit({
        type    = "garage_store",
        steamId = steamId,
        slot    = slot,
        species = state.classPath,
        growth  = state.growth,
    })

    H.safeNotify(ctrl, string.format(
        "Stored in '%s'. Your dino dies in 3 seconds — respawn as the SAME "
        .. "species, then type !redeem %s", slot, slot))

    -- Only now do we touch the world, and only after the slot file is on disk.
    H.deferWithPawn(ctrl, KILL_DELAY_MS, function(_c, livePawn)
        H.try(MOD .. ": SetHealth(0)", function() livePawn:SetHealth(0) end)
    end)
end

--------------------------------------------------------------------------
-- !redeem
--------------------------------------------------------------------------

local function doRedeem(ctrl, steamId, slot)
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

    H.safeNotify(ctrl, "Restoring '" .. slot .. "'. Hold still for a few seconds.")

    -- Deferred restore: the engine needs the pawn to settle after a spawn.
    H.deferWithPawn(ctrl, RESTORE_DELAY_MS, function(c, livePawn)
        Restore.apply(livePawn, state, function(ok)
            if ok then
                -- Keep the slot. A player who loses their dino to a bug right
                -- after redeeming should still have it in the garage.
                H.safeNotify(c, "Restored '" .. slot .. "'.")
            else
                H.safeNotify(c, "Restore did not finish. Your slot is untouched.")
            end
            Events.emit({
                type    = "garage_redeem",
                steamId = steamId,
                slot    = slot,
                species = state.classPath,
                growth  = state.growth,
                ok      = ok,
            })
        end)
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
        doRedeem(ctrl, steamId, args[1])
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
