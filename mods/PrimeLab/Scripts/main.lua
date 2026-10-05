-- PrimeLab, TEST SERVER ONLY (off in ue4ss/mods.txt; turned on by hand in the
-- test copy). A prime T-Rex taken out of the garage kept a plain one's max
-- health (9,350 instead of 12,274) on 2026-10-02 20:14 (Quang Tèo): restore.lua
-- step 7b (the same growth once more after prime) did nothing, the same slot
-- at 20:23 went 9,350 -> 12,274. The dino taken out at 20:14 had grown one
-- natural tick (0.25 -> 0.2522) before; the ones that worked were fresh. An
-- admin's growth to 100 % with prime (several growths before) did nothing too.
--
-- Part 1, metadata only: the dino's and its attribute set's functions about
-- growth / attributes / prime, with their parameters.
-- Part 2, one T-Rex a scenario, max health read after every step:
--   S1 fresh          SetGrowth(G), elder 2, prime, SetGrowth(G)       (the restore)
--   S2 two growths    SetGrowth(0.2522), then as S1
--   S3 admin to 100   SetGrowth 0.5, 0.75, 1.0, prime, SetGrowth(1.0)
--   S4 natural tick   wait for the game's own growth tick, then as S1
-- Part 3, for the first scenario that fails (max health not up after prime):
-- one T-Rex a remedy, each put through that scenario, then the remedy.
-- Writes Mods/PrimeLab/Saved/primelab.txt. Flag first per step
-- (Saved/<job>-<step>.trying), like the other labs.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H = require("shared.isle.helpers")

local MOD  = "PrimeLab"
local DIR  = "Mods/PrimeLab/Saved/"
local OUT  = DIR .. "primelab.txt"
local DINO = "/Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C"
local DINO_CLASS = "BP_Tyrannosaurus_C"
local STATICS = "/Script/Engine.Default__GameplayStatics"
local AT = { X = 350856, Y = -354551, Z = 39315 }
local START_AFTER_S = 90
local G = 0.89
local TICK_WAIT_S = 420
local WORDS = { "Growth", "Attribute", "Prime", "Elder", "Stat", "Recalc", "Recompute", "Refresh" }

local rows = {}
local function out(fmt, ...)
    local line = string.format(fmt, ...)
    rows[#rows + 1] = os.date("!%H:%M:%S ") .. line
    H.log(MOD .. ": " .. line)
    local f = io.open(OUT, "w")
    if f then f:write(table.concat(rows, "\n"), "\n"); f:close() end
end
local function exists(p) local f = io.open(p, "r"); if f then f:close(); return true end; return false end
local function write(p, t) local f = io.open(p, "w"); if f then f:write(t); f:close() end end
local function isValid(o) return o ~= nil and H.isValid(o) end
local function addressOf(o) local ok, a = pcall(function() return o:GetAddress() end); return ok and a ~= 0 and a or nil end
local function find(path) local ok, o = pcall(function() return StaticFindObject(path) end); return ok and isValid(o) and o or nil end
local function num(p, fn) local ok, v = pcall(function() return p[fn](p) end); return ok and type(v) == "number" and v or nil end
local function call(p, fn) local ok, v = pcall(function() return p[fn](p) end); return ok and tostring(v) or "?" end

--- A step run behind a flag file: skipped when the server died during it last time.
local function guarded(name, fn)
    local flag = DIR .. name .. ".trying"
    if exists(flag) then out("%s: SKIPPED, the server stopped during it last time (crash)", name); return false end
    write(flag, tostring(os.time()))
    local ok, err = pcall(fn)
    os.remove(flag)
    if not ok then out("%s: error %s", name, tostring(err)) end
    return ok
end

local function attributeSetOf(pawn)
    local addr = addressOf(pawn)
    local ok, sets = pcall(function() return FindAllOf("TIAttributeSetDinosaur") or {} end)
    for _, s in ipairs(ok and sets or {}) do
        local okO, outer = pcall(function() return s:GetOuter():GetAddress() end)
        if okO and outer == addr then return s end
    end
    return nil
end

--- { name = { params = n, sig = "..." } } of obj's class chain functions whose name has one of WORDS.
local function functionsOf(obj)
    local found = {}
    pcall(function()
        local cls = obj:GetClass()
        local depth = 0
        while cls ~= nil and depth < 12 and cls:IsValid() do
            pcall(function() cls:ForEachFunction(function(fn)
                local n = fn:GetFName():ToString()
                if found[n] ~= nil then return end
                for _, w in ipairs(WORDS) do
                    if n:find(w, 1, true) then
                        local params = {}
                        pcall(function() fn:ForEachProperty(function(prop)
                            params[#params + 1] = prop:GetClass():GetFName():ToString() .. " " .. prop:GetFName():ToString()
                        end) end)
                        found[n] = { params = #params, sig = n .. "(" .. table.concat(params, ", ") .. ")" }
                        return
                    end
                end
            end) end)
            local okS, super = pcall(function() return cls:GetSuperStruct() end)
            cls = okS and super or nil
            depth = depth + 1
        end
    end)
    return found
end

local function listFunctions(label, found)
    local names = {}
    for n in pairs(found) do names[#names + 1] = n end
    table.sort(names)
    out("%s functions (%d): %s", label, #names, #names > 0 and "" or "none")
    for _, n in ipairs(names) do out("  %s", found[n].sig) end
end

local function numbers(pawn, label)
    out("%s: maxHealth=%s health=%s maxHunger=%s growth=%s prime=%s eligible=%s elder=%s", label,
        call(pawn, "GetMaxHealth"), call(pawn, "GetHealth"), call(pawn, "GetMaxHunger"), call(pawn, "GetGrowth"),
        call(pawn, "IsPrimeElder"), call(pawn, "GetIsEligiblePrimeElder"), call(pawn, "GetElderReplicationStacks"))
end

-- Run 2 (2026-10-02): run 1 found the failing case, a dino older than a few
-- seconds (S4: 7 min, no growth tick): SetGrowth after prime keeps the plain
-- max (fresh dinos get prime's). Of the remedies, only SetGrowth(0.25) then the
-- growth again worked (9,350 -> 12,274, stomach 3,085 -> 4,050). Now: how
-- small a dip works (0.74 / 0.5 / 0.25), the game's own recomputes
-- (ResetAttributes, UpdateAttributeBaseValues), at 0.89 and at 1.0, and does
-- the dino keep its mutations, elder stacks and prime conditions through it.
local AGE_S = 150
local SLOTS = { MutationSlot1 = "Reniculate Kidneys", MutationSlot2 = "Gastronomic Regeneration",
    MutationSlot3 = "Hydrodynamic", MutationSlot4 = "Hemomania" }
local SLOT_ORDER = { "MutationSlot1", "MutationSlot2", "MutationSlot3", "MutationSlot4" }

local function grow(g) return { "SetGrowth(" .. g .. ")", function(p) p:SetGrowth(g) end } end
local ELDER = { "elder 2", function(p) p:SetElderReplicationStacks(2) end }
local PRIME = { "prime", function(p)
    local data = p.EligiblePrimeElderData
    for i = 1, 10 do data["bPrimeCondition" .. i] = (i == 3 or i == 5 or i == 6 or i == 8) end
    data.bIsEligiblePrime = true
    p:ServerSetPrimeEligible(true)
end }
local MUTS = { "mutations written", function(p)
    local s = p.ReplicatedMutationsData
    for f, n in pairs(SLOTS) do s[f] = FName(n) end
    p:SetReplicatedMutationsData(s, true)
end }
local WAIT_AGE = { "wait (age)", function(p, job)
    if os.time() - job.spawnedAt < AGE_S then return false end
    out("%s: %d s old", job.name, os.time() - job.spawnedAt)
    return true
end }

--- Mutations, elder stacks and prime conditions, as one string (compared before / after the remedy).
local function keepers(p)
    local parts = {}
    pcall(function()
        local s = p.ReplicatedMutationsData
        for _, f in ipairs(SLOT_ORDER) do parts[#parts + 1] = f:sub(-1) .. "=" .. s[f]:ToString() end
    end)
    parts[#parts + 1] = "elder=" .. call(p, "GetElderReplicationStacks")
    pcall(function()
        local d, c = p.EligiblePrimeElderData, {}
        for i = 1, 10 do c[i] = d["bPrimeCondition" .. i] and "1" or "0" end
        parts[#parts + 1] = "conds=" .. table.concat(c) .. " eligible=" .. tostring(d.bIsEligiblePrime)
    end)
    parts[#parts + 1] = "prime=" .. call(p, "IsPrimeElder")
    return table.concat(parts, " ")
end

local MARK = { "before remedy (mark)", function(p, job) job.basis = num(p, "GetMaxHealth"); job.kept = keepers(p) end }
local function base(g)
    if g >= 1 then return { WAIT_AGE, grow(0.5), grow(0.75), grow(1.0), ELDER, MUTS, PRIME, grow(1.0), MARK } end
    return { WAIT_AGE, grow(g), ELDER, MUTS, PRIME, grow(g), MARK }
end
local function job(name, g, remedy)
    local steps = base(g)
    for _, s in ipairs(remedy) do steps[#steps + 1] = s end
    return { name = name, steps = steps }
end
-- Run 3: the fix itself, DinoGarage's own restore.lua (R.regrowKeep with prime = true, which
-- the garage's late prime, an admin's growth / Phiếu Prime and prime fixes call; step 7b calls
-- R.primeGrowth). Health set to 50 % before it: the share must stay. A fresh dino too (no wait).
package.path = "Mods/DinoGarage/Scripts/?.lua;" .. package.path
local Restore = require("garage.restore")
local HALF = { "health 50 %", function(p) p:SetHealth(p:GetMaxHealth() * 0.5) end }
local function fix(g) return { "Restore.regrowKeep(g, prime)", function(p)
    local ok, stomach = Restore.regrowKeep(p, g, true)
    out("regrowKeep: ok=%s stomach max %s", tostring(ok), tostring(stomach))
end } end
local JOBS = {
    job("FIX aged 0.89", G, { HALF, fix(G) }),
    job("FIX aged 1.0", 1.0, { HALF, fix(1.0) }),
    { name = "FIX fresh 0.89", steps = { grow(G), ELDER, MUTS, PRIME, MARK, HALF, fix(G) } },
}

local jobs, phase, loadedAt, nextAt = {}, 0, os.time(), 0

local function spawnDino(statics, cls, world, i)
    local addr = nil
    pcall(function()
        local loc = { X = AT.X + (i % 6) * 900, Y = AT.Y + math.floor(i / 6) * 900, Z = AT.Z }
        local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = loc, Scale3D = { X = 1, Y = 1, Z = 1 } }
        local a = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
        if a ~= nil and addressOf(a) ~= nil then statics:FinishSpawningActor(a, xf, 1); addr = addressOf(a) end
    end)
    return addr
end

local function pawnAt(addr)
    local ok, all = pcall(function() return FindAllOf(DINO_CLASS) or {} end)
    for _, p in ipairs(ok and all or {}) do if addressOf(p) == addr and isValid(p) then return p end end
    return nil
end

local function numbers(pawn, label)
    out("%s: maxHealth=%s health=%s maxHunger=%s hunger=%s maxBlood=%s blood=%s growth=%s", label,
        call(pawn, "GetMaxHealth"), call(pawn, "GetHealth"), call(pawn, "GetMaxHunger"), call(pawn, "GetHunger"),
        call(pawn, "GetMaxBlood"), call(pawn, "GetBlood"), call(pawn, "GetGrowth"))
end

--- One step of every unfinished job. Returns true when all are done.
local function advance()
    local done = true
    for _, jb in ipairs(jobs) do
        if not jb.done then
            done = false
            local pawn = jb.addr and pawnAt(jb.addr) or nil
            if pawn == nil then out("%s: dino gone", jb.name); jb.done = true
            else
                local s = jb.steps[jb.i]
                local finished = true
                guarded(jb.tag .. "-" .. jb.i, function() finished = s[2](pawn, jb) ~= false end)
                if finished then
                    if s ~= WAIT_AGE then numbers(pawn, string.format("%s %d after %s", jb.name, jb.i, s[1])) end
                    if s == MUTS then out("%s: as written, %s", jb.name, keepers(pawn)) end
                    jb.i = jb.i + 1
                    if jb.i > #jb.steps then
                        jb.done = true
                        local final, now = num(pawn, "GetMaxHealth"), keepers(pawn)
                        out("%s: RESULT %s, max health %s -> %s | kept: %s", jb.name,
                            final ~= nil and jb.basis ~= nil and final > jb.basis * 1.02 and "PRIME STATS" or "no prime stats",
                            tostring(jb.basis), tostring(final), now == jb.kept and "all (" .. now .. ")" or "CHANGED " .. tostring(jb.kept) .. " => " .. now)
                    end
                end
            end
        end
    end
    return done
end

H.every(2000, MOD .. ": step", function()
    local now = os.time()
    if now < loadedAt + START_AFTER_S or now < nextAt or phase >= 9 then return end
    local okG, world = pcall(function()
        local gs = FindFirstOf("TIGameStateBase")
        return isValid(gs) and gs:GetWorld() or nil
    end)
    if not (okG and isValid(world)) then return end
    if phase == 0 then
        local statics, cls = find(STATICS), find(DINO)
        if cls == nil and type(LoadAsset) == "function" then pcall(function() LoadAsset(DINO) end); cls = find(DINO) end
        if not (statics and cls) then out("dino class not found"); phase = 9; return end
        for i, j in ipairs(JOBS) do
            local jb = { tag = "j" .. i, name = j.name, steps = j.steps, i = 1, spawnedAt = os.time() }
            jb.addr = spawnDino(statics, cls, world, i - 1)
            if jb.addr == nil then out("%s: nothing spawned", j.name); jb.done = true end
            jobs[#jobs + 1] = jb
        end
        out("%d dinos spawned, remedies after %d s", #jobs, AGE_S)
        phase = 1
    elseif phase == 1 then
        if not advance() then return end
        out("DONE")
        phase = 9
    end
end)

out("loaded (run 3), starts %d s after load", START_AFTER_S)
