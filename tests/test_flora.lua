-- Flora (read-only): spawners with their shape and migration state, plants and
-- fruits with their nutrients, one family per tick, a flag against crash loops.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end
os.execute('mkdir -p "' .. RUN .. '/Mods/Flora/Saved"')
local OUT, FLAG = "Mods/Flora/Saved/flora.json", "Mods/Flora/Saved/export.running"
os.remove(OUT); os.remove(FLAG)
local clock = 1000
os.time = function() return clock end

local addr = 5000
local function obj(cls, fields)
  addr = addr + 8
  local a = addr
  local o = { IsValid = function() return true end, GetAddress = function() return a end,
    GetClass = function() return { GetFName = function() return FName(cls) end } end }
  for k, v in pairs(fields or {}) do o[k] = v end
  return o
end
local function at(x, y) return function() return { X = x, Y = y, Z = 0 } end end
local spline = obj("SplineComponent", { GetNumberOfSplinePoints = function() return 4 end,
  GetLocationAtSplinePoint = function(_, i) local p = { { 0, 0 }, { 1000, 0 }, { 1000, 1000 }, { 0, 1000 } }; return { X = p[i + 1][1], Y = p[i + 1][2], Z = 0 } end })
local mz = obj("BP_EdiblePlantsSpawnable_C", { K2_GetActorLocation = at(500, 500), AreaSpline = spline,
  bShouldUseMigration = true, bBecameMassMigration = false, bMigrateHere = true, MigrationSpawnMultiplier = 2,
  AmountToBeSpawned = 40, GetIsMigrationActive = function() return true end })
local box = obj("BoxComponent", { GetScaledBoxExtent = function() return { X = 300, Y = 200, Z = 50 } end,
  K2_GetComponentLocation = at(9000, 9000), K2_GetComponentRotation = function() return { Pitch = 0, Yaw = 30, Roll = 0 } end })
local plain = obj("BP_EdiblePlantsSpawnable_C", { K2_GetActorLocation = at(9000, 9000), Box = box, bShouldUseMigration = false,
  GetIsMigrationActive = function() return false end })
local fern = obj("BP_Fiddlehead_C", { K2_GetActorLocation = at(600, 400), bCanGiveNutrients = true, FoodType = 2,
  CarbProportion = 0.5, ProteinProportion = 0.25, LipidProportion = 0.25, Spawner = mz })
local mango = obj("BP_FruitMangoStatic_C", { K2_GetActorLocation = at(9100, 9000), bCanGiveNutri = false, GoreFoodType = 1 })
_G.FindAllOf = function(c)
  if c == "TIEdibleSpawner" then return { mz, plain } end
  if c == "TIEdiblePlant" then return { fern } end
  if c == "TIFruitBase" then return { mango } end
  return {}
end

dofile(RUN .. "/Mods/Flora/Scripts/main.lua")
local step = H.gameLoops[#H.gameLoops]
local writer = H.loops[#H.loops]
step.fn()
check("the crash flag is up during the first export", io.open(FLAG, "r") ~= nil)
step.fn(); step.fn()
check("…and down once it finished", io.open(FLAG, "r") == nil)
writer.fn()
local f = io.open(OUT, "r")
local d = f and json.decode(f:read("*a"))
if f then f:close() end
check("flora.json written", d ~= nil)
local s1 = d and d.spawners[1]
check("a migration zone: its spline, active, multiplier", s1 and s1.migration == true and s1.active == true and s1.multiplier == 2
  and s1.shape.spline and #s1.shape.spline == 4, s1 and json.encode(s1) or "")
local s2 = d and d.spawners[2]
check("a plain area: its box (extent, turn)", s2 and s2.shape.box and s2.shape.box.ex == 300 and s2.shape.box.yaw == 30 and s2.active == false)
local p = d and d.plants[1]
check("a plant: nutrients, α/β/γ, its spawner", p and p.n == true and p.cp == 0.5 and p.s == s1.id and p.c == "BP_Fiddlehead_C")
check("a fruit: no nutrients", d and d.fruits[1].n == false and d.fruits[1].c == "BP_FruitMangoStatic_C")
check("never off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))
-- A start after a crash in the middle of an export: exports stay off.
local ff = io.open(FLAG, "w"); ff:write("1"); ff:close()
H.log = {}
dofile(RUN .. "/Mods/Flora/Scripts/main.lua")
check("after a crash mid-export: off, and says why", table.concat(H.log, "\n"):find("did not finish", 1, true) ~= nil)
os.remove(FLAG); os.remove(OUT)

say("\n-- step 2: control — nutrients only in active migration areas, fewer plants outside, all put back when off --")
H.reset()
local SET = "Mods/Flora/Saved/settings.json"
local CFLAG = "Mods/Flora/Saved/control.running"
os.remove(CFLAG)
local function settings(t) local sf = io.open(SET, "w"); sf:write(json.encode(t)); sf:close(); clock = clock + 20 end
local function nutri(o, field) o.SetCanGiveNutrients = function(self, v) H.record("SetCanGiveNutrients", v); self[field] = v end; return o end
mz.MigrationSpawnMultiplier, mz.AmountToBeSpawned = 1, 40
plain.AmountToBeSpawned, plain.MinimumZoneAmountToBeSpawned = 20, 10
local inZone = nutri(obj("BP_Fireweed_C", { K2_GetActorLocation = at(400, 400), bCanGiveNutrients = true, Spawner = mz }), "bCanGiveNutrients")
local leaf = nutri(obj("BP_Marigold_C", { K2_GetActorLocation = at(9000, 9000), bCanGiveNutrients = true, Spawner = plain }), "bCanGiveNutrients")
local tree = nutri(obj("BP_MangoTreeStaticSpawner_C", { K2_GetActorLocation = at(20000, 20000), bCanGiveNutrients = true,
  bIsStaticSpawner = true, MinAmountOfFruits = 4, MaxAmountOfFruits = 10 }), "bCanGiveNutrients")
local fruitIn = nutri(obj("BP_FruitMangoStatic_C", { K2_GetActorLocation = at(500, 600), bCanGiveNutri = true }), "bCanGiveNutri")
local fruitOut = nutri(obj("BP_FruitMangoStatic_C", { K2_GetActorLocation = at(20100, 20000), bCanGiveNutri = true }), "bCanGiveNutri")
_G.FindAllOf = function(c)
  if c == "TIEdibleSpawner" then return { mz, plain } end
  if c == "TIEdiblePlant" then return { inZone, leaf, tree } end
  if c == "TIFruitBase" then return { fruitIn, fruitOut } end
  return {}
end
settings({ control = true, migrationNutrientPct = 100, migrationMultiplier = 2, massNutrientPct = 100, massMultiplier = 3, outsideAmountPct = 30 })
dofile(RUN .. "/Mods/Flora/Scripts/main.lua")
local control
for _, l in ipairs(H.gameLoops) do if l.ms == 5000 then control = l end end
check("a control loop on the game thread", control ~= nil)
local function round() for _ = 1, 3 do control.fn() end end
round()
check("in an active migration area: nutrients kept", inZone.bCanGiveNutrients == true)
check("in a plain area: leaves only", leaf.bCanGiveNutrients == false)
check("a fruit inside the active area keeps them, one outside loses them", fruitIn.bCanGiveNutri == true and fruitOut.bCanGiveNutri == false)
check("the active area grows more (multiplier 2)", mz.MigrationSpawnMultiplier == 2)
check("the plain area capped (3 plants by default)", plain.AmountToBeSpawned == 3 and plain.MinimumZoneAmountToBeSpawned == 3,
  tostring(plain.AmountToBeSpawned))
check("the fruit tree outside bears fewer (30%)", tree.MinAmountOfFruits == 1 and tree.MaxAmountOfFruits == 3,
  tostring(tree.MinAmountOfFruits) .. "/" .. tostring(tree.MaxAmountOfFruits))
check("the round's flag cleared", io.open(CFLAG, "r") == nil)
local calls = H.countCalls("SetCanGiveNutrients")
clock = clock + 20
round()
check("nothing set again when already right", H.countCalls("SetCanGiveNutrients") == calls)
settings({ control = false })
round()
check("off: the game's values back", leaf.bCanGiveNutrients == true and fruitOut.bCanGiveNutri == true and mz.MigrationSpawnMultiplier == 1
  and plain.AmountToBeSpawned == 20 and tree.MaxAmountOfFruits == 10)
calls = H.countCalls("SetCanGiveNutrients")
clock = clock + 20
round()
check("off and put back: it then leaves the game alone", H.countCalls("SetCanGiveNutrients") == calls)
check("never off the game thread (control)", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))

say("\n-- step 2b: at most N plants in an area — the game's amount capped, the extra removed (no-nutrient ones first) --")
local crowd = {}
local function plantAt(i, nutri)
  local o = nutri(obj("BP_Fireweed_C", { K2_GetActorLocation = at(100 + i * 10, 100), bCanGiveNutrients = true, Spawner = mz }), "bCanGiveNutrients")
  o.DestroyPlant = function(self) H.record("DestroyPlant"); self.destroyed = true; self.IsValid = function() return false end end
  crowd[#crowd + 1] = o
  return o
end
for i = 1, 6 do plantAt(i, nutri) end
mz.AmountToBeSpawned, mz.MinimumZoneAmountToBeSpawned = 40, 40
_G.FindAllOf = function(c)
  if c == "TIEdibleSpawner" then return { mz, plain } end
  if c == "TIEdiblePlant" then
    local alive = {}
    for _, o in ipairs(crowd) do if not o.destroyed then alive[#alive + 1] = o end end
    return alive
  end
  if c == "TIFruitBase" then return {} end
  return {}
end
settings({ control = true, migrationNutrientPct = 50, migrationMultiplier = 1, massNutrientPct = 100, massMultiplier = 3,
  outsideAmountPct = 30, migrationMaxPerArea = 2, massMaxPerArea = 40, outsideMaxPerArea = 1 })
H.calls = {}
round()
check("the area's game amount capped to 2", mz.AmountToBeSpawned == 2 and mz.MinimumZoneAmountToBeSpawned == 2, tostring(mz.AmountToBeSpawned))
check("the plain area's to 1", plain.AmountToBeSpawned == 1, tostring(plain.AmountToBeSpawned))
check("4 of the 6 removed with the game's DestroyPlant", H.countCalls("DestroyPlant") == 4, tostring(H.countCalls("DestroyPlant")))
local kept, keptNutri = 0, 0
for _, o in ipairs(crowd) do if not o.destroyed then kept = kept + 1; if o.bCanGiveNutrients then keptNutri = keptNutri + 1 end end end
check("the ones without nutrients went first", kept == 2 and keptNutri >= 1, kept .. " kept, " .. keptNutri .. " with nutrients")
check("the trim flag cleared", io.open("Mods/Flora/Saved/trim.running", "r") == nil)
clock = clock + 20
round()
check("at the cap: nothing more removed", H.countCalls("DestroyPlant") == 4)
os.remove(SET); os.remove(CFLAG)
say(string.format("=== Flora: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
