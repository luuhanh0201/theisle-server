--[[
    DinoGarage/settings.lua

    Admin settings written by the panel (bridge/src/garage.ts), read fresh on
    every command so a change needs no restart. A missing or broken file means
    the defaults, never an error for the player.

      { "redeemAt": "current" | "stored" | "choice", "maxSlots": 3,
        "storeCountdown": 30, "cooldown": 180,
        "tiers": { "vip": { "maxSlots": 5, "cooldown": 120 }, "svip": { "maxSlots": 0, "cooldown": 60 } },
        "members": { "<steamId>": "vip" | "svip" | "admin" } }

      current  the dino comes back where the player stands (default)
      stored   it is put back where it was stored (!store position)
      choice   the player decides: "!redeem <slot>" here, "!redeem <slot> cu" there

      maxSlots how many slots a plain player may fill with !store (admin-made
               slots count too; the admin panel itself is not limited). Default 3.
      storeCountdown  seconds between "!store" and the dino going into the
               garage (0–300, default 30). Nothing is saved until it ends.
      cooldown seconds a plain player must wait between two garage uses (!store
               or !redeem; 0–86400, default 180).
      tiers    the VIP's and the SVip's own maxSlots (0 = no limit, 0–50) and
               cooldown; an admin: no limit, no wait (owner, 2026-10-05).
      members  who is VIP / SVip / admin, written by the bridge every minute
               (bridge/src/member-tier.ts); anyone else is a plain player.
      minHealthPct  health (% of the dino's max) needed to store (0–100, default 0 = any)
      minGrowthPct  growth (%) needed to store (0–100, default 0 = any)
]]

local json = require("shared.isle.json")

local S = {}

S.PATH = "Mods/DinoGarage/Saved/garage-settings.json"
S.DEFAULTS = { redeemAt = "current", maxSlots = 3, storeCountdown = 30, cooldown = 180, minHealthPct = 0, minGrowthPct = 0 }
S.TIER_DEFAULTS = { vip = { maxSlots = 5, cooldown = 120 }, svip = { maxSlots = 0, cooldown = 60 } }
S.ADMIN = { maxSlots = 0, cooldown = 0 }
S.MAX_SLOTS_RANGE = { 1, 20 }
S.REDEEM_AT = { current = true, stored = true, choice = true }

function S.read()
    local out = {}
    for k, v in pairs(S.DEFAULTS) do out[k] = v end
    out.tiers = {}
    for t, rule in pairs(S.TIER_DEFAULTS) do out.tiers[t] = { maxSlots = rule.maxSlots, cooldown = rule.cooldown } end
    out.members = {}
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
        out.minHealthPct = whole(data.minHealthPct, 0, 100) or out.minHealthPct
        out.minGrowthPct = whole(data.minGrowthPct, 0, 100) or out.minGrowthPct
        if type(data.tiers) == "table" then
            for t, rule in pairs(out.tiers) do
                local given = data.tiers[t]
                if type(given) == "table" then
                    rule.maxSlots = whole(given.maxSlots, 0, 50) or rule.maxSlots
                    rule.cooldown = whole(given.cooldown, 0, 86400) or rule.cooldown
                end
            end
        end
        if type(data.members) == "table" then
            for id, tier in pairs(data.members) do
                if type(id) == "string" and (tier == "vip" or tier == "svip" or tier == "admin") then out.members[id] = tier end
            end
        end
    end
    return out
end

--- One player's garage: their tier, slots (nil = no limit) and wait in seconds.
function S.forPlayer(settings, steamId)
    local tier = settings.members and settings.members[tostring(steamId)] or "normal"
    local rule = tier == "admin" and S.ADMIN or (settings.tiers and settings.tiers[tier])
        or { maxSlots = settings.maxSlots, cooldown = settings.cooldown }
    return { tier = tier, maxSlots = rule.maxSlots > 0 and rule.maxSlots or nil, cooldown = rule.cooldown }
end

return S
