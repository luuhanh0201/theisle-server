-- DinoGarage admin.lua: the /adminpanel actions from the web panel on a live
-- dino, heal (vitals full, fractures / sickness / venom cleared), vitals as
-- shares of their max, growth with the vitals kept as shares and the
-- originals written, teleport; bad input refused.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end
local Admin = require("garage.admin")

local function last(what) local v; for _, c in ipairs(H.calls) do if c.what == what then v = c.args[1] end end; return v end
-- A T-Rex: its stomach is 0.33 of its max health at any growth (garage/stomach.lua).
local REX = "BlueprintGeneratedClass /Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C"
local function dino()
  local p = H.makePawn({ growth = 0.5, class = REX })
  -- The setters change what the getters read (the harness only models SetHealth).
  for _, v in ipairs({ "Hunger", "Thirst", "Stamina", "Blood", "Oxygen", "MaxHunger" }) do
    rawset(p, "Set" .. v, function(_, x) H.record("Set" .. v, x); p.__props[v] = x end)
  end
  return p
end

say("-- 1. heal --")
local p = dino()
p.__props.Health, p.__props.Blood = 30, 40
local cured = {}
for _, fn in ipairs({ "SetAreLegsFractured", "SetIsBodyFractured", "SetIsHeadFractured" }) do
  rawset(p, fn, function(_, v) cured[fn] = v end)
end
rawset(p, "ResetVomitSickState", function() cured.sick = true end)
rawset(p, "ResetVenomStatus", function() cured.venom = true end)
H.calls = {}
local ok, line, words = Admin.run(p, { action = "heal" })
check("heal: ok, with words for the player", ok and words ~= nil, tostring(line))
check("health and blood to their max", p.__props.Health == 100 and p.__props.Blood == 100, p.__props.Health .. " / " .. p.__props.Blood)
check("fractures cleared, sickness and venom reset", cured.SetAreLegsFractured == false and cured.SetIsBodyFractured == false
  and cured.SetIsHeadFractured == false and cured.sick and cured.venom)

say("-- 2. vitals as shares --")
p = dino()
local struct = p.NutrientsStruct
H.calls = {}
ok = Admin.run(p, { action = "vitals", values = { hunger = 0.5, thirst = 1, carb = 0.25, bogus = 3 } })
check("vitals: ok", ok)
check("stomach 50 % of its max, thirst full", p.__props.Hunger == 50 and p.__props.Thirst == 100, p.__props.Hunger .. " / " .. p.__props.Thirst)
check("carb 25 % of the stomach max, malnutrition off, struct written", struct.CarbValue == 25 and H.countCalls("SetNutrientsStruct") == 1,
  tostring(struct.CarbValue))
check("a value out of 0–1 is not used", (Admin.run(dino(), { action = "vitals", values = { health = 2 } })) == false)

say("-- 3. grow: shares kept, stomach for the new growth, originals --")
p = dino()
p.__props.MaxHunger = 33        -- 0.33 of max health 100 (a carnivore)
p.__props.Hunger, p.__props.Health = 16.5, 80
rawset(p, "SetGrowth", function(_, g) H.record("SetGrowth", g); p.__props.Growth = g; p.__props.MaxHealth = 1000; p.__props.Health = 1000; p.__props.Hunger = 33 end)
local attr = function(v) return { BaseValue = v, CurrentValue = v } end
local set = { OriginalMaxHunger = attr(2), OriginalMaxThirst = attr(100), OriginalMaxStamina = attr(100), GetOuter = function() return p end }
_G.FindAllOf = function(cls) if cls == "TIAttributeSetDinosaur" then return { set } end; return {} end
H.calls = {}
ok, line = Admin.run(p, { action = "grow", growth = 0.8 })
check("grow: ok", ok, tostring(line))
check("SetGrowth 0.8", last("SetGrowth") == 0.8)
check("stomach max = the species ratio × the new max health (330)", math.abs(p.__props.MaxHunger - 330) < 0.01, tostring(p.__props.MaxHunger))
check("health kept at 80 %, stomach at 50 %", p.__props.Health == 800 and math.abs(p.__props.Hunger - 165) < 0.01,
  p.__props.Health .. " / " .. p.__props.Hunger)
check("originals = the new maxima (a Heal keeps them)", math.abs(set.OriginalMaxHunger.BaseValue - 330) < 0.01, tostring(set.OriginalMaxHunger.BaseValue))
check("growth out of 0.1–1 refused", (Admin.run(p, { action = "grow", growth = 1.5 })) == false)

say("-- 3b. grow with prime: conditions + ServerSetPrimeEligible, stats again later; only at 100 % --")
p = dino()
H.calls = {}
ok, line = Admin.run(p, { action = "grow", growth = 0.9, prime = true })
check("prime below 100 % refused, nothing done", ok == false and H.countCalls("SetGrowth") == 0, tostring(line))
ok, line = Admin.run(p, { action = "grow", growth = 1, prime = true })
check("prime asked", ok and H.countCalls("ServerSetPrimeEligible") == 1 and line:find("prime asked", 1, true) ~= nil, tostring(line))
local growths = H.countCalls("SetGrowth")
H.advance(5100)
check("growth set again once prime (step 9 of the garage)", H.countCalls("SetGrowth") >= growths, tostring(H.countCalls("SetGrowth")))

-- A Phiếu Prime on a T-Rex played a while: the same growth again kept the plain max (9,350, 2026-10-02);
-- only a growth below the prime mark and back adds prime's (PrimeLab: 12,274). Vitals stay shares.
p = dino()
local maxNow, wentLow = 9350, false
rawset(p, "IsPrimeElder", function() return true end)
rawset(p, "GetMaxHealth", function() return maxNow end)
rawset(p, "SetGrowth", function(_, v)
  H.record("SetGrowth", v)
  if v < 0.75 then wentLow = true; maxNow = 2800 elseif wentLow then maxNow = 12274 end
end)
p.__props.Health = 9350 * 0.6
H.calls = {}
ok = Admin.run(p, { action = "grow", growth = 1, prime = true })
H.advance(5100)
local gs = {}
for _, c in ipairs(H.calls) do if c.what == "SetGrowth" then gs[#gs + 1] = tostring(c.args[1]) end end
check("prime on a settled dino: growth 1, 1 again (no effect), 0.5, 1", ok and table.concat(gs, " ") == "1 1 0.5 1", table.concat(gs, " "))
check("…prime's max health now, health kept at 60 % of it", maxNow == 12274 and math.abs(p.__props.Health - 12274 * 0.6) < 0.01,
  maxNow .. " / " .. tostring(p.__props.Health))

say("-- 4. teleport, unknown --")
p = dino()
H.calls = {}
ok = Admin.run(p, { action = "teleport", x = 1000, y = 2000, z = 300 })
local loc = p.__props.Loc
check("teleported a little above the spot", ok and loc.X == 1000 and loc.Y == 2000 and loc.Z > 300, string.format("%s,%s,%s", loc.X, loc.Y, loc.Z))
check("teleport without z refused", (Admin.run(p, { action = "teleport", x = 1, y = 2 })) == false)
check("an unknown action refused", (Admin.run(p, { action = "fly" })) == false)

say("-- 5. mutslots (test): names into any slot, maxima before / after --")
p = dino()
H.calls = {}
ok, line = Admin.run(p, { action = "mutslots", slots = { MutationSlot1 = "Hydrodynamic", ElderMutationSlot1A = "Hydrodynamic", BadSlot = "X" } })
local m = p.ReplicatedMutationsData
check("written to the slots asked", ok and m.MutationSlot1:ToString() == "Hydrodynamic" and m.ElderMutationSlot1A:ToString() == "Hydrodynamic", tostring(line))
check("an unknown field ignored", m.BadSlot == nil)
check("pushed to the game", H.countCalls("SetReplicatedMutationsData") == 1)
check("the line has the maxima before and after", line:find("before: Health", 1, true) ~= nil and line:find("after: Health", 1, true) ~= nil, line)
ok = Admin.run(p, { action = "mutslots", slots = { MutationSlot1 = json and json.null or false } })
check("empty value clears the slot to None", ok and m.MutationSlot1:ToString() == "None")

say("-- 6. probe (read only) --")
p = dino()
H.calls = {}
ok, line = Admin.run(p, { action = "probe" })
check("probe answers, writes nothing", ok and line:find("^probe:") ~= nil and H.countCalls("SetReplicatedMutationsData") == 0
  and H.countCalls("SetGrowth") == 0 and H.countCalls("SetHealth") == 0, tostring(line))

say("-- 7. feed (Hộp food): the food bar only, at most full; a full dino refused --")
p = dino()
p.__props.MaxHunger, p.__props.Hunger = 200, 50      -- 25 %
p.__props.MaxHealth = 200 / 0.33                     -- a T-Rex's own stomach for this health
local nut = p.NutrientsStruct
local carb0 = nut.CarbValue
H.calls = {}
local before, after
ok, line, before, after = Admin.feed(p, 0.2)
check("feed: ok, 25 % -> 45 %", ok and math.abs(before - 0.25) < 1e-9 and math.abs(after - 0.45) < 1e-9 and p.__props.Hunger == 90, tostring(line))
check("nutrients not touched", H.countCalls("SetNutrientsStruct") == 0 and nut.CarbValue == carb0)
p.__props.Hunger = 180                                -- 90 %
ok = Admin.feed(p, 0.5)
check("never past full", ok and p.__props.Hunger == 200, tostring(p.__props.Hunger))
ok, line = Admin.feed(p, 0.2)
check("a full dino: refused (the item stays)", ok == false and line == "full", tostring(line))
check("a bad amount refused", (Admin.feed(dino(), 2)) == false and (Admin.feed(dino(), 0)) == false)
-- The 2026-10-05 vomit: a stomach above the species' share (1,725 on a 52 % T-Rex whose own is
-- 1,026). Fed as it was, the game shrinks it at the next growth tick and the dino vomits; so it is
-- put back first, the food kept as a share.
p = dino()
p.__props.MaxHealth, p.__props.MaxHunger, p.__props.Hunger = 3108.8, 1724.8, 880.3   -- 51 % of an inflated stomach
ok = Admin.feed(p, 0.2)
local want = 0.33 * 3108.8
check("an inflated stomach put back to 0.33 x max health first", ok and math.abs(p.__props.MaxHunger - want) < 0.01, tostring(p.__props.MaxHunger))
check("the food: its share kept (51 %), then +20 %, never past full", math.abs(p.__props.Hunger - want * (880.3 / 1724.8 + 0.2)) < 0.01,
  string.format("%.1f of %.1f", p.__props.Hunger, p.__props.MaxHunger))

say("-- 8. the 2026-10-05 vomit, step by step: admin growth, two growth bags, a food box, the next growth tick --")
do
  -- A T-Rex's max health by growth, read on players' own dinos (StatsLogger); its stomach is 0.33 of it.
  local HEALTH = { [0.32] = 148, [0.42] = 662, [0.52] = 3108.8, [0.62] = 5594.3 }
  local rex = dino()
  rex.__props.Growth, rex.__props.MaxHealth, rex.__props.Health = 0.62, 5594.3, 5594.3
  rex.__props.MaxHunger, rex.__props.Hunger = 1846.1, 1831.3
  local set = { OriginalMaxHunger = attr(1846.1), OriginalMaxThirst = attr(1000), OriginalMaxStamina = attr(658), GetOuter = function() return rex end }
  _G.FindAllOf = function(cls) if cls == "TIAttributeSetDinosaur" then return { set } end; return {} end
  -- SetGrowth as the game: health to the growth's, the stomach NOT moved (VitalLab).
  rawset(rex, "SetGrowth", function(_, g) H.record("SetGrowth", g); rex.__props.Growth = g
    rex.__props.MaxHealth = HEALTH[g] or rex.__props.MaxHealth; rex.__props.Health = rex.__props.MaxHealth end)
  local function stomachOk(label)
    local want = 0.33 * rex.__props.MaxHealth
    check(label .. ": stomach = 0.33 x max health (" .. string.format("%.1f", want) .. ")", math.abs(rex.__props.MaxHunger - want) < 0.01,
      string.format("%.1f", rex.__props.MaxHunger))
    check(label .. ": OriginalMaxHunger the same (a Heal / a relog keeps it)", math.abs(set.OriginalMaxHunger.BaseValue - want) < 0.01,
      string.format("%.1f", set.OriginalMaxHunger.BaseValue))
    check(label .. ": food at most full", rex.__props.Hunger <= rex.__props.MaxHunger + 1e-6,
      string.format("%.1f / %.1f", rex.__props.Hunger, rex.__props.MaxHunger))
  end
  ok = Admin.run(rex, { action = "grow", growth = 0.32 })
  stomachOk("admin growth 62 % -> 32 %")
  rex.__props.MaxHunger = 72.5            -- the game moving it on its own (08:56:25)
  Admin.grow(rex, 0.42)                    -- growth bag
  stomachOk("growth bag 32 % -> 42 %, from a stomach the game had moved")
  Admin.grow(rex, 0.52)
  stomachOk("growth bag 42 % -> 52 %")
  check("52 %: the stomach a natural 52 % T-Rex has (~1,026), not 1,725", math.abs(rex.__props.MaxHunger - 1025.9) < 0.1, string.format("%.1f", rex.__props.MaxHunger))
  Admin.feed(rex, 0.5)
  check("a food box: full at most", rex.__props.Hunger <= rex.__props.MaxHunger + 1e-6)
  -- The next growth tick: the game works the stomach out again as 0.33 x max health.
  local food = rex.__props.Hunger
  rex.__props.MaxHunger = 0.33 * rex.__props.MaxHealth
  check("the next growth tick: the food still at most 100 % (no vomit)", food <= rex.__props.MaxHunger + 1e-6,
    string.format("%.1f / %.1f", food, rex.__props.MaxHunger))
end

say("-- 9. the net: a stomach above the species' share put back on its own; one below left to the game --")
do
  local Stomach = require("garage.stomach")
  local p1 = dino()
  p1.__props.MaxHealth, p1.__props.MaxHunger, p1.__props.Hunger = 3108.8, 1846.1, 1588.9   -- the dino that vomited, 15:06
  local bad, was, want = Stomach.inflated(p1)
  check("found: 1,846 above 0.33 x 3,108.8", bad == true and math.abs(want - 1025.9) < 0.1 and was == 1846.1)
  Stomach.fit(p1)
  check("put back, the food as its share (86 %), under 100 %", math.abs(p1.__props.MaxHunger - 1025.9) < 0.1
    and math.abs(p1.__props.Hunger - 1025.9 * 1588.9 / 1846.1) < 0.1, string.format("%.1f / %.1f", p1.__props.Hunger, p1.__props.MaxHunger))
  local p2 = dino()
  p2.__props.MaxHealth, p2.__props.MaxHunger = 3108.8, 900          -- below: the game raises it, nothing to do
  check("below the share: left alone", Stomach.inflated(p2) == false)
  local p3 = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Unknownosaurus.BP_Unknownosaurus_C" })
  check("a species not measured: never touched", Stomach.inflated(p3) == false and Stomach.fit(p3) == nil)
  check("every playable species has its share", (function()
    for _, sp in ipairs({ "Allosaurus", "Austroraptor", "Beipiaosaurus", "Carnotaurus", "Ceratosaurus", "Deinosuchus", "Diabloceratops",
      "Dilophosaurus", "Dryosaurus", "Gallimimus", "Herrerasaurus", "Hypsilophodon", "Kentrosaurus", "Maiasaura", "Omniraptor",
      "Pachycephalosaurus", "Pteranodon", "Stegosaurus", "Tenontosaurus", "Triceratops", "Troodon", "Tyrannosaurus" }) do
      if not Stomach.RATIO[sp] then return false end
    end
    return true end)())
end

say(string.format("=== Admin: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
