--[[
    DinoGarage/mutation.lua

    A mutation item a player uses from their bag on the web (bridge items.ts
    → inbox "mutation" { mutation, slot, unlock } → here, on the dino they play
    now; game thread, the inbox poll). The bridge has checked the item, its
    diet against the species and the slot rules; this puts it on the dino the
    way the garage does (restore.lua): ReplicatedMutationsData.MutationSlotN =
    FName, pushed with SetReplicatedMutationsData(struct, true), then
    ClientUpdateMutations so the player's mutation screen shows it. A quest
    mutation is unlocked first (R.applyUnlocks), else the game's validation
    would take it back.

    Refused (the item stays in the bag): the dino has it already in one of
    its four slots — the bag offers the upgrade instead. In an inherited slot
    only (parent / elder) it may go in a slot too.

    M.upgrade: the dino has it already (any slot) — a mutation's strength
    follows the dino's generation (ElderReplicationStacks, đời = stacks + 1),
    one number for the whole dino, so a second copy is a rebirth's +1 đời:
    every mutation on the dino grows with it. The bridge sends the stacks it
    saw (`fromStacks`, the numbers the player confirmed) and where this
    mutation stops growing (`maxStacks`, bridge mutation-tiers.ts); refused when
    the dino's stacks are no longer those, or already at that max.
]]

local H = require("shared.isle.helpers")
local Restore = require("garage.restore")

local M = {}

local ACTIVE_FIELDS = { "MutationSlot1", "MutationSlot2", "MutationSlot3", "MutationSlot4" }
local ALL_FIELDS = {
    "MutationSlot1", "MutationSlot2", "MutationSlot3", "MutationSlot4",
    "ParentMutationSlot1", "ParentMutationSlot2", "ParentMutationSlot3", "ParentMutationSlot4",
    "ElderMutationSlot1A", "ElderMutationSlot1B", "ElderMutationSlot2A", "ElderMutationSlot2B",
    "ElderMutationSlot3A", "ElderMutationSlot3B", "ElderMutationSlot4A", "ElderMutationSlot4B",
}

local function norm(s) return (tostring(s or ""):gsub("^MUT_", ""):lower():gsub("[^%w]", "")) end

local function growthOf(pawn)
    local ok, g = pcall(function() return pawn:GetGrowth() end)
    return ok and tonumber(g) or nil
end

--- Put `name` in active slot `slot` (1–4) of a live pawn — the slot open at
--- the dino's growth (`minGrowth`, the game's own: 25 / 50 / 75 / 75 %).
-- @return ok, a line for the panel / the player, what was in that slot before
function M.apply(pawn, name, slot, unlock, minGrowth)
    slot = tonumber(slot)
    if type(name) ~= "string" or name == "" or slot == nil or slot < 1 or slot > 4 or slot ~= math.floor(slot) then
        return false, "mutation: bad arguments"
    end
    minGrowth = tonumber(minGrowth)
    if minGrowth ~= nil then
        local g = growthOf(pawn)
        if g == nil or g + 0.001 < minGrowth then
            return false, string.format("Ô %d mở từ %d%% tăng trưởng (dino đang %s) — vật phẩm vẫn còn.", slot,
                math.floor(minGrowth * 100 + 0.5), g and (math.floor(g * 100) .. "%") or "?")
        end
    end
    local ok, struct = pcall(function() return pawn.ReplicatedMutationsData end)
    if not ok or struct == nil then return false, "mutation: ReplicatedMutationsData unreadable" end
    local want = norm(name)
    for i, f in ipairs(ACTIVE_FIELDS) do
        local okF, cur = pcall(function() return struct[f]:ToString() end)
        if okF and norm(cur) == want then
            return false, "Dino đã có " .. name .. " ở ô " .. i .. " — dùng Nâng cấp (+1 đời) thay vì thêm lại."
        end
    end
    local field = "MutationSlot" .. slot
    local okP, previous = pcall(function() return struct[field]:ToString() end)
    previous = okP and previous or "?"
    if unlock == true then Restore.applyUnlocks(pawn, { name }) end
    local okW = pcall(function() struct[field] = FName(name) end)
    if not okW then return false, "mutation: write failed" end
    local okS = pcall(function() pawn:SetReplicatedMutationsData(struct, true) end)
    if not okS then return false, "mutation: SetReplicatedMutationsData failed" end
    H.try("mutation: ClientUpdateMutations", function() pawn:ClientUpdateMutations() end)
    -- Read back: the game keeps it?
    local okR, now = pcall(function() return pawn.ReplicatedMutationsData[field]:ToString() end)
    if not okR or norm(now) ~= want then
        return false, "mutation: the game did not keep it (slot " .. slot .. " reads " .. tostring(now) .. ")"
    end
    local was = (previous == "None" or previous == "" or previous == "?") and "ô trống" or ("thay " .. previous)
    return true, string.format("Đã thêm mutation %s vào ô %d (%s).", name, slot, was), previous
end

--- Phiếu bỏ mutation: active slot `slot` emptied.
-- @return ok, a line, what was there
function M.clear(pawn, slot)
    slot = tonumber(slot)
    if slot == nil or slot < 1 or slot > 4 or slot ~= math.floor(slot) then return false, "mutation: bad arguments" end
    local ok, struct = pcall(function() return pawn.ReplicatedMutationsData end)
    if not ok or struct == nil then return false, "mutation: ReplicatedMutationsData unreadable" end
    local field = "MutationSlot" .. slot
    local okP, previous = pcall(function() return struct[field]:ToString() end)
    if not okP or previous == nil or previous == "" or previous == "None" then return false, "Ô " .. slot .. " đang trống — vật phẩm vẫn còn." end
    if not pcall(function() struct[field] = FName("None") end) then return false, "mutation: write failed" end
    if not pcall(function() pawn:SetReplicatedMutationsData(struct, true) end) then return false, "mutation: SetReplicatedMutationsData failed" end
    H.try("mutation: ClientUpdateMutations", function() pawn:ClientUpdateMutations() end)
    return true, string.format("Đã bỏ %s khỏi ô %d — chọn lại trong game khi đủ tăng trưởng.", previous, slot), previous
end

--- The dino has `name` already: +1 đời (ElderReplicationStacks) from `fromStacks`, below `maxStacks`.
-- @return ok, a line for the panel / the player, the stacks before, after
function M.upgrade(pawn, name, fromStacks, maxStacks)
    fromStacks, maxStacks = tonumber(fromStacks), tonumber(maxStacks)
    if type(name) ~= "string" or name == "" or fromStacks == nil or maxStacks == nil then
        return false, "mutation: bad arguments"
    end
    local ok, struct = pcall(function() return pawn.ReplicatedMutationsData end)
    if not ok or struct == nil then return false, "mutation: ReplicatedMutationsData unreadable" end
    local want, has = norm(name), false
    for _, f in ipairs(ALL_FIELDS) do
        local okF, cur = pcall(function() return struct[f]:ToString() end)
        if okF and norm(cur) == want then has = true; break end
    end
    if not has then return false, "Dino chưa có " .. name .. ": chọn ô để thêm thay vì nâng cấp." end
    local okS, stacks = pcall(function() return pawn:GetElderReplicationStacks() end)
    stacks = okS and tonumber(stacks) or nil
    if stacks == nil then return false, "mutation: ElderReplicationStacks unreadable" end
    if stacks >= maxStacks then
        return false, string.format("%s đã max chỉ số (dino đang ở đời %d).", name, stacks + 1), stacks, stacks
    end
    if stacks ~= fromStacks then
        return false, string.format("Đời của dino vừa đổi (đời %d) — mở lại túi đồ để xem chỉ số mới.", stacks + 1), stacks, stacks
    end
    local okW = pcall(function() pawn:SetElderReplicationStacks(stacks + 1) end)
    if not okW then return false, "mutation: SetElderReplicationStacks failed" end
    local okR, now = pcall(function() return pawn:GetElderReplicationStacks() end)
    now = okR and tonumber(now) or nil
    if now ~= stacks + 1 then
        return false, "mutation: the game did not keep the new generation (reads " .. tostring(now) .. ")", stacks, now
    end
    return true, string.format("Đã nâng cấp %s: dino lên đời %d (từ đời %d) — mọi mutation trên con cùng mạnh hơn.",
        name, now + 1, stacks + 1), stacks, now
end

return M
