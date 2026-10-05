--[[
    DinoGarage/stomach.lua

    The game's stomach (2026-10-05, a T-Rex vomited after an admin's growth
    and two growth bags): the max stomach is a fixed share of the max health,
    by species, at every growth, prime included (StatsLogger, 41,896 readings
    of players' own dinos: 0.330 carnivores, 0.500 herbivores, no exception),
    and the game works it out so again at the dino's next growth tick or relog.
    SetGrowth does not move it (VitalLab). The mod used to set it from the
    dino's OWN share before the growth write: one already off (an earlier
    write, the game catching up) carried over, 0.33 -> 0.61 -> 0.54, a 52 %
    T-Rex with a 1,725 stomach instead of 1,026; a growth bag's food on top,
    and at the next growth tick the game put the stomach back, the food stood
    at 151 % and the dino vomited.

    So: the stomach is always RATIO[species] x max health, never read from the
    dino. M.fit sets it (and OriginalMaxHunger, what a Heal / a load goes back
    to) after any growth write, the food kept as the share it was (never past
    full). M.guard is the net under every other way: a dino whose stomach
    stands above its species' share (the only way to vomit from it) is put
    back, food kept as a share; one below, the game raises on its own.
    Measured on the test server for every species (mods/GrowthLab).
]]

local H = require("shared.isle.helpers")

local M = {}

-- MaxHunger / MaxHealth by species (the class name between BP_ and _C).
M.RATIO = {
    Allosaurus = 0.33, Austroraptor = 0.33, Carnotaurus = 0.33, Ceratosaurus = 0.33, Deinosuchus = 0.33,
    Dilophosaurus = 0.33, Herrerasaurus = 0.33, Omniraptor = 0.33, Pteranodon = 0.33, Troodon = 0.33,
    Tyrannosaurus = 0.33,
    Diabloceratops = 0.5, Dryosaurus = 0.5, Hypsilophodon = 0.5, Kentrosaurus = 0.5, Maiasaura = 0.5,
    Pachycephalosaurus = 0.5, Stegosaurus = 0.5, Tenontosaurus = 0.5, Triceratops = 0.5,
    Beipiaosaurus = 0.5, Gallimimus = 0.5,
}
-- Above its share by more than this: put back (readings round; the game's own sit at the share).
M.SLACK = 0.02

local function num(pawn, fn)
    local ok, v = pcall(function() return pawn[fn](pawn) end)
    return ok and type(v) == "number" and v == v and v or nil
end

--- "BP_Tyrannosaurus_C" / a full class path -> "Tyrannosaurus", or nil.
function M.speciesOf(pawn)
    local ok, name = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    if not ok or type(name) ~= "string" then return nil end
    local short = name:match("([%w_]+)$") or name
    return (short:gsub("^BP_", ""):gsub("_C$", ""))
end

--- This dino's stomach / health share, or nil (a species not measured).
function M.ratioOf(pawn)
    local sp = M.speciesOf(pawn)
    return sp and M.RATIO[sp] or nil
end

--- The dino's own attribute set (OriginalMaxHunger), or nil.
local function attributeSetOf(pawn)
    local okA, addr = pcall(function() return pawn:GetAddress() end)
    if not okA or addr == nil or addr == 0 then return nil end
    local ok, sets = pcall(function() return FindAllOf("TIAttributeSetDinosaur") or {} end)
    for _, s in ipairs(ok and sets or {}) do
        local okO, outerAddr = pcall(function() return s:GetOuter():GetAddress() end)
        if okO and outerAddr == addr then return s end
    end
    return nil
end

--- The stomach to RATIO x max health, OriginalMaxHunger too, the food kept as
--- the share of the max it had (`share`, else read now), at most full.
--- Returns the stomach max written, or nil (species unknown, no max health).
function M.fit(pawn, share)
    local ratio = M.ratioOf(pawn)
    local health = num(pawn, "GetMaxHealth")
    if ratio == nil or health == nil or health <= 0 then return nil end
    if share == nil then
        local cur, max = num(pawn, "GetHunger"), num(pawn, "GetMaxHunger")
        share = (cur ~= nil and max ~= nil and max > 0) and cur / max or nil
    end
    local stomach = ratio * health
    pcall(function() pawn:SetMaxHunger(stomach) end)
    local set = attributeSetOf(pawn)
    if set ~= nil then
        pcall(function()
            local a = set.OriginalMaxHunger
            a.BaseValue = stomach
            a.CurrentValue = stomach
        end)
    end
    if share ~= nil then
        pcall(function() pawn:SetHunger(stomach * math.max(0, math.min(1, share))) end)
    end
    return stomach
end

--- Is this dino's stomach above its species' share (a vomit waiting)? Returns
--- true, the max now, the right one; or false.
function M.inflated(pawn)
    local ratio = M.ratioOf(pawn)
    local health, max = num(pawn, "GetMaxHealth"), num(pawn, "GetMaxHunger")
    if ratio == nil or health == nil or max == nil or health <= 0 then return false end
    local want = ratio * health
    return max > want * (1 + M.SLACK), max, want
end

--- The net (H.every in main.lua, game thread): every player's dino whose stomach
--- stands above its share, put back (the food as a share), logged.
function M.guard()
    H.forEachPlayer(function(ctrl)
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local bad, was, want = M.inflated(pawn)
        if not bad then return end
        local id = H.safeSteamId(ctrl) or "?"
        local food = num(pawn, "GetHunger")
        local now = M.fit(pawn)
        H.log(string.format("stomach guard: %s %s stomach %.1f -> %.1f (share of max health), food %s -> %s",
            id, tostring(M.speciesOf(pawn)), was, now or want, food and string.format("%.1f", food) or "?",
            tostring(num(pawn, "GetHunger") and string.format("%.1f", num(pawn, "GetHunger")))))
    end)
end

return M
