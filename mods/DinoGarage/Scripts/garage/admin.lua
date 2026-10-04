--[[
    DinoGarage/admin.lua

    What an admin does in the game's /adminpanel, from the web panel instead
    (bridge → inbox "admin" { action, … } → here, on the dino the player plays
    now; game thread, the inbox poll):

      heal      health, blood, stamina, oxygen full; fractures (legs, body,
                head), sickness (vomit) and venom cleared — the fracture /
                sick / venom calls tried on the test server (VitalLab,
                2026-10-02)
      vitals    { values = { health, hunger, thirst, stamina, blood, oxygen,
                carb, protein, lipid = 0–1 } }: each a share of its max
                (nutrients: of the stomach, as the garage fills them)
      grow      { growth = 0.1–1, prime? }: SetGrowth with the vitals kept as the same
                shares, the stomach max for the new growth (the species'
                ratio) and the originals an admin's Heal resets to
                (restore.lua R.setOriginals)
      teleport  { x, y, z }: the bridge picks a spot something really stood on

    And for the bag's items (main.lua inbox "mutation"): A.feed — the food
    bar up by a share of its max, nutrients left as they are (Hộp food).

    Returns ok, a line for the panel, a few words for the player.
]]

local H = require("shared.isle.helpers")
local Restore = require("garage.restore")

local A = {}

-- vital -> { getter, max getter, setter }
local VITALS = {
    health  = { "GetHealth", "GetMaxHealth", "SetHealth" },
    hunger  = { "GetHunger", "GetMaxHunger", "SetHunger" },
    thirst  = { "GetThirst", "GetMaxThirst", "SetThirst" },
    stamina = { "GetStamina", "GetMaxStamina", "SetStamina" },
    blood   = { "GetBlood", "GetMaxBlood", "SetBlood" },
    oxygen  = { "GetOxygen", "GetMaxOxygen", "SetOxygen" },
}
local ORDER = { "health", "hunger", "thirst", "stamina", "blood", "oxygen" }
local NUTRIENTS = { carb = "CarbValue", protein = "ProteinValue", lipid = "LipidValue" }

local function num(pawn, fn)
    local ok, v = pcall(function() return pawn[fn](pawn) end)
    return ok and type(v) == "number" and v or nil
end

--- How full one vital is (0–1), or nil.
local function share(pawn, k)
    local v = VITALS[k]
    local cur, max = num(pawn, v[1]), num(pawn, v[2])
    if cur == nil or max == nil or max <= 0 then return nil end
    return cur / max
end

--- One vital to a share of its max. True when written.
local function setShare(pawn, k, s)
    local v = VITALS[k]
    local max = num(pawn, v[2])
    if max == nil or max <= 0 then return false end
    return pcall(function() pawn[v[3]](pawn, max * math.max(0, math.min(1, s))) end)
end

local function unit(x) x = tonumber(x); return x ~= nil and x == x and x >= 0 and x <= 1 and x or nil end

function A.heal(pawn)
    local done = {}
    for _, k in ipairs({ "health", "blood", "stamina", "oxygen" }) do
        if setShare(pawn, k, 1) then done[#done + 1] = k end
    end
    for _, fn in ipairs({ "SetAreLegsFractured", "SetIsBodyFractured", "SetIsHeadFractured" }) do
        if pcall(function() pawn[fn](pawn, false) end) then done[#done + 1] = fn end
    end
    for _, fn in ipairs({ "ResetVomitSickState", "ResetVenomStatus" }) do
        if pcall(function() pawn[fn](pawn) end) then done[#done + 1] = fn end
    end
    return #done > 0, "heal: " .. table.concat(done, ", "), "hồi máu và chữa trị"
end

function A.vitals(pawn, values)
    if type(values) ~= "table" then return false, "vitals: nothing to set" end
    local done = {}
    for _, k in ipairs(ORDER) do
        local s = unit(values[k])
        if s ~= nil and setShare(pawn, k, s) then done[#done + 1] = string.format("%s %d%%", k, math.floor(s * 100 + 0.5)) end
    end
    local wantNutrients = false
    for k in pairs(NUTRIENTS) do if unit(values[k]) ~= nil then wantNutrients = true end end
    if wantNutrients then
        local stomach = num(pawn, "GetMaxHunger")
        local okS, struct = pcall(function() return pawn.NutrientsStruct end)
        if stomach and stomach > 0 and okS and struct ~= nil then
            for k, field in pairs(NUTRIENTS) do
                local s = unit(values[k])
                if s ~= nil and pcall(function() struct[field] = stomach * s end) then
                    done[#done + 1] = string.format("%s %d%%", k, math.floor(s * 100 + 0.5))
                end
            end
            pcall(function() struct.bMalnutrition = false end)
            H.try("admin: SetNutrientsStruct", function() pawn:SetNutrientsStruct(struct, true) end)
        end
    end
    if #done == 0 then return false, "vitals: nothing set" end
    return true, "vitals: " .. table.concat(done, ", "), "chỉnh chỉ số"
end

-- Prime: the ten conditions done + ServerSetPrimeEligible, as the garage
-- restores a prime (restore.lua R.applyPrime); the game adds prime's stats only
-- when it works them out again, so a few seconds later, once IsPrimeElder says
-- so, the growth is set again (as the garage's step 9) — down below the prime
-- mark and back when the same growth does not add them (restore.lua R.primeGrowth:
-- a dino older than a few seconds; before, a Phiếu Prime gave prime's stats only
-- at the next relog).
local PRIME_ALL = { eligible = true }
for i = 1, 10 do PRIME_ALL["cond" .. i] = true end
local PRIME_RECHECK_MS = 5000

function A.grow(pawn, growth, prime)
    local g = tonumber(growth)
    if g == nil or g < 0.1 or g > 1 then return false, "grow: growth must be 0.1–1" end
    if prime == true and g < 1 then return false, "grow: prime needs growth 1" end
    -- Vitals kept as shares, the stomach max and the originals for the new growth (restore.lua).
    local ok, stomach, wrote = Restore.regrowKeep(pawn, g)
    if not ok then return false, "grow: SetGrowth failed" end
    if prime == true then
        local _, isPrime = Restore.applyPrime(pawn, PRIME_ALL, true)
        local addr = pawn:GetAddress()
        H.defer(PRIME_RECHECK_MS, function()
            if not H.isValid(pawn) or pawn:GetAddress() ~= addr then return end
            local okP, nowPrime = pcall(function() return pawn:IsPrimeElder() end)
            if not (okP and nowPrime == true) then H.log("admin: prime asked, still not prime after " .. PRIME_RECHECK_MS .. " ms"); return end
            local before = num(pawn, "GetMaxHealth")
            Restore.regrowKeep(pawn, 1, true)
            H.log(string.format("admin: prime — stats worked out again, max health %s -> %s", tostring(before), tostring(num(pawn, "GetMaxHealth"))))
        end)
        return true, string.format("grow: 100%%, prime asked (prime now: %s; stats again in %d s)", tostring(isPrime), PRIME_RECHECK_MS / 1000),
            "đặt tăng trưởng 100% và prime"
    end
    return true, string.format("grow: %d%%, stomach max %s, originals %s", math.floor(g * 100 + 0.5),
        tostring(stomach), wrote and table.concat(wrote, " ") or "not written"),
        string.format("đặt tăng trưởng %d%%", math.floor(g * 100 + 0.5))
end

--- Hộp food: the food bar (hunger) +amount of its max, at most full; the nutrients are not touched.
--- Returns ok, a line for the log, the share before and after (0–1).
function A.feed(pawn, amount)
    local a = unit(amount)
    if a == nil or a <= 0 then return false, "feed: amount must be 0–1" end
    local before = share(pawn, "hunger")
    if before == nil then return false, "feed: food bar unreadable" end
    if before >= 0.995 then return false, "full", before, before end
    local after = math.min(1, before + a)
    if not setShare(pawn, "hunger", after) then return false, "feed: SetHunger failed", before, before end
    return true, string.format("feed: food %d%% -> %d%%", math.floor(before * 100 + 0.5), math.floor(after * 100 + 0.5)), before, after
end

function A.teleport(pawn, x, y, z)
    x, y, z = tonumber(x), tonumber(y), tonumber(z)
    if not (x and y and z) then return false, "teleport: x, y, z required" end
    local ok = Restore.teleport(pawn, { x = x, y = y, z = z })
    return ok, string.format("teleport: %s to %d, %d, %d", ok and "moved" or "failed", math.floor(x), math.floor(y), math.floor(z)), "dịch chuyển"
end

--- Test (2026-10-02): mutation names into any of the 16 slots ({ field = name | json null }),
-- the maxima read before and after — does where a mutation sits change its strength?
-- Not on the panel; an admin script sends it.
local MUT_FIELDS = {}
for _, f in ipairs({ "MutationSlot1", "MutationSlot2", "MutationSlot3", "MutationSlot4",
    "ParentMutationSlot1", "ParentMutationSlot2", "ParentMutationSlot3", "ParentMutationSlot4",
    "ElderMutationSlot1A", "ElderMutationSlot1B", "ElderMutationSlot2A", "ElderMutationSlot2B",
    "ElderMutationSlot3A", "ElderMutationSlot3B", "ElderMutationSlot4A", "ElderMutationSlot4B" }) do MUT_FIELDS[f] = true end
local MAXIMA = { "GetMaxHealth", "GetMaxStamina", "GetMaxOxygen", "GetMaxHunger", "GetMaxThirst", "GetMaxBlood" }
local function maxima(pawn)
    local parts = {}
    for _, fn in ipairs(MAXIMA) do
        local v = num(pawn, fn)
        parts[#parts + 1] = fn:sub(7) .. " " .. (v and string.format("%.1f", v) or "?")
    end
    parts[#parts + 1] = "stacks " .. tostring(num(pawn, "GetElderReplicationStacks"))
    return table.concat(parts, ", ")
end
function A.mutslots(pawn, slots)
    if type(slots) ~= "table" then return false, "mutslots: nothing to set" end
    local before = maxima(pawn)
    local okS, struct = pcall(function() return pawn.ReplicatedMutationsData end)
    if not okS or struct == nil then return false, "mutslots: ReplicatedMutationsData unreadable" end
    local done = {}
    for field, name in pairs(slots) do
        if MUT_FIELDS[field] then
            local value = (type(name) == "string" and name ~= "") and name or "None"
            if pcall(function() struct[field] = FName(value) end) then done[#done + 1] = field .. "=" .. value end
        end
    end
    if #done == 0 then return false, "mutslots: no slot written" end
    local okW = pcall(function() pawn:SetReplicatedMutationsData(struct, true) end)
    if not okW then return false, "mutslots: SetReplicatedMutationsData failed" end
    H.try("admin: ClientUpdateMutations", function() pawn:ClientUpdateMutations() end)
    table.sort(done)
    return true, "mutslots: " .. table.concat(done, " ") .. " | before: " .. before .. " | after: " .. maxima(pawn)
end

--- Read only (2026-10-02): a dark screen after a relog with nothing wrong in the
-- vitals. Every SCALAR property of the pawn and of its attribute set whose name
-- looks like a state (sick, venom, bleeding, prime…), and the nutrients — read
-- while the screen is dark and while it is not, the difference names the cause.
-- Scalars only (lua-safety-rules §2); class metadata walked, no value but scalars read.
local PROBE_WORDS = { "Vomit", "Sick", "Venom", "Poison", "Toxic", "Bleed", "Malnutri", "Fracture", "Broken", "Disease",
    "Infect", "Dark", "Vignette", "Blind", "Exhaust", "Starv", "Dehydrat", "Drown", "Wet", "Cold", "Heat", "Temperat",
    "Stun", "Limp", "Injur", "Elder", "Prime", "Overfe", "Overeat", "Stomach", "Hunger", "Thirst", "Sleep", "Rest",
    "Panic", "Fear", "Stress", "Status", "Effect", "Glass", "Sanct", "Mud", "Scent", "Hidden", "Debuff", "Buff" }
local PROBE_SCALAR = { BoolProperty = true, IntProperty = true, FloatProperty = true, DoubleProperty = true,
    ByteProperty = true, EnumProperty = true }
local function probeObject(obj, out, label)
    pcall(function()
        local cls = obj:GetClass()
        local depth = 0
        while cls ~= nil and depth < 10 do
            local cname = cls:GetFName():ToString()
            if cname == "Actor" or cname == "Pawn" or cname == "Character" or cname == "Object" then break end
            cls:ForEachProperty(function(prop)
                local pname = prop:GetFName():ToString()
                local ptype = prop:GetClass():GetFName():ToString()
                if not PROBE_SCALAR[ptype] then return end
                for _, w in ipairs(PROBE_WORDS) do
                    if pname:find(w, 1, true) then
                        local okV, v = pcall(function() return obj[pname] end)
                        if okV and v ~= nil then out[#out + 1] = label .. pname .. "=" .. tostring(v) end
                        return
                    end
                end
            end)
            local okS, super = pcall(function() return cls:GetSuperStruct() end)
            cls = okS and super or nil
            depth = depth + 1
        end
    end)
end
function A.probe(pawn)
    local out = {}
    probeObject(pawn, out, "")
    local addr = pawn:GetAddress()
    local okA, sets = pcall(function() return FindAllOf("TIAttributeSetDinosaur") or {} end)
    for _, set in ipairs(okA and sets or {}) do
        local okO, outer = pcall(function() return set:GetOuter():GetAddress() end)
        if okO and outer == addr then probeObject(set, out, "attr.") end
    end
    pcall(function()
        local n = pawn.NutrientsStruct
        out[#out + 1] = string.format("nutrients carb=%.1f protein=%.1f lipid=%.1f mal=%s", n.CarbValue, n.ProteinValue, n.LipidValue, tostring(n.bMalnutrition))
    end)
    table.sort(out)
    H.log("admin: probe " .. #out .. " values: " .. table.concat(out, " | "))
    return true, "probe: " .. table.concat(out, " | ")
end

--- One inbox command { action, values?, growth?, x?, y?, z?, slots? } on a live pawn.
function A.run(pawn, cmd)
    local a = cmd.action
    if a == "heal" then return A.heal(pawn) end
    if a == "vitals" then return A.vitals(pawn, cmd.values) end
    if a == "grow" then return A.grow(pawn, cmd.growth, cmd.prime) end
    if a == "teleport" then return A.teleport(pawn, cmd.x, cmd.y, cmd.z) end
    if a == "mutslots" then return A.mutslots(pawn, cmd.slots) end
    if a == "probe" then return A.probe(pawn) end
    return false, "unknown admin action " .. tostring(a)
end

return A
