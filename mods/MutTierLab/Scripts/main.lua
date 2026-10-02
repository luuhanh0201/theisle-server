-- MutTierLab — TEST SERVER ONLY (off in ue4ss/mods.txt; turned on by hand in the
-- test copy).
--
-- The owner wants a mutation item to make ONE mutation stronger (2026-10-02).
-- ReplicatedMutationsData holds names only; the strength is said to follow the
-- dino's ElderReplicationStacks (all mutations). Does WHERE a mutation sits
-- (active / parent / elder slots), or holding it twice, change its strength?
--
-- Measured on "Increased Inspiratory Capacity" (oxygen capacity +15 / 20 / 25 %
-- by generation): GetMaxOxygen of dinos spawned for the test (no player), one
-- per case, all Tyrannosaurus at growth 1:
--   A  none                                   stacks 0   (the base)
--   B  Slot1                                  stacks 0
--   C  Slot1                                  stacks 1
--   D  Slot1 + ParentSlot1                    stacks 0
--   E  ParentSlot1 only                       stacks 0
--   F  ElderSlot1A only                       stacks 0
--   G  Slot1 + ElderSlot1A + ElderSlot1B      stacks 0
--   H  Slot1 + ParentSlot1 + Elder 1A/1B/2A   stacks 0   (five times)
-- Read after the writes, after SetGrowth(1) again (a recompute), and 60 s later.
-- Writes Mods/MutTierLab/Saved/muttierlab.txt. A crash flag (Saved/run.trying)
-- stops the next start from trying again.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end
local H = require("shared.isle.helpers")

local MOD  = "MutTierLab"
local DIR  = "Mods/MutTierLab/Saved/"
local OUT  = DIR .. "muttierlab.txt"
local FLAG = DIR .. "run.trying"
local SPECIES = "Tyrannosaurus"
local DINO = "/Game/TheIsle/Core/Characters/Dinosaurs/" .. SPECIES .. "/BP_" .. SPECIES .. ".BP_" .. SPECIES .. "_C"
local STATICS = "/Script/Engine.Default__GameplayStatics"
local MUT = "Increased Inspiratory Capacity"
local START_AFTER_S = 90

local CASES = {
    { "A none",                          {},                                                    0 },
    { "B Slot1",                         { "MutationSlot1" },                                   0 },
    { "C Slot1, stacks 1",               { "MutationSlot1" },                                   1 },
    { "D Slot1 + Parent1",               { "MutationSlot1", "ParentMutationSlot1" },            0 },
    { "E Parent1 only",                  { "ParentMutationSlot1" },                             0 },
    { "F Elder1A only",                  { "ElderMutationSlot1A" },                             0 },
    { "G Slot1 + Elder1A + Elder1B",     { "MutationSlot1", "ElderMutationSlot1A", "ElderMutationSlot1B" }, 0 },
    { "H five slots",                    { "MutationSlot1", "ParentMutationSlot1", "ElderMutationSlot1A", "ElderMutationSlot1B", "ElderMutationSlot2A" }, 0 },
}

local rows = {}
local function out(fmt, ...)
    local line = string.format(fmt, ...)
    rows[#rows + 1] = os.date("!%H:%M:%S ") .. line
    H.log(MOD .. ": " .. line)
    local f = io.open(OUT, "w")
    if f then f:write(table.concat(rows, "\n"), "\n"); f:close() end
end
local function exists(p) local f = io.open(p, "r"); if f then f:close(); return true end; return false end
local function isValid(o) return o ~= nil and H.isValid(o) end
local function addressOf(o) local ok, a = pcall(function() return o:GetAddress() end); return ok and a ~= 0 and a or nil end
local function find(path) local ok, o = pcall(function() return StaticFindObject(path) end); return ok and isValid(o) and o or nil end
local function num(p, fn) local ok, v = pcall(function() return p[fn](p) end); return ok and tonumber(v) or nil end

local function spawn(world, at)
    local statics, cls = find(STATICS), find(DINO)
    if cls == nil and type(LoadAsset) == "function" then pcall(function() LoadAsset(DINO) end); cls = find(DINO) end
    if not (statics and cls) then return nil end
    local addr = nil
    pcall(function()
        local xf = { Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Translation = at, Scale3D = { X = 1, Y = 1, Z = 1 } }
        local a = statics:BeginDeferredActorSpawnFromClass(world, cls, xf, 2, nil, 1)
        if a ~= nil and addressOf(a) ~= nil then statics:FinishSpawningActor(a, xf, 1); addr = addressOf(a) end
    end)
    return addr
end
local function byAddress(addr)
    local ok, all = pcall(function() return FindAllOf("BP_" .. SPECIES .. "_C") or {} end)
    for _, p in ipairs(ok and all or {}) do if addressOf(p) == addr and isValid(p) then return p end end
    return nil
end

local dinos = {}   -- { case, addr, reads = {} }
local phase, loadedAt, nextAt = 0, os.time(), 0

local function readAll(label)
    local base
    for _, d in ipairs(dinos) do
        local p = d.addr and byAddress(d.addr)
        d.reads[label] = p and num(p, "GetMaxOxygen") or nil
    end
    base = dinos[1].reads[label]
    for _, d in ipairs(dinos) do
        local v = d.reads[label]
        out("  [%s] %-30s max oxygen %s%s", label, d.case[1], v and string.format("%.1f", v) or "?",
            (v and base and base > 0) and string.format("  (%+.1f%% vs A)", (v / base - 1) * 100) or "")
    end
end

if exists(FLAG) then
    out("a previous run did not finish (crash?) — not trying again; delete %s to retry", FLAG)
    return
end

H.every(2000, MOD .. ": step", function()
    local now = os.time()
    if phase >= 99 or now < loadedAt + START_AFTER_S or now < nextAt then return end
    local okG, world = pcall(function()
        local gs = FindFirstOf("TIGameStateBase")
        return isValid(gs) and gs:GetWorld() or nil
    end)
    if not (okG and isValid(world)) then return end
    if phase == 0 then
        local f = io.open(FLAG, "w"); if f then f:write("running"); f:close() end
        local i = #dinos + 1
        local c = CASES[i]
        if c == nil then phase, nextAt = 1, now + 5; return end
        local at = { X = 350856 + ((i - 1) % 4) * 1500, Y = -354551 + math.floor((i - 1) / 4) * 1500, Z = 39315 }
        dinos[i] = { case = c, addr = spawn(world, at), reads = {} }
        out("spawned %s: %s", c[1], dinos[i].addr and "ok" or "FAILED")
        return
    end
    if phase == 1 then
        for _, d in ipairs(dinos) do
            local p = d.addr and byAddress(d.addr)
            if p then pcall(function() p:SetGrowth(1.0) end) end
        end
        out("growth 1 set; reading the base in 10 s")
        phase, nextAt = 2, now + 10
        return
    end
    if phase == 2 then
        readAll("before")
        for _, d in ipairs(dinos) do
            local p = d.addr and byAddress(d.addr)
            if p then
                local fields, stacks = d.case[2], d.case[3]
                if #fields > 0 then
                    local okW, err = pcall(function()
                        local s = p.ReplicatedMutationsData
                        for _, f in ipairs(fields) do s[f] = FName(MUT) end
                        p:SetReplicatedMutationsData(s, true)
                    end)
                    if not okW then out("  %s: mutation write failed: %s", d.case[1], tostring(err)) end
                    pcall(function() p:ClientUpdateMutations() end)
                end
                if stacks > 0 then
                    local okS, err = pcall(function() p:SetElderReplicationStacks(stacks) end)
                    if not okS then out("  %s: stacks write failed: %s", d.case[1], tostring(err)) end
                end
                -- What the game holds now.
                local held = {}
                pcall(function()
                    local s = p.ReplicatedMutationsData
                    for _, f in ipairs(d.case[2]) do held[#held + 1] = f .. "=" .. s[f]:ToString() end
                end)
                out("  %s: stacks %s, %s", d.case[1], tostring(num(p, "GetElderReplicationStacks")), table.concat(held, " "))
            end
        end
        phase, nextAt = 3, now + 5
        return
    end
    if phase == 3 then
        readAll("after write")
        for _, d in ipairs(dinos) do
            local p = d.addr and byAddress(d.addr)
            if p then pcall(function() p:SetGrowth(1.0) end) end
        end
        phase, nextAt = 4, now + 10
        return
    end
    if phase == 4 then
        readAll("after regrow")
        phase, nextAt = 5, now + 60
        return
    end
    if phase == 5 then
        readAll("60 s later")
        for _, d in ipairs(dinos) do
            local p = d.addr and byAddress(d.addr)
            if p then pcall(function() p:SetHealth(0) end) end
        end
        os.remove(FLAG)
        out("DONE")
        phase = 99
    end
end)

out("loaded — %d dinos, starting %d s after load", #CASES, START_AFTER_S)
