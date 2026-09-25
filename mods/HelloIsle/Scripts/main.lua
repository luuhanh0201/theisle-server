--[[
    HelloIsle

    The smallest useful mod: greet players on join and answer a chat ping.
    Keep it working — it is the canary that tells you UE4SS, the shared helpers
    and the chat hook all came up correctly after a deploy.
]]

-- Resolve require("shared.isle.*") to Mods/shared/isle/ whatever UE4SS itself
-- puts on package.path. Relative to the server's working directory
-- (Binaries/Win64), like every path the mods use.
if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H = require("shared.isle.helpers")
local Msg = require("shared.isle.messages")   -- texts editable on the admin panel

local MOD = "HelloIsle"
local GREET_DELAY_MS = 5000   -- let the client finish loading before we talk

H.log(MOD .. ": loading")

--------------------------------------------------------------------------
-- Greet on join
--------------------------------------------------------------------------

RegisterHook("/Script/Engine.PlayerController:ClientRestart", function(ctrlParam)
    -- Rule 1: the hook parameter is only valid inside this call.
    local ctrl = ctrlParam:get()
    if not H.isValid(ctrl) then return end

    -- Rule 3/4: do not talk to the client from inside the hook — defer, and
    -- let deferWithPawn re-resolve the player when the timer fires.
    H.deferWithPawn(ctrl, GREET_DELAY_MS, function(c, _pawn)
        Msg.notify(c, "hello.welcome", "Welcome to the island. Type !ping to check the mods.")
    end)
end)

--------------------------------------------------------------------------
-- !ping
--------------------------------------------------------------------------
-- H.onChat handles the real hook name, the duplicate fires and the deferral.

H.onChat(function(ctrl, steamId, msg)
    local cmd = H.parseCommand(msg)
    if cmd ~= "ping" then return end

    H.log(MOD .. ": !ping from " .. steamId)
    Msg.notify(ctrl, "hello.pong", "pong — mods are alive")
end)

H.log(MOD .. ": loaded")
