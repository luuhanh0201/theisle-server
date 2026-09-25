-- PlantProbe: read-only, once (flag written first), a report file.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end
os.execute('mkdir -p "' .. RUN .. '/Mods/AIZones/Saved"')
local FLAG = "Mods/AIZones/Saved/plantprobe.flag"
local OUT = "Mods/AIZones/Saved/plantprobe.txt"
os.remove(FLAG); os.remove(OUT)

local function cls(n, props)
  return { IsValid = function() return true end, GetFName = function() return FName(n) end,
    ForEachProperty = function(_, cb) for _, p in ipairs(props or {}) do cb({ GetFName = function() return FName(p) end,
      GetClass = function() return { GetFName = function() return FName("FloatProperty") end } end }) end end,
    ForEachFunction = function() end, GetSuperStruct = function() return nil end,
    GetCDO = function() H.record("GetCDO") end }
end
local function actor(c, x)
  return { GetClass = function() return c end, K2_GetActorLocation = function() return { X = x, Y = 0, Z = 0 } end,
    GetFName = function() return FName("a") end }
end
local bush = cls("BP_FoodBush_C", { "NutrientType", "RegrowTime" })
local rock = cls("StaticMeshActor")
local ism = { GetInstanceCount = function() return 420 end, GetOwner = function() return actor(cls("InstancedFoliageActor"), 0) end,
  GetClass = function() return cls("FoliageInstancedStaticMeshComponent") end, GetFName = function() return FName("Fern_ISM") end }
_G.FindAllOf = function(c)
  if c == "Actor" then return { actor(bush, 1), actor(bush, 2), actor(rock, 3) } end
  if c == "InstancedStaticMeshComponent" then return { ism } end
  return {}
end

dofile(RUN .. "/Mods/PlantProbe/Scripts/main.lua")
H.advance(130000)
local f = io.open(OUT, "r")
local text = f and f:read("*a") or ""
if f then f:close() end
check("a report was written", text:find("ACTORS: 3 in 2 classes", 1, true) ~= nil, text:sub(1, 300))
check("plant classes described by name and type", text:find("NutrientType:FloatProperty", 1, true) ~= nil)
check("foliage counted", text:find("420 instances", 1, true) ~= nil)
check("the flag was written (once)", io.open(FLAG, "r") ~= nil)
check("no class default object read", H.countCalls("GetCDO") == 0)
H.log = {}
dofile(RUN .. "/Mods/PlantProbe/Scripts/main.lua")
check("a second start skips it", table.concat(H.log, "\n"):find("already ran", 1, true) ~= nil)
check("never off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))
os.remove(FLAG); os.remove(OUT)
say(string.format("=== PlantProbe: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
