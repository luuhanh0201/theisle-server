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
-- A prime asked but not prime yet when the restore ends: looked at again this much later (step 9).
local PRIME_RECHECK_MS = 5000

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

local function readNumber(pawn, getter)
    local ok, v = pcall(function() return pawn[getter](pawn) end)
    if ok and type(v) == "number" then return v end
    return nil
end

--- A stored current value for a dino whose max is now `newMax`: the same
--- share of it (capped at full) when the stored max is known, else the value
--- capped at `newMax`. nil `newMax` (unreadable): the value as stored.
function R.scaled(value, storedMax, newMax)
    if type(value) ~= "number" then return value end
    if type(newMax) ~= "number" or newMax <= 0 then return value end
    if type(storedMax) == "number" and storedMax > 0 then
        return newMax * math.max(0, math.min(value / storedMax, 1))
    end
    return math.min(value, newMax)
end

--- Apply every vital. Called twice, per rule 1.
-- The stomach and health go back as the SHARE of the max they had, on the
-- max the game gives this dino now — never the stored absolute numbers. A
-- prime's max health and stomach grow while it stays prime (×1.31 on a
-- Rex); the dino taken out is a fresh prime with the base prime max. Written
-- back as numbers, the stomach max stayed the old one until the game
-- recomputed it (a growth tick, a relog): the stomach then stood above 100 %
-- or was cut, and health above max was cut (2026-10-01).
-- `stomachRatio`: MaxHunger / MaxHealth of the species (read on the fresh
-- dino); the game's stomach at any growth, prime included.
-- @return the stomach max written (nil when it could not be worked out)
local function applyVitals(pawn, state, stomachRatio)
    local maxHealth = readNumber(pawn, "GetMaxHealth")
    local stomach = nil
    if stomachRatio ~= nil and maxHealth ~= nil and maxHealth > 0 then
        stomach = stomachRatio * maxHealth
    end
    set(pawn, "SetMaxHunger",    stomach or state.maxHunger)
    set(pawn, "SetMaxFoodValue", state.maxFoodValue)
    set(pawn, "SetMaxThirst",    state.maxThirst)
    set(pawn, "SetMaxStamina",   state.maxStamina)

    set(pawn, "SetHealth",     R.scaled(state.health, state.maxHealth, maxHealth))
    set(pawn, "SetStamina",    state.stamina)
    set(pawn, "SetHunger",     R.scaled(state.hunger, state.maxHunger, stomach))
    set(pawn, "SetThirst",     state.thirst)
    -- Blood and oxygen as shares too. Written as numbers, a slot stored with a
    -- plain max (9,350) came out prime (12,274) with blood at 9,350 = 76 %:
    -- bleeding, dark screen (Quang Tèo, 2026-10-02 20:23). Slots stored before
    -- 2026-10-02 have no maxBlood: blood's max is health's on every dino seen.
    set(pawn, "SetOxygen",     R.scaled(state.oxygen, state.maxOxygen, readNumber(pawn, "GetMaxOxygen")))
    set(pawn, "SetBlood",      R.scaled(state.blood, state.maxBlood or state.maxHealth, readNumber(pawn, "GetMaxBlood")))
    set(pawn, "SetFood",       state.food)
    set(pawn, "SetWaterLevel", state.waterLevel)
    return stomach
end

-- The game keeps "original" maxima in the dino's attribute set
-- (TIAttributeSetDinosaur: OriginalMaxHunger / OriginalMaxThirst /
-- OriginalMaxStamina, FGameplayAttributeData) and puts the maxima back to them
-- when it resets the attributes — an admin's Heal (ServerHeal) does. They are
-- set when the dino spawns: for a dino the garage grows, a hatchling's, and
-- SetGrowth does not move the stomach's (VitalLab on the test server,
-- 2026-10-02: MaxHunger and OriginalMaxHunger stay 2.0 after SetGrowth(0.78)).
-- A Triceratops taken out at 78 % went from a 5,154 stomach to 34 on an
-- admin's Heal and vomited on every bite (2026-10-01).
-- Written here to the maxima the restore leaves (written in place, as the test
-- server did: GetOriginalMaxHunger then reads the new value).
R.ORIGINALS = { { "OriginalMaxHunger", "GetMaxHunger" }, { "OriginalMaxThirst", "GetMaxThirst" }, { "OriginalMaxStamina", "GetMaxStamina" } }

--- The dino's own attribute set (its outer is the dino), or nil.
local function attributeSetOf(pawn)
    local okA, addr = pcall(function() return pawn:GetAddress() end)
    if not okA or addr == nil then return nil end
    local ok, sets = pcall(function() return FindAllOf("TIAttributeSetDinosaur") or {} end)
    for _, s in ipairs(ok and sets or {}) do
        local okO, outerAddr = pcall(function() return s:GetOuter():GetAddress() end)
        if okO and outerAddr == addr then return s end
    end
    return nil
end

--- Original* = the maxima the dino has now. Returns what was written, or nil and why.
function R.setOriginals(pawn)
    local set = attributeSetOf(pawn)
    if set == nil then return nil, "no attribute set" end
    local wrote = {}
    for _, pair in ipairs(R.ORIGINALS) do
        local field, getter = pair[1], pair[2]
        local v = readNumber(pawn, getter)
        if v ~= nil and v > 0 then
            local ok = pcall(function()
                local a = set[field]
                a.BaseValue = v
                a.CurrentValue = v
            end)
            if ok then wrote[#wrote + 1] = string.format("%s=%.1f", field, v) end
        end
    end
    return wrote
end

-- vital -> { getter, max getter, setter }, for keeping shares across a growth write.
local SHARES = {
    { "GetHealth", "GetMaxHealth", "SetHealth" }, { "GetHunger", "GetMaxHunger", "SetHunger" },
    { "GetThirst", "GetMaxThirst", "SetThirst" }, { "GetStamina", "GetMaxStamina", "SetStamina" },
    { "GetBlood", "GetMaxBlood", "SetBlood" }, { "GetOxygen", "GetMaxOxygen", "SetOxygen" },
}

-- Prime's stats on a dino the mod made prime. The game adds them when it works
-- the stats out from scratch, which SetGrowth does on a dino spawned a few
-- seconds before — and not on one older than that (a garage redeem after
-- playing the spawned dino a while, an admin's growth, a Phiếu Prime): there
-- SetGrowth scales the maxima from the growth before, and the same growth
-- again keeps the plain max (Quang Tèo's T-Rex out of the garage 2026-10-02
-- 20:14: 9,350 instead of 12,274 — light, short of health, until a relog).
-- Growth taken below the prime mark (75 %) and back makes the game add them:
-- PrimeLab on the test server (T-Rex 150 s old, prime at 0.89 and at 1.0):
-- the same growth again 9,350 -> 9,350; down to 0.88 and back, nothing; down to
-- 0.74 / 0.5 / 0.25 and back 9,350 -> 12,274, stomach 3,085 -> 4,050, the four
-- mutation slots, elder stacks and prime conditions kept. 0.5: well below the mark.
R.PRIME_DIP = 0.5

--- The growth written again on a dino that is prime now, so that it gets
--- prime's stats: once as it is (enough on a fresh dino), and when the max
--- health did not move, down to R.PRIME_DIP and back. Vitals are NOT kept
--- (rule 1): the caller puts them back.
-- @return max health before, max health after, whether the dip was needed
function R.primeGrowth(pawn, growth)
    local before = readNumber(pawn, "GetMaxHealth")
    pcall(function() pawn:SetGrowth(growth) end)
    local after = readNumber(pawn, "GetMaxHealth")
    if before == nil or after == nil or after > before or growth <= R.PRIME_DIP then return before, after, false end
    pcall(function() pawn:SetGrowth(R.PRIME_DIP) end)
    pcall(function() pawn:SetGrowth(growth) end)
    return before, readNumber(pawn, "GetMaxHealth"), true
end

--- SetGrowth(growth) on a live dino, its vitals kept as the share of their max
--- they had, the stomach max for the new max health (the species' stomach /
--- health ratio, read before — a ratio far off, as a hatchling's stomach left on
--- a grown dino, is not used) and the originals (R.setOriginals). Used for a prime
--- that turned prime only after the restore, and by an admin's growth (admin.lua).
--- `prime`: the dino is prime now and should get prime's stats (R.primeGrowth).
-- @return ok, the stomach max now, what setOriginals wrote
function R.regrowKeep(pawn, growth, prime)
    local shares = {}
    for i, v in ipairs(SHARES) do
        local cur, max = readNumber(pawn, v[1]), readNumber(pawn, v[2])
        if cur ~= nil and max ~= nil and max > 0 then shares[i] = cur / max end
    end
    local mh, mhp = readNumber(pawn, "GetMaxHunger"), readNumber(pawn, "GetMaxHealth")
    local ratio = (mh and mhp and mhp > 0) and mh / mhp or nil
    if ratio ~= nil and (ratio < 0.05 or ratio > 2) then ratio = nil end
    if prime == true then
        R.primeGrowth(pawn, growth)
    elseif not pcall(function() pawn:SetGrowth(growth) end) then
        return false
    end
    local newHealth = readNumber(pawn, "GetMaxHealth")
    if ratio ~= nil and newHealth ~= nil then set(pawn, "SetMaxHunger", ratio * newHealth) end
    for i, v in ipairs(SHARES) do
        local max = readNumber(pawn, v[2])
        if shares[i] ~= nil and max ~= nil then set(pawn, v[3], max * math.min(1, shares[i])) end
    end
    local wrote = R.setOriginals(pawn)
    return true, readNumber(pawn, "GetMaxHunger"), wrote
end

--- One line in UE4SS.log: every vital against its max, as the game has them
--- once the restore is done (a relog that went wrong can be compared to it).
local function logVitals(pawn, state)
    local parts = {}
    for _, v in ipairs({ "Health", "Hunger", "Thirst", "Stamina", "Blood", "Oxygen" }) do
        local cur, max = readNumber(pawn, "Get" .. v), readNumber(pawn, "GetMax" .. v)
        parts[#parts + 1] = string.format("%s %s/%s", v:lower(),
            cur and string.format("%.1f", cur) or "?", max and string.format("%.1f", max) or "?")
    end
    H.log(string.format("restore: vitals now — %s (stored: health %s/%s, hunger %s/%s, blood %s)",
        table.concat(parts, ", "), tostring(state.health), tostring(state.maxHealth),
        tostring(state.hunger), tostring(state.maxHunger), tostring(state.blood)))
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
    -- SetGrowth brings health and stamina to the new growth but NOT the
    -- stomach, which kept the hatchling's until the player logged in again (a
    -- Rex at 37 % with 16.5 instead of ~125: it could not eat, 2026-09-26).
    -- Stomach / max health is the species' own ratio at any growth, prime
    -- included (both grow by the same factor): read it from the fresh dino
    -- here, set the stomach from it after every growth write — for every
    -- slot, not only the admin-made ones (see applyVitals).
    local stomachRatio = nil
    do
        local mh, mhp = readNumber(pawn, "GetMaxHunger"), readNumber(pawn, "GetMaxHealth")
        if mh ~= nil and mhp ~= nil and mh > 0 and mhp > 0 then
            stomachRatio = mh / mhp
        else
            H.logError("restore: max stomach / health unreadable on the fresh dino — stored stomach max used")
        end
    end
    set(pawn, "SetGrowth", state.growth)
    applyVitals(pawn, state, stomachRatio)
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

        -- Step 5 — re-apply vitals. Rule 1: SetGrowth above wiped them. A
        -- function: a prime dino goes through it twice (step 7b).
        local function settleVitals()
            -- The stomach for this growth (see stomachRatio above).
            local stomach = applyVitals(pawn, state, stomachRatio)
            if stomach ~= nil then
                H.log(string.format("restore: stomach set to %.1f for this growth (%.3f of max health; stored max %s)",
                    stomach, stomachRatio, tostring(state.maxHunger)))
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

        end
        settleVitals()

        -- Step 6 — elder replication stacks, the lineage-tier counter.
        if state.elderStacks ~= nil and state.elderStacks > 0 then
            H.try("restore: SetElderReplicationStacks", function()
                pawn:SetElderReplicationStacks(state.elderStacks)
            end)
        end

        -- Step 7 — the prime conditions, and prime once more on top of them.
        local isPrime = false
        if state.primeData ~= nil or prime == true then
            local _, p = R.applyPrime(pawn, state.primeData, prime == true)
            isPrime = p == true
        end

        -- Step 7b — prime's own stats. The game adds them when it recomputes
        -- the dino's stats, which SetGrowth does; the growth was set before
        -- prime, so a prime dino came out with a plain one's max health (a
        -- Deinosuchus at 88 %: 8,799 instead of 10,931) until the player
        -- logged in again (2026-09-28). The same growth once more (StatLab on
        -- a test server: 8,780 -> 10,860) — on a dino spawned a while before
        -- the redeem that did nothing, so down below the prime mark and back
        -- when needed (R.primeGrowth) — then, rule 1, everything it wiped.
        if isPrime then
            local before, after, dipped = R.primeGrowth(pawn, state.growth)
            settleVitals()
            if state.elderStacks ~= nil and state.elderStacks > 0 then
                H.try("restore: SetElderReplicationStacks", function() pawn:SetElderReplicationStacks(state.elderStacks) end)
            end
            H.log(string.format("restore: prime stats — max health %s -> %s%s", tostring(before), tostring(after),
                dipped and " (growth down to " .. R.PRIME_DIP .. " and back)" or ""))
        end

        -- Step 7c — the maxima a reset (an admin's Heal) goes back to: this
        -- dino's, not the hatchling's it was spawned as.
        do
            local wrote, why = R.setOriginals(pawn)
            if wrote ~= nil then H.log("restore: originals " .. (#wrote > 0 and table.concat(wrote, ", ") or "none written"))
            else H.logError("restore: originals not written — " .. tostring(why)) end
        end

        -- Step 8 — the colours it had when stored.
        if state.skin ~= nil then
            local sk = Skin.fromCaptured(state.skin)
            if sk ~= nil then
                local wrote = Skin.apply(pawn, sk)
                H.log("restore: skin " .. tostring(wrote) .. " fields")
            end
        end

        logVitals(pawn, state)

        if onDone then onDone(true) end

        -- Step 9 — a prime the game turned prime only after step 7 (it said
        -- not yet at once): its stats were worked out as a plain dino's, and
        -- came only at the next login — max health 1,300 -> 1,800 on a
        -- Carnotaurus, 9,500 -> 13,500 on a Deinosuchus (2026-10-01; the
        -- prime event a few seconds later said prime). Once more when it is.
        if prime == true and not isPrime then
            local addr = H.isValid(pawn) and pawn:GetAddress() or nil
            H.defer(PRIME_RECHECK_MS, function()
                if addr == nil or not H.isValid(pawn) or pawn:GetAddress() ~= addr then return end
                local okP, nowPrime = pcall(function() return pawn:IsPrimeElder() end)
                if not (okP and nowPrime == true) then
                    H.log("restore: prime asked, still not prime after " .. PRIME_RECHECK_MS .. " ms — stats left as they are")
                    return
                end
                local before = readNumber(pawn, "GetMaxHealth")
                local ok, stomach = R.regrowKeep(pawn, state.growth, true)
                H.log(string.format("restore: prime came late — stats worked out again: %s, max health %s -> %s, stomach max %s",
                    ok and "ok" or "failed", tostring(before), tostring(readNumber(pawn, "GetMaxHealth")), tostring(stomach)))
            end)
        end
    end)
end

return R
