--[[
    DinoGarage/settings.lua

    Admin settings written by the panel (bridge/src/garage.ts), read fresh on
    every command so a change needs no restart. A missing or broken file means
    the defaults — never an error for the player.

      { "redeemAt": "current" | "stored" | "choice", "maxSlots": 2,
        "storeCountdown": 30, "cooldown": 60 }

      current  the dino comes back where the player stands (default)
      stored   it is put back where it was stored (!store position)
      choice   the player decides: "!redeem <slot>" here, "!redeem <slot> cu" there

      maxSlots how many slots a player may fill with !store (admin-made slots
               count too; the admin panel itself is not limited). Default 2.
      storeCountdown  seconds between "!store" and the dino going into the
               garage (0–300, default 30). Nothing is saved until it ends.
      cooldown seconds a player must wait between two garage uses (!store or
               !redeem; 0–86400, default 60).
]]

local json = require("shared.isle.json")

local S = {}

S.PATH = "Mods/DinoGarage/Saved/garage-settings.json"
S.DEFAULTS = { redeemAt = "current", maxSlots = 2, storeCountdown = 30, cooldown = 60 }
S.MAX_SLOTS_RANGE = { 1, 20 }
S.REDEEM_AT = { current = true, stored = true, choice = true }

function S.read()
    local out = {}
    for k, v in pairs(S.DEFAULTS) do out[k] = v end
    local f = io.open(S.PATH, "r")
    if not f then return out end
    local raw = f:read("*a")
    f:close()
    local ok, data = pcall(json.decode, raw)
    if ok and type(data) == "table" then
        if S.REDEEM_AT[data.redeemAt] then out.redeemAt = data.redeemAt end
        local function whole(v, lo, hi)
            local n = tonumber(v)
            if n and n == math.floor(n) and n >= lo and n <= hi then return n end
            return nil
        end
        out.maxSlots = whole(data.maxSlots, S.MAX_SLOTS_RANGE[1], S.MAX_SLOTS_RANGE[2]) or out.maxSlots
        out.storeCountdown = whole(data.storeCountdown, 0, 300) or out.storeCountdown
        out.cooldown = whole(data.cooldown, 0, 86400) or out.cooldown
    end
    return out
end

return S
