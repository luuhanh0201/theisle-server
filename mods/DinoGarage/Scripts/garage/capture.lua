--[[
    DinoGarage/capture.lua

    Reads a live pawn into the flat table that storage.lua persists.

    Capture is SYNCHRONOUS and read-only — upstream's "synchronous capture,
    deferred restore". Nothing here mutates the pawn, so a failure costs the
    player a store, never their dino.

    Field names are not documented anywhere. Every read goes through
    H.readField with a candidate list; a miss logs once and stores null rather
    than guessing. Verify them with UE4SS Live View and trim the lists.
]]

local H = require("shared.isle.helpers")

local C = {}

-- Candidate property names, best guess first.
local F = {
    health       = { "Health", "CurrentHealth" },
    stamina      = { "Stamina", "CurrentStamina" },
    hunger       = { "Hunger", "CurrentHunger" },
    thirst       = { "Thirst", "CurrentThirst" },
    oxygen       = { "Oxygen", "CurrentOxygen" },
    blood        = { "Blood", "CurrentBlood" },
    lockedDamage = { "LockedDamage" },
    food         = { "Food", "FoodValue" },
    waterLevel   = { "WaterLevel" },
    rottenValue  = { "RottenValue" },

    maxHunger    = { "MaxHunger" },
    maxFoodValue = { "MaxFoodValue" },
    maxThirst    = { "MaxThirst" },
    maxStamina   = { "MaxStamina" },

    growth       = { "Growth", "GrowthPercent" },
    isFemale     = { "bIsFemale", "IsFemale" },
}

local NUTRIENT_FIELDS = {
    "CarbValue", "ProteinValue", "LipidValue", "BonesValue", "CannibalValue",
    "MagyValue", "RottenFleshValue", "MushroomsValue", "bMalnutrition",
}

-- Active slots have UFunction-free field names on ReplicatedMutationsData;
-- the inherited ones are the 12 Parent/Elder fields.
local ACTIVE_SLOTS = {
    Slot1 = "MutationSlot1", Slot2 = "MutationSlot2",
    Slot3 = "MutationSlot3", Slot4 = "MutationSlot4",
}

local INHERITED_SLOTS = {
    ParentSlot1 = "ParentMutationSlot1", ParentSlot2 = "ParentMutationSlot2",
    ParentSlot3 = "ParentMutationSlot3", ParentSlot4 = "ParentMutationSlot4",
    ElderSlot1A = "ElderMutationSlot1A", ElderSlot1B = "ElderMutationSlot1B",
    ElderSlot2A = "ElderMutationSlot2A", ElderSlot2B = "ElderMutationSlot2B",
    ElderSlot3A = "ElderMutationSlot3A", ElderSlot3B = "ElderMutationSlot3B",
    ElderSlot4A = "ElderMutationSlot4A", ElderSlot4B = "ElderMutationSlot4B",
}

local function num(pawn, key)
    return tonumber(H.readField(pawn, F[key], key))
end

--- FName field as a plain string, or nil when empty/None.
local function fnameOf(struct, field)
    local ok, v = pcall(function() return struct[field]:ToString() end)
    if not ok or v == nil or v == "" or v == "None" then return nil end
    return tostring(v)
end

local function captureMutations(pawn)
    local ok, struct = pcall(function() return pawn.ReplicatedMutationsData end)
    if not ok or struct == nil then
        H.logError("capture: ReplicatedMutationsData unreadable — mutations not stored")
        return {}
    end

    local out = {}
    for key, field in pairs(ACTIVE_SLOTS)    do out[key] = fnameOf(struct, field) end
    for key, field in pairs(INHERITED_SLOTS) do out[key] = fnameOf(struct, field) end
    return out
end

local function captureNutrients(pawn)
    local ok, struct = pcall(function() return pawn.NutrientsStruct end)
    if not ok or struct == nil then
        H.logError("capture: NutrientsStruct unreadable — nutrients not stored")
        return {}
    end

    local out = {}
    for _, field in ipairs(NUTRIENT_FIELDS) do
        local got, v = pcall(function() return struct[field] end)
        -- Schema keys are lowerCamel; struct fields are UpperCamel.
        local key = field:sub(1, 1):lower() .. field:sub(2)
        if got then out[key] = v end
    end
    return out
end

local function captureTransform(pawn)
    local okL, loc = pcall(function() return pawn:K2_GetActorLocation() end)
    local okR, rot = pcall(function() return pawn:K2_GetActorRotation() end)

    local location, rotation
    if okL and loc ~= nil then
        location = { x = loc.X, y = loc.Y, z = loc.Z }
    end
    if okR and rot ~= nil then
        rotation = { pitch = rot.Pitch, yaw = rot.Yaw, roll = rot.Roll }
    end
    return location, rotation
end

--- Read everything restorable off a live pawn. Never raises.
-- @return table on success, nil + reason on failure
function C.capture(pawn)
    if not H.isValid(pawn) then return nil, "your dino is not available right now" end

    local okClass, classPath = pcall(function()
        return pawn:GetClass():GetFullName()
    end)
    if not okClass or classPath == nil then
        return nil, "could not identify your species"
    end

    local state = {
        classPath = tostring(classPath),

        health = num(pawn, "health"),  stamina    = num(pawn, "stamina"),
        hunger = num(pawn, "hunger"),  thirst     = num(pawn, "thirst"),
        oxygen = num(pawn, "oxygen"),  blood      = num(pawn, "blood"),
        food   = num(pawn, "food"),    waterLevel = num(pawn, "waterLevel"),
        lockedDamage = num(pawn, "lockedDamage"),
        rottenValue  = num(pawn, "rottenValue"),

        maxHunger    = num(pawn, "maxHunger"),
        maxFoodValue = num(pawn, "maxFoodValue"),
        maxThirst    = num(pawn, "maxThirst"),
        maxStamina   = num(pawn, "maxStamina"),

        growth   = num(pawn, "growth"),
        isFemale = H.readField(pawn, F.isFemale, "isFemale") == true,

        mutations = captureMutations(pawn),
        nutrients = captureNutrients(pawn),
    }

    -- Clean native int32 in/out, safe from Lua (upstream v019 fix).
    local okElder, stacks = pcall(function()
        return pawn:GetElderReplicationStacks()
    end)
    state.elderStacks = okElder and tonumber(stacks) or nil

    state.location, state.rotation = captureTransform(pawn)

    -- Refuse to store a snapshot we cannot put back. Growth drives the whole
    -- restore order; without it the dino would come back as a juvenile.
    if state.growth == nil then
        return nil, "could not read your growth — nothing was stored"
    end

    return state
end

return C
