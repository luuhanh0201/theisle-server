--[[
    DinoGarage/restore.lua

    Applies a stored state to a live pawn, in the exact order given by
    docs/reference/EVRIMA_State_Restore_Cookbook.md.

    Two rules drive everything here:

      1. Every SetGrowth call WIPES vitals — it recomputes max-stats and refills
         current to the new max. So vitals are applied twice: once in the first
         pass, and again after the last growth write. Step 5 is not redundant.

      2. Field-writes take FName OBJECTS, never Lua strings.
         "Lua-string field-writes crash at 0x70; FName(s) field-writes work."
         That is a hard crash, so every write is wrapped even so.

    Do not reorder the steps. Do not call RequestRespawn — it crashes from Lua
    because of its FCustomizerDataBase by-value parameter.
]]

local H = require("shared.isle.helpers")

local R = {}

local FIELD_WRITE_DELAY_MS = 500   -- the settle window; required, not a guess

-- Skin restore in upstream predates the customizer overhaul in v0.21.720 and
-- is flagged there as needing re-verification. Off until someone verifies it
-- on this server: a wrong colour is cosmetic, a crash is not.
R.APPLY_SKIN = false

local ACTIVE_SLOTS = {
    { key = "Slot1", field = "MutationSlot1" },
    { key = "Slot2", field = "MutationSlot2" },
    { key = "Slot3", field = "MutationSlot3" },
    { key = "Slot4", field = "MutationSlot4" },
}

local INHERITED_SLOTS = {
    { key = "ParentSlot1", field = "ParentMutationSlot1" },
    { key = "ParentSlot2", field = "ParentMutationSlot2" },
    { key = "ParentSlot3", field = "ParentMutationSlot3" },
    { key = "ParentSlot4", field = "ParentMutationSlot4" },
    { key = "ElderSlot1A", field = "ElderMutationSlot1A" },
    { key = "ElderSlot1B", field = "ElderMutationSlot1B" },
    { key = "ElderSlot2A", field = "ElderMutationSlot2A" },
    { key = "ElderSlot2B", field = "ElderMutationSlot2B" },
    { key = "ElderSlot3A", field = "ElderMutationSlot3A" },
    { key = "ElderSlot3B", field = "ElderMutationSlot3B" },
    { key = "ElderSlot4A", field = "ElderMutationSlot4A" },
    { key = "ElderSlot4B", field = "ElderMutationSlot4B" },
}

local NUTRIENTS = {
    { key = "carbValue",        field = "CarbValue" },
    { key = "proteinValue",     field = "ProteinValue" },
    { key = "lipidValue",       field = "LipidValue" },
    { key = "bonesValue",       field = "BonesValue" },
    { key = "cannibalValue",    field = "CannibalValue" },
    { key = "magyValue",        field = "MagyValue" },
    { key = "rottenFleshValue", field = "RottenFleshValue" },
    { key = "mushroomsValue",   field = "MushroomsValue" },
    { key = "bMalnutrition",    field = "bMalnutrition" },
}

--- Call a setter if the value is present. Missing values are skipped, not
--- zeroed — writing 0 where we failed to capture would starve the dino.
local function set(pawn, method, value)
    if value == nil then return end
    H.try("restore: " .. method, function() pawn[method](pawn, value) end)
end

--- Apply every vital. Called twice, per rule 1.
local function applyVitals(pawn, state)
    set(pawn, "SetMaxHunger",    state.maxHunger)
    set(pawn, "SetMaxFoodValue", state.maxFoodValue)
    set(pawn, "SetMaxThirst",    state.maxThirst)
    set(pawn, "SetMaxStamina",   state.maxStamina)

    set(pawn, "SetHealth",     state.health)
    set(pawn, "SetStamina",    state.stamina)
    set(pawn, "SetHunger",     state.hunger)
    set(pawn, "SetThirst",     state.thirst)
    set(pawn, "SetOxygen",     state.oxygen)
    set(pawn, "SetBlood",      state.blood)
    set(pawn, "SetFood",       state.food)
    set(pawn, "SetWaterLevel", state.waterLevel)
end

--- Write one FName slot. Strings crash; FName objects do not.
local function setSlot(struct, field, name)
    if name == nil or name == "" or name == "None" then return end
    H.try("restore: field-write " .. field, function()
        struct[field] = FName(name)
    end)
end

local function applyMutations(pawn, state, slots)
    local ok, struct = pcall(function() return pawn.ReplicatedMutationsData end)
    if not ok or struct == nil then
        H.logError("restore: ReplicatedMutationsData unreadable — mutations skipped")
        return
    end

    for _, slot in ipairs(slots) do
        setSlot(struct, slot.field, state.mutations and state.mutations[slot.key])
    end

    -- Pushing with true bypasses the batching limit, the validation gate and
    -- the settle-window requirement (upstream v021 fix).
    H.try("restore: SetReplicatedMutationsData", function()
        pawn:SetReplicatedMutationsData(struct, true)
    end)
end

local function applyNutrients(pawn, state)
    if state.nutrients == nil then return end

    local ok, struct = pcall(function() return pawn.NutrientsStruct end)
    if not ok or struct == nil then
        H.logError("restore: NutrientsStruct unreadable — nutrients skipped")
        return
    end

    for _, n in ipairs(NUTRIENTS) do
        local v = state.nutrients[n.key]
        if v ~= nil then
            H.try("restore: nutrient " .. n.field, function() struct[n.field] = v end)
        end
    end

    H.try("restore: SetNutrientsStruct", function()
        pawn:SetNutrientsStruct(struct, true)
    end)
end

--- Apply a stored state to a live pawn.
-- @param onDone optional fn(ok) called once the deferred phase has run
function R.apply(pawn, state, onDone)
    if not H.isValid(pawn) then
        if onDone then onDone(false) end
        return
    end

    -- Step 1 — growth and vitals, plus prime eligibility.
    set(pawn, "SetGrowth", state.growth)
    applyVitals(pawn, state)
    if state.isPrime ~= nil then
        H.try("restore: ServerSetPrimeEligible", function()
            pawn:ServerSetPrimeEligible(state.isPrime)
        end)
    end

    -- Step 3 — inherited slots. Field-write only; no UFunction setters exist.
    applyMutations(pawn, state, INHERITED_SLOTS)

    -- Step 4 — nutrients.
    applyNutrients(pawn, state)

    -- Steps 2, 5 and 6 need the settle window. Anything written before it has
    -- elapsed is silently rejected by the quest-mutation validation gate.
    H.defer(FIELD_WRITE_DELAY_MS, function()
        -- The player may have disconnected during the wait.
        if not H.isValid(pawn) then
            H.logError("restore: pawn went away during the settle window")
            if onDone then onDone(false) end
            return
        end

        -- Step 2 — active mutation slots.
        applyMutations(pawn, state, ACTIVE_SLOTS)

        -- Step 5 — re-apply vitals. Rule 1: SetGrowth above wiped them.
        applyVitals(pawn, state)

        -- Step 6 — elder replication stacks, the lineage-tier counter.
        if state.elderStacks ~= nil and state.elderStacks > 0 then
            H.try("restore: SetElderReplicationStacks", function()
                pawn:SetElderReplicationStacks(state.elderStacks)
            end)
        end

        if R.APPLY_SKIN and state.skin ~= nil then
            H.logError("restore: skin apply is enabled but not implemented — "
                .. "verify against v0.21.720 customizer changes first")
        end

        if onDone then onDone(true) end
    end)
end

return R
