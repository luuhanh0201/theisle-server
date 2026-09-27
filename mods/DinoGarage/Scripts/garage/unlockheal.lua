--[[
    DinoGarage/unlockheal.lua

    A mutation in one of a dino's four slots but missing from its unlocked
    list (MutationsRequirementsData.UnlockRequiredMutations) is hidden and
    does nothing — "Reniculate Kidneys" (drink saltwater) on crocodiles taken
    out of the garage before the list was kept (2026-09-27/28). A slot can
    only hold a mutation the dino was given or picked, so such a mutation is
    given back its unlock here, on every player's dino, online or when they
    come back. Game thread (H.every in main.lua): reads two small structs per
    player; writes only on a mismatch, once per dino and list (never loops),
    through Restore.applyUnlocks (flag first on its first write of a run).
]]

local H       = require("shared.isle.helpers")
local Restore = require("garage.restore")

local U = {}

local SLOT_FIELDS = { "MutationSlot1", "MutationSlot2", "MutationSlot3", "MutationSlot4" }
local tried = {}   -- "<pawn address>|<names>" -> true: each fix is tried once

--- The slot mutations of this dino its unlocked list lacks.
function U.missing(pawn)
    local unlocked = H.readUnlockedMutations(pawn)
    if unlocked == nil then return {} end
    local have = {}
    for _, n in ipairs(unlocked) do have[n] = true end
    local okM, mut = pcall(function() return pawn.ReplicatedMutationsData end)
    if not okM or mut == nil then return {} end
    local out = {}
    for _, f in ipairs(SLOT_FIELDS) do
        local ok, v = pcall(function() return mut[f]:ToString() end)
        v = ok and v ~= nil and tostring(v) or ""
        if v ~= "" and v ~= "None" and not have[v] then out[#out + 1] = v end
    end
    return out
end

function U.poll()
    H.forEachPlayer(function(ctrl)
        local id = H.safeSteamId(ctrl)
        if not id then return end
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local missing = U.missing(pawn)
        if #missing == 0 then return end
        local okA, addr = pcall(function() return pawn:GetAddress() end)
        local key = (okA and tostring(addr) or "?") .. "|" .. table.concat(missing, ",")
        if tried[key] then return end
        tried[key] = true
        local added = Restore.applyUnlocks(pawn, missing)
        if added ~= nil and added > 0 then
            H.try("unlockheal: ClientUpdateMutations", function() pawn:ClientUpdateMutations() end)
            H.log(string.format("unlockheal: %s — unlocked again: %s", id, table.concat(missing, ", ")))
        end
    end)
end

return U
