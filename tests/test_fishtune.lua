-- Functional test: FishTune (test server only) — nothing without the marker;
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
os.remove("Mods/FishTune/TEST_SERVER")
dofile(RUN .. "/Mods/FishTune/Scripts/main.lua")
check("no loop without the marker", #H.gameLoops == 0)

say("\n-- 2. the test server: one write per apply.json id --")
H.reset()
local m = assert(io.open("Mods/FishTune/TEST_SERVER", "w")); m:close()
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
os.remove("Mods/FishTune/TEST_SERVER"); os.remove("Mods/FishTune/Saved/writing.flag"); os.remove("Mods/FishTune/Saved/apply.json")

check("never off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))
say(string.format("=== FishTune: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
