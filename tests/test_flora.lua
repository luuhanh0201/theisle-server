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
say(string.format("=== Flora: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
