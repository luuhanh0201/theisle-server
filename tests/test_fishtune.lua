-- Functional test: FishTune (only with Mods/FishTune/ENABLED) — nothing without the marker;
-- with it, each apply.json id written once on the spawner, read back, flagged.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

os.execute('mkdir -p "' .. RUN .. '/Mods/FishTune/Saved"')
local clock = 5000
os.time = function() return clock end
local spawnerObj = { IsValid = function() return true end, MaxAmbientFishPerPlayer = 12,
  AmbientFishSoftLimitPerWater = 28, AmbientFishSpawnAttemptsPerPlayer = 1, AmbientFishSpawnCooldown = 0.5 }
_G.FindAllOf = function(c) if c == "TIAIWorldSpawner" then return { spawnerObj } end; return {} end

say("\n-- 1. not the test server: nothing --")
os.remove("Mods/FishTune/ENABLED")
dofile(RUN .. "/Mods/FishTune/Scripts/main.lua")
check("no loop without the marker", #H.gameLoops == 0)

say("\n-- 2. the test server: one write per apply.json id --")
H.reset()
local m = assert(io.open("Mods/FishTune/ENABLED", "w")); m:close()
os.remove("Mods/FishTune/Saved/writing.flag")
dofile(RUN .. "/Mods/FishTune/Scripts/main.lua")
local poll = H.gameLoops[1]
check("a 5 s game-thread loop", poll ~= nil and poll.ms == 5000)
poll.fn()
check("nothing written before a request", spawnerObj.MaxAmbientFishPerPlayer == 12)
local f = assert(io.open("Mods/FishTune/Saved/apply.json", "w"))
f:write(json.encode({ id = "a1", perPlayer = 24, perWater = 60, attempts = 3.7, cooldown = 0.25 })); f:close()
poll.fn()
check("written (whole numbers where the game has ints)", spawnerObj.MaxAmbientFishPerPlayer == 24 and spawnerObj.AmbientFishSoftLimitPerWater == 60
      and spawnerObj.AmbientFishSpawnAttemptsPerPlayer == 3 and spawnerObj.AmbientFishSpawnCooldown == 0.25)
check("the crash flag is up during the minute after", io.open("Mods/FishTune/Saved/writing.flag", "r") ~= nil)
local applied = json.decode(assert(io.open("Mods/FishTune/Saved/applied.json")):read("*a"))
check("read back into applied.json", applied.id == "a1" and applied.before.perPlayer == 12 and applied.after.perPlayer == 24)
spawnerObj.MaxAmbientFishPerPlayer = 12
poll.fn()
check("the same id is not written twice", spawnerObj.MaxAmbientFishPerPlayer == 12)
local function fishAt(x, cls) return { IsValid = function() return true end,
  K2_GetActorLocation = function() return { X = x, Y = 0, Z = 0 } end,
  GetClass = function() return { GetFName = function() return FName(cls) end } end } end
local fish = { fishAt(0, "BP_Hoplo_C"), fishAt(0, "BP_Hoplo_C"), fishAt(5000, "BP_Catfish_C") }
_G.FindAllOf = function(c)
  if c == "TIAIWorldSpawner" then return { spawnerObj } end
  if c == "TIAmbientFish" then return fish end
  return {}
end
f = assert(io.open("Mods/FishTune/Saved/apply.json", "w"))
f:write(json.encode({ id = "a1b", minDist = 1000, forwardDot = -1, debug = true, census = true })); f:close()
spawnerObj.AmbientFishMinSpawnDistance, spawnerObj.AmbientFishHiddenSpawnForwardDot = 3000, 0
poll.fn()
check("where fish may appear: closer, not only behind", spawnerObj.AmbientFishMinSpawnDistance == 1000 and spawnerObj.AmbientFishHiddenSpawnForwardDot == -1)
check("the game's fish-spawn logging on", spawnerObj.bDebugAmbientFishVerbose == true)
local ap = json.decode(assert(io.open("Mods/FishTune/Saved/applied.json")):read("*a"))
check("census: placed and parked, by class", ap.census and ap.census.placed == 1 and ap.census.parked == 2
      and ap.census.byClass.BP_Hoplo_C == 2, json.encode(ap.census))
clock = clock + 61
poll.fn()
check("the flag comes down after a minute", io.open("Mods/FishTune/Saved/writing.flag", "r") == nil)

say("\n-- 3. a run that stopped during a write: no more writes --")
H.reset()
local fl = assert(io.open("Mods/FishTune/Saved/writing.flag", "w")); fl:close()
f = assert(io.open("Mods/FishTune/Saved/apply.json", "w")); f:write(json.encode({ id = "a2", perPlayer = 30 })); f:close()
dofile(RUN .. "/Mods/FishTune/Scripts/main.lua")
H.gameLoops[1].fn()
check("blocked: nothing written", spawnerObj.MaxAmbientFishPerPlayer == 12)
os.remove("Mods/FishTune/ENABLED"); os.remove("Mods/FishTune/Saved/writing.flag"); os.remove("Mods/FishTune/Saved/apply.json")

check("never off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))
say(string.format("=== FishTune: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
