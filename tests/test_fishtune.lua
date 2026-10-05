-- Functional test: FishTune (only with Mods/FishTune/Saved/ENABLED), nothing without the marker;
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
os.remove("Mods/FishTune/Saved/ENABLED")
dofile(RUN .. "/Mods/FishTune/Scripts/main.lua")
check("no loop without the marker", #H.gameLoops == 0)

say("\n-- 2. the test server: one write per apply.json id --")
H.reset()
local m = assert(io.open("Mods/FishTune/Saved/ENABLED", "w")); m:close()
os.remove("Mods/FishTune/Saved/writing.flag")
dofile(RUN .. "/Mods/FishTune/Scripts/main.lua")
local poll = H.gameLoops[1]
check("a 2 s game-thread loop", poll ~= nil and poll.ms == 2000)
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

say("\n-- 2b. keeping fish: a long despawn delay on placed fish, up to maxTotal --")
local nextAddr = 100
local function swimmer(x)
  nextAddr = nextAddr + 1
  local addr = nextAddr
  local o = { DespawnDelaySeconds = 25 }
  return setmetatable(o, { __index = function(_, k)
    if k == "GetAddress" then return function() return addr end end
    if k == "IsValid" then return function() return true end end
    if k == "K2_GetActorLocation" then return function() return { X = x, Y = 0, Z = 0 } end end
  end })
end
local lake = { swimmer(5000), swimmer(0), swimmer(7000), swimmer(9000) }   -- the 2nd is parked
_G.FindAllOf = function(c)
  if c == "TIAIWorldSpawner" then return { spawnerObj } end
  if c == "TIAmbientFish" then return lake end
  return {}
end
poll.fn()
check("keep off by default: fish untouched", rawget(lake[1], "DespawnDelaySeconds") == 25)
local kf = assert(io.open("Mods/FishTune/Saved/keep.json", "w"))
kf:write(json.encode({ enabled = true, despawnDelay = 86400, maxTotal = 2 })); kf:close()
poll.fn()
check("placed fish kept, up to maxTotal", rawget(lake[1], "DespawnDelaySeconds") == 86400 and rawget(lake[3], "DespawnDelaySeconds") == 86400)
check("a parked fish is left alone", rawget(lake[2], "DespawnDelaySeconds") == 25)
check("past maxTotal, left to the game", rawget(lake[4], "DespawnDelaySeconds") == 25)
table.remove(lake, 1)                          -- one kept fish eaten
poll.fn()
check("room again: the next fish is kept", rawget(lake[3], "DespawnDelaySeconds") == 86400)
kf = assert(io.open("Mods/FishTune/Saved/keep.json", "w")); kf:write(json.encode({ enabled = false })); kf:close()
local newcomer = swimmer(8000); lake[#lake + 1] = newcomer
poll.fn()
check("turned off: new fish left to the game", rawget(newcomer, "DespawnDelaySeconds") == 25)
os.remove("Mods/FishTune/Saved/keep.json")

say("\n-- 2c. keeping: at most perWindow new ones per window, near the crocodiles first --")
local croc = H.makePawn({ class = "BP_Deinosuchus_C", loc = { X = 1000000, Y = 0, Z = 0 } })
local crocCtrl = H.makeCtrl("76561190000000009", croc)
local far1, far2, near1, near2 = swimmer(5000), swimmer(6000), swimmer(1020000), swimmer(1030000)   -- 200 / 300 m from the crocodile
lake = { far1, far2, near1, near2 }
_G.FindAllOf = function(c)
  if c == "TIAIWorldSpawner" then return { spawnerObj } end
  if c == "TIAmbientFish" then return lake end
  if c == "PlayerController" then return { crocCtrl } end
  return {}
end
kf = assert(io.open("Mods/FishTune/Saved/keep.json", "w"))
kf:write(json.encode({ enabled = true, despawnDelay = 3600, maxTotal = 60, perWindow = 2, windowSec = 300,
  nearClass = "BP_Deinosuchus_C", nearM = 5000 })); kf:close()
clock = clock + 301   -- a fresh window (the keeps above counted in the last one)
poll.fn()
check("the two by the crocodile kept first", rawget(near1, "DespawnDelaySeconds") == 3600 and rawget(near2, "DespawnDelaySeconds") == 3600)
check("the window is full: the far ones wait", rawget(far1, "DespawnDelaySeconds") == 25 and rawget(far2, "DespawnDelaySeconds") == 25)
clock = clock + 301
poll.fn()
check("next window: the far ones kept", rawget(far1, "DespawnDelaySeconds") == 3600 and rawget(far2, "DespawnDelaySeconds") == 3600)
os.remove("Mods/FishTune/Saved/keep.json")

say("\n-- 2d. keeping only some kinds (the big and middle fish) --")
local function kind(x, cls)
  local o = swimmer(x)
  local mt = getmetatable(o)
  local base = mt.__index
  mt.__index = function(t, k)
    if k == "GetClass" then return function() return { GetFName = function() return FName(cls) end } end end
    return base(t, k)
  end
  return o
end
local cat, hop = kind(5000, "BP_Catfish_C"), kind(6000, "BP_Hoplo_C")
lake = { cat, hop }
kf = assert(io.open("Mods/FishTune/Saved/keep.json", "w"))
kf:write(json.encode({ enabled = true, despawnDelay = 3600, maxTotal = 60, onlyClasses = { "BP_Catfish_C", "BP_Coalecanth_C" } })); kf:close()
clock = clock + 301
poll.fn()
check("a big one kept", rawget(cat, "DespawnDelaySeconds") == 3600)
check("a small one left to the game", rawget(hop, "DespawnDelaySeconds") == 25)

say("\n-- 2e. keeping hands a fish back when a player comes near --")
local pos = { X = 1020000, Y = 0, Z = 0 }   -- 200 m from the crocodile
local coel = setmetatable({ DespawnDelaySeconds = 25 }, { __index = function(_, k)
  if k == "GetAddress" then return function() return 9001 end end
  if k == "IsValid" then return function() return true end end
  if k == "K2_GetActorLocation" then return function() return { X = pos.X, Y = pos.Y, Z = pos.Z } end end
  if k == "GetActorScale3D" then return function() return { X = 1.4, Y = 1.4, Z = 1.4 } end end
  if k == "GetClass" then return function() return { GetFName = function() return FName("BP_Coalecanth_C") end } end end
end })
lake = { coel }
clock = clock + 301
poll.fn()
check("the coelacanth kept", rawget(coel, "DespawnDelaySeconds") == 3600)
pos.X = 1000300          -- next to the crocodile (3 m)…
poll.fn()
check("a player close: handed back to the game's 25 s (so it can be caught)", rawget(coel, "DespawnDelaySeconds") == 25)
check("…and not kept again while the player is near", (function() poll.fn(); return rawget(coel, "DespawnDelaySeconds") == 25 end)())
os.remove("Mods/FishTune/Saved/keep.json")

say("\n-- 2e'. watching (read only): size, the dino, what is left where the fish went --")
H.log = {}
pos.X = 1020000
local wf = assert(io.open("Mods/FishTune/Saved/watch.json", "w"))
wf:write(json.encode({ enabled = true, classes = { "BP_Coalecanth_C" }, nearM = 30 })); wf:close()
croc.__props.Growth, croc.__props.Hunger, croc.__props.MaxHunger = 0.28, 1.8, 13.5
poll.fn()
local function logged(t) for _, l in ipairs(H.log) do if l:find(t, 1, true) then return l end end end
check("200 m away: not announced yet", logged("fish near") == nil, table.concat(H.log, " | "))
pos.X = pos.X + 20000   -- 200 m in one look
poll.fn()
check("a jump is logged as moved by the game", logged("fish moved, BP_Coalecanth_C jumped 200 m") ~= nil, table.concat(H.log, " | "))
pos.X = 1000500          -- 5 m from the crocodile
poll.fn()
local near = logged("fish near, BP_Coalecanth_C size 1.40/1.40/1.40, 5 m from 76561190000000009")
check("near a player: size and the dino logged", near ~= nil and near:find("BP_Deinosuchus_C 0.28, stomach 1.8/13.5", 1, true) ~= nil,
      table.concat(H.log, " | "))
poll.fn()
local nNear = 0
for _, l in ipairs(H.log) do if l:find("fish near", 1, true) then nNear = nNear + 1 end end
check("announced once", nNear == 1)
check("watching writes nothing on the fish", rawget(coel, "DespawnDelaySeconds") == 25)
local body = H.makePawn({ class = "BP_Coalecanth_C", loc = { X = 1000600, Y = 0, Z = 0 }, health = 0 })
lake = {}                -- bitten: gone
_G.FindAllOf = function(c)
  if c == "TIAmbientFish" then return lake end
  if c == "PlayerController" then return { crocCtrl } end
  if c == "Pawn" then return { croc, body } end
  return {}
end
poll.fn()
local gone = logged("fish gone, BP_Coalecanth_C size 1.40/1.40/1.40")
check("gone next to the player: logged with the dino", gone ~= nil and gone:find("5 m from 76561190000000009 (BP_Deinosuchus_C", 1, true) ~= nil, gone)
croc.__props.Hunger = 11.2
H.advance(2000)
local look = logged("watch +2 s")
check("2 s later: the stomach change and what is at the spot (not the player)", look ~= nil and look:find("stomach +9.4", 1, true) ~= nil
      and look:find("pawn BP_Coalecanth_C hp 0 at 1 m", 1, true) ~= nil and look:find("Deinosuchus_C hp", 1, true) == nil, look)
H.advance(10000)
check("looks at 6 and 12 s too", logged("watch +6 s") ~= nil and logged("watch +12 s") ~= nil)
os.remove("Mods/FishTune/Saved/watch.json")
_G.FindAllOf = function(c)
  if c == "TIAIWorldSpawner" then return { spawnerObj } end
  if c == "TIAmbientFish" then return lake end
  if c == "PlayerController" then return { crocCtrl } end
  return {}
end

say("\n-- 2f. a fresh fish next to a player is not kept; turning keep off hands every kept fish back --")
local byMe, away = swimmer(1001000), swimmer(1100000)   -- 10 m and 1 km from the crocodile
lake = { byMe, away }
kf = assert(io.open("Mods/FishTune/Saved/keep.json", "w"))
kf:write(json.encode({ enabled = true, despawnDelay = 3600, maxTotal = 60 })); kf:close()
clock = clock + 301
poll.fn()
check("next to a player: left alone", rawget(byMe, "DespawnDelaySeconds") == 25)
check("1 km away: kept", rawget(away, "DespawnDelaySeconds") == 3600)
kf = assert(io.open("Mods/FishTune/Saved/keep.json", "w")); kf:write(json.encode({ enabled = false })); kf:close()
poll.fn()
check("keep off: the kept one handed back", rawget(away, "DespawnDelaySeconds") == 25)
os.remove("Mods/FishTune/Saved/keep.json")

say("\n-- 3. a run that stopped during a write: no more writes --")
H.reset()
local fl = assert(io.open("Mods/FishTune/Saved/writing.flag", "w")); fl:close()
f = assert(io.open("Mods/FishTune/Saved/apply.json", "w")); f:write(json.encode({ id = "a2", perPlayer = 30 })); f:close()
dofile(RUN .. "/Mods/FishTune/Scripts/main.lua")
H.gameLoops[1].fn()
check("blocked: nothing written", spawnerObj.MaxAmbientFishPerPlayer == 12)
os.remove("Mods/FishTune/Saved/ENABLED"); os.remove("Mods/FishTune/Saved/writing.flag"); os.remove("Mods/FishTune/Saved/apply.json")

check("never off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))
say(string.format("=== FishTune: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
