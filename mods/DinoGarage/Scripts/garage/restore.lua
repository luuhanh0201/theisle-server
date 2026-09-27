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

-- Writing the prime conditions is new (2026-09-26): flag first, like the
-- other first-time engine writes. The flag is written before the first write
-- of a run and removed after it; found at load, the writes stay off.
local PRIME_FLAG = "Mods/DinoGarage/Saved/prime-write.trying"
local primeWrites = nil   -- nil = not tried this run, true = worked, false = off
do
    local f = io.open(PRIME_FLAG, "r")
    if f then
        f:close()
        primeWrites = false
        H.logError("restore: the last run stopped while writing prime conditions — they are not written. Delete "
            .. PRIME_FLAG .. " to try again.")
    end
end

-- The stored skin goes back on the dino taken out (garage/skin.lua: field by
-- field into CustomizerData — the way the web skin editor writes it, used on
-- the live server since 2026-09-27; the upstream restore predated the
-- customizer overhaul of v0.21.720 and stayed off until then).
local Skin = require("garage.skin")

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

-- The quest-unlocked mutations (MutationsRequirementsData.UnlockRequiredMutations)
-- go back before the slots: without them a quest mutation written back into
-- its slot ("Reniculate Kidneys", drink saltwater) was neither shown nor
-- working (2026-09-27). Appending to that TArray and SetMutationRequirementsData
-- were tried on a test server (MutLab, 2026-09-28); on the live server they
-- are new, so flag first like the other first-time writes.
local UNLOCK_FLAG = "Mods/DinoGarage/Saved/unlock-write.trying"
local unlockWrites = nil   -- nil = not tried this run, true = worked, false = off
do
    local f = io.open(UNLOCK_FLAG, "r")
    if f then
        f:close()
        unlockWrites = false
        H.logError("restore: the last run stopped while writing unlocked mutations — they are not written. Delete "
            .. UNLOCK_FLAG .. " to try again.")
    end
end

--- What to give back as unlocked: the stored list, plus every mutation in the
--- slots (active, Parent, Elder) — a mutation in its slot but not unlocked is
--- what the game hid and switched off. Covers the dinos stored before the
--- list was kept (2026-09-28) and the admin-made ones, which carry no list.
function R.unlocksFor(state)
    local names, seen = {}, {}
    local function add(n)
        if type(n) == "string" and n ~= "" and n ~= "None" and not seen[n] then seen[n] = true; names[#names + 1] = n end
    end
    if type(state.unlockedMutations) == "table" then for _, n in ipairs(state.unlockedMutations) do add(n) end end
    local m = type(state.mutations) == "table" and state.mutations or {}
    for _, slot in ipairs(ACTIVE_SLOTS) do add(m[slot.key]) end
    for _, slot in ipairs(INHERITED_SLOTS) do add(m[slot.key]) end
    return names
end

--- Add the stored unlocked mutations the fresh dino lacks (never removes any).
--- @return how many were added, or nil when not written
function R.applyUnlocks(pawn, names)
    if type(names) ~= "table" or #names == 0 or unlockWrites == false then return nil end
    local first = unlockWrites == nil
    if first then
        local f = io.open(UNLOCK_FLAG, "w")
        if f then f:write(tostring(os.time())); f:close() end
    end
    local added = 0
    local ok, err = pcall(function()
        local req = pawn.MutationsRequirementsData
        local arr = req.UnlockRequiredMutations
        local have = {}
        arr:ForEach(function(_, e) have[tostring(e:get():ToString())] = true end)
        for _, n in ipairs(names) do
            if type(n) == "string" and n ~= "" and n ~= "None" and not have[n] then
                arr[arr:GetArrayNum() + 1] = FName(n)
                have[n] = true
                added = added + 1
            end
        end
        if added > 0 then pawn:SetMutationRequirementsData(req) end
    end)
    if first then
        os.remove(UNLOCK_FLAG)
        unlockWrites = true
    end
    if not ok then H.logError("restore: unlocked mutations: " .. tostring(err)); return nil end
    H.log(string.format("restore: unlocked mutations +%d (%s)", added, table.concat(names, ", ")))
    return added
end

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

--- Write one FName slot. Strings crash; FName objects do not. A slot the
--- stored dino had empty is emptied: the fresh dino's own pick (a Hemomania
--- chosen in the spawn screen, the Parent slots of a nest-born dino) stayed
--- on the one taken out (3 of 61 redeems, 2026-09-28).
local function setSlot(struct, field, name)
    if name == nil or name == "" then name = "None" end
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

    -- No captured mutations at all (an unreadable struct at store time): leave the dino's own.
    if type(state.mutations) ~= "table" then return end
    for _, slot in ipairs(slots) do
        setSlot(struct, slot.field, state.mutations[slot.key])
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

    if type(state.nutrients.fields) == "table" then
        -- Captured by real field name: write every one back as it was.
        for field, v in pairs(state.nutrients.fields) do
            if type(v) == "number" or type(v) == "boolean" then
                H.try("restore: nutrient " .. field, function() struct[field] = v end)
            end
        end
    else
        -- Slots stored before 2026-09-24: the guessed names.
        for _, n in ipairs(NUTRIENTS) do
            local v = state.nutrients[n.key]
            if v ~= nil then
                H.try("restore: nutrient " .. n.field, function() struct[n.field] = v end)
            end
        end
    end

    H.try("restore: SetNutrientsStruct", function()
        pawn:SetNutrientsStruct(struct, true)
    end)
end

--- An admin-made dino's nutrients: `pct` % of the max of each. The max is
-- the stomach (GetMaxHunger at this growth): every captured dino's carb,
-- protein and lipid sat below it (live slots, 2026-09-26).
local DIET = { "CarbValue", "ProteinValue", "LipidValue" }
local function fillNutrients(pawn, pct, stomach)
    pct = tonumber(pct)
    if pct == nil or pct <= 0 then return end
    local okMax, max = true, stomach
    if max == nil then okMax, max = pcall(function() return pawn:GetMaxHunger() end) end
    if not (okMax and type(max) == "number" and max > 0) then
        H.logError("restore: GetMaxHunger unavailable — nutrients not filled")
        return
    end
    local ok, struct = pcall(function() return pawn.NutrientsStruct end)
    if not ok or struct == nil then
        H.logError("restore: NutrientsStruct unreadable — nutrients not filled")
        return
    end
    local v = max * math.min(pct, 100) / 100
    for _, field in ipairs(DIET) do
        H.try("restore: nutrient " .. field, function() struct[field] = v end)
    end
    H.try("restore: nutrient bMalnutrition", function() struct.bMalnutrition = false end)
    H.try("restore: SetNutrientsStruct", function() pawn:SetNutrientsStruct(struct, true) end)
    H.log(string.format("restore: nutrients filled to %d%% of %.0f", math.floor(pct), max))
end

-- Put the dino a little above the stored point, so terrain that streamed in
-- slightly higher does not swallow its feet.
local TELEPORT_LIFT = 30

--- Move the pawn back to where it was stored. bTeleport = true: no sweep, no
--- physics impulse; the server's move replicates to every client.
-- @return true if the engine accepted the move
function R.teleport(pawn, location, rotation)
    if not H.isValid(pawn) or type(location) ~= "table"
        or type(location.x) ~= "number" or type(location.y) ~= "number" or type(location.z) ~= "number" then
        return false
    end
    local ok, moved = H.try("restore: K2_SetActorLocation", function()
        return pawn:K2_SetActorLocation(
            { X = location.x, Y = location.y, Z = location.z + TELEPORT_LIFT }, false, {}, true)
    end)
    if ok and type(rotation) == "table" and type(rotation.yaw) == "number" then
        H.try("restore: K2_SetActorRotation", function()
            pawn:K2_SetActorRotation({ Pitch = 0, Yaw = rotation.yaw, Roll = 0 }, true)
        end)
    end
    return ok and moved ~= false
end

--- The prime conditions (EligiblePrimeElderData.bPrimeCondition1..10 and
-- bIsEligiblePrime: field writes on the pawn's own struct, like the inherited
-- mutation slots) and, for a dino that was prime, ServerSetPrimeEligible(true).
-- Logs what the game says afterwards. Returns written, isPrimeNow.
function R.applyPrime(pawn, primeData, prime)
    local wrote = 0
    if type(primeData) == "table" and primeWrites ~= false then
        local first = primeWrites == nil
        if first then
            local f = io.open(PRIME_FLAG, "w")
            if f then f:write(tostring(os.time())); f:close() end
        end
        local okD, data = pcall(function() return pawn.EligiblePrimeElderData end)
        if okD and data ~= nil then
            for i = 1, 10 do
                local v = primeData["cond" .. i]
                if type(v) == "boolean" and pcall(function() data["bPrimeCondition" .. i] = v end) then
                    wrote = wrote + 1
                end
            end
            if type(primeData.eligible) == "boolean" then
                pcall(function() data.bIsEligiblePrime = primeData.eligible end)
            end
        end
        if first then
            os.remove(PRIME_FLAG)
            primeWrites = true
        end
    end
    if prime == true then
        H.try("restore: ServerSetPrimeEligible", function() pawn:ServerSetPrimeEligible(true) end)
    end
    local okE, eligible = pcall(function() return pawn:GetIsEligiblePrimeElder() end)
    local okP, isPrime = pcall(function() return pawn:IsPrimeElder() end)
    H.log(string.format("prime: %d conditions written%s -> eligible=%s prime=%s", wrote,
        prime == true and ", prime asked" or "", okE and tostring(eligible) or "?", okP and tostring(isPrime) or "?"))
    return wrote, okP and isPrime == true
end

--- Apply a stored state to a live pawn.
-- @param onDone optional fn(ok) called once the deferred phase has run
function R.apply(pawn, state, onDone)
    if not H.isValid(pawn) then
        if onDone then onDone(false) end
        return
    end

    -- Step 1 — growth and vitals, plus prime eligibility. `isPrime` is an
    -- admin's choice (bridge); `prime` is what a stored dino was — before
    -- 2026-09-26 it was saved but never read back, and a prime came out
    -- without it.
    local prime = state.isPrime
    if prime == nil and state.prime == true then prime = true end
    -- A slot with no captured stomach (admin-made): SetGrowth brings health
    -- and stamina to the new growth but NOT the stomach, which kept the
    -- hatchling's until the player logged in again (a Rex at 37 % with 16.5
    -- instead of ~125: it could not eat, 2026-09-26). Stomach / max health is
    -- the species' own ratio at any growth: read it from the fresh dino here,
    -- set the stomach from it after the growth.
    local stomachRatio = nil
    if state.maxHunger == nil then
        local okH, mh = pcall(function() return pawn:GetMaxHunger() end)
        local okP, mhp = pcall(function() return pawn:GetMaxHealth() end)
        if okH and okP and type(mh) == "number" and type(mhp) == "number" and mh > 0 and mhp > 0 then
            stomachRatio = mh / mhp
        end
    end
    set(pawn, "SetGrowth", state.growth)
    applyVitals(pawn, state)
    if prime ~= nil then
        H.try("restore: ServerSetPrimeEligible", function()
            pawn:ServerSetPrimeEligible(prime)
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

        -- Step 2 — the unlocked quest mutations, then the active mutation
        -- slots, then the player's mutation list redrawn.
        R.applyUnlocks(pawn, R.unlocksFor(state))
        applyMutations(pawn, state, ACTIVE_SLOTS)
        H.try("restore: ClientUpdateMutations", function() pawn:ClientUpdateMutations() end)

        -- Step 5 — re-apply vitals. Rule 1: SetGrowth above wiped them.
        applyVitals(pawn, state)

        -- The stomach for this growth (see stomachRatio above).
        local stomach = nil
        if stomachRatio ~= nil then
            local okP, mhp = pcall(function() return pawn:GetMaxHealth() end)
            if okP and type(mhp) == "number" and mhp > 0 then
                stomach = stomachRatio * mhp
                set(pawn, "SetMaxHunger", stomach)
                H.log(string.format("restore: stomach set to %.1f for this growth (%.3f of max health %.0f)", stomach, stomachRatio, mhp))
            end
        end

        -- Admin-made slots carry no captured stomach: fill it to the max
        -- for this dino at this growth.
        if type(state.fill) == "table" and state.fill.stomachFull then
            local okMax, max = true, stomach
            if max == nil then okMax, max = pcall(function() return pawn:GetMaxHunger() end) end
            if okMax and type(max) == "number" and max > 0 then
                set(pawn, "SetHunger", max)
            else
                H.logError("restore: GetMaxHunger unavailable — stomach not filled")
            end
        end
        -- …and no captured nutrients either: `nutrientPct` % of each. Pushed
        -- empty, the grown dino starved of nutrients and lost a prime
        -- condition for good (a Pteranodon, 2026-09-26).
        if type(state.fill) == "table" then fillNutrients(pawn, state.fill.nutrientPct, stomach) end

        -- Step 6 — elder replication stacks, the lineage-tier counter.
        if state.elderStacks ~= nil and state.elderStacks > 0 then
            H.try("restore: SetElderReplicationStacks", function()
                pawn:SetElderReplicationStacks(state.elderStacks)
            end)
        end

        -- Step 7 — the prime conditions, and prime once more on top of them.
        if state.primeData ~= nil or prime == true then
            R.applyPrime(pawn, state.primeData, prime == true)
        end

        -- Step 8 — the colours it had when stored.
        if state.skin ~= nil then
            local sk = Skin.fromCaptured(state.skin)
            if sk ~= nil then
                local wrote = Skin.apply(pawn, sk)
                H.log("restore: skin " .. tostring(wrote) .. " fields")
            end
        end

        if onDone then onDone(true) end
    end)
end

return R
