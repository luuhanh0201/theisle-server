-- AIZones against the mock UE4SS: zones spawn only near players, up to their
-- maximum and the server-wide cap, with a brain, replicated, grown; nothing is
-- ever destroyed; the engine is touched only on the game thread.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

os.execute('mkdir -p "' .. RUN .. '/Mods/AIZones/Saved"')
local ZONES = RUN .. "/Mods/AIZones/Saved/zones.json"
local STATUS = RUN .. "/Mods/AIZones/Saved/status.json"
local function writeZones(t)
  local f = assert(io.open(ZONES, "w")); f:write(json.encode(t)); f:close()
end

-- The world: classes by path, SpawnActor makes fake pawns / controllers.
local BOAR = "/Game/TheIsle/Core/Characters/Animals/Boar/BP_Boar.BP_Boar_C"
local BOAR_AI = "/Script/TheIsle.TIAIBoarController"
local REX = "/Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C"
local REX_AI = "/Script/TheIsle.TIAIRexController"
local classes = {}
for _, p in ipairs({ BOAR, BOAR_AI, REX, REX_AI }) do
  classes[p] = { _path = p, IsValid = function() return true end }
end
_G.StaticFindObject = function(path) H.touch("StaticFindObject"); return classes[path] end

local aiPawns = {}          -- what FindAllOf("Pawn") sees besides the player
local blocked = 0           -- the next N pawn spawns are blocked by terrain
local world = {
  IsValid = function() return true end,
  SpawnActor = function(_, cls, loc, rot)
    H.touch("SpawnActor")
    H.record("SpawnActor", cls._path, loc, rot)
    if cls._path:match("Controller$") then
      return setmetatable({}, { __index = function(_, k)
        H.touch("ctrl." .. k)
        if k == "GetAddress" then return function() return 777 end end
        if k == "Possess" then return function(_, p) H.record("Possess", p) end end
      end })
    end
    if blocked > 0 then
      blocked = blocked - 1
      return setmetatable({}, { __index = function(_, k) if k == "GetAddress" then return function() return 0 end end end })
    end
    local p = H.makePawn({ class = "BlueprintGeneratedClass " .. cls._path, loc = { X = loc.X, Y = loc.Y, Z = loc.Z } })
    rawset(p, "SetReplicates", function(_, v) H.record("SetReplicates", v) end)
    rawset(p, "ForceNetUpdate", function() H.record("ForceNetUpdate") end)
    rawset(p, "K2_DestroyActor", function() H.record("K2_DestroyActor") end)
    aiPawns[#aiPawns + 1] = p
    return p
  end,
}

local playerPawn = H.makePawn({ loc = { X = 0, Y = 0, Z = 100 } })
rawset(playerPawn, "GetWorld", function() H.touch("GetWorld"); return world end)
local player = H.makeCtrl("76561190000000001", playerPawn)
H.attachController(playerPawn, player)
_G.FindAllOf = function(cls)
  H.touch("FindAllOf")
  if cls == "PlayerController" then return { player } end
  local all = { playerPawn }
  for _, p in ipairs(aiPawns) do all[#all + 1] = p end
  return all
end

local function zone(over)
  local z = {
    id = "z1", name = "Test", enabled = true, x = 50000, y = 0, radius = 20000,
    max = 3, idleMax = 1, perTurn = 2, every = 60, growthMin = 1, growthMax = 1,
    species = { { key = "Boar", cls = "BP_Boar_C", pawn = BOAR, ctrl = BOAR_AI, kind = "animal", lift = 100 } },
    points = { { 50000, 100, 2000 }, { 51000, -200, 2100 }, { 49000, 300, 1900 } },
  }
  for k, v in pairs(over or {}) do z[k] = v end
  return z
end
local function playerAt(x) playerPawn.__props.Loc = { X = x, Y = 0, Z = 100 } end
local function fresh() H.calls = {}; aiPawns = {} end

writeZones({ enabled = false, globalMax = 60, zones = { zone() } })
dofile(RUN .. "/Mods/AIZones/Scripts/main.lua")
local turn = nil
for _, l in ipairs(H.gameLoops) do if l.ms == 5000 then turn = l end end
local reader = H.loops[1]
check("a 5 s game-thread turn and an async file loop", turn ~= nil and reader ~= nil)

local function spawns() return H.countCalls("SpawnActor") / 2 end   -- pawn + controller
local clock = 1000
os.time = function() return clock end
local function step(seconds) clock = clock + (seconds or 60); turn.fn() end

say("\n-- 1. off until the panel turns it on --")
playerAt(50000)
step()
check("nothing spawned while disabled", H.countCalls("SpawnActor") == 0)

say("\n-- 2. a player in the zone: it fills up to max --")
writeZones({ enabled = true, globalMax = 60, zones = { zone() } })
reader.fn()
step()
check("perTurn = 2 boars this turn", spawns() == 2, tostring(spawns()))
check("each gets its brain", H.countCalls("Possess") == 2)
check("replicated", H.countCalls("SetReplicates") == 2 and H.countCalls("ForceNetUpdate") == 2)
local first = nil
for _, c in ipairs(H.calls) do if c.what == "SpawnActor" then first = c; break end end
check("at a known point, lifted, level", first and first.args[2].Z >= 1900 + 100 and first.args[3].Pitch == 0)
step(10)
check("not again before 'every' (60 s)", spawns() == 2)
step(60)
check("max 3: only one more", spawns() == 3, tostring(spawns()))
step(60)
check("full: no more", spawns() == 3)

say("\n-- 3. nobody in the zone: it still lives, up to idleMax --")
fresh()
playerAt(500000)                                   -- 4.5 km away
step(120)
check("idleMax 1 with the zone empty", spawns() == 1, tostring(spawns()))
step(120)
check("stays at idleMax", spawns() == 1)
playerAt(50000)
step(120)
check("a player arrives: up to max (+2 this turn)", spawns() == 3, tostring(spawns()))

say("\n-- 4. the server-wide cap counts ALL living AI, the game's own too --")
fresh()
-- Two AI the game made itself (not ours), and one corpse (does not count).
for _, x in ipairs({ 900000, 910000 }) do
  aiPawns[#aiPawns + 1] = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Deer.BP_Deer_C", loc = { X = x, Y = 0, Z = 0 } })
end
aiPawns[#aiPawns + 1] = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Deer.BP_Deer_C", health = 0, loc = { X = 920000, Y = 0, Z = 0 } })
writeZones({ enabled = true, globalMax = 5, zones = { zone({ max = 50, perTurn = 5 }) } })
reader.fn()
step(120)
check("cap 5 with 2 of the game's alive: 3 added", spawns() == 3, tostring(spawns()))
step(120)
check("at the cap: nothing more", spawns() == 3)
-- Players eat two: room for two again.
table.remove(aiPawns, 1); table.remove(aiPawns, 1)
step(120)
check("two eaten: two more", spawns() == 5, tostring(spawns()))

say("\n-- 5. dinos: grown after Possess, vitals refilled; blocked spots are skipped --")
fresh()
blocked = 2
writeZones({ enabled = true, globalMax = 60, zones = { zone({ id = "z2", max = 1, perTurn = 1, growthMin = 0.75, growthMax = 0.75,
  species = { { key = "Rex", cls = "BP_Tyrannosaurus_C", pawn = REX, ctrl = REX_AI, kind = "dino", lift = 300 } } }) } })
reader.fn()
step(120)
local order = H.callNames()
local function idx(n) for i, v in ipairs(order) do if v == n then return i end end end
check("two blocked spots, the third works", #aiPawns == 1, tostring(#aiPawns))
check("SetGrowth(0.75) after Possess", idx("Possess") and idx("SetGrowth") and idx("Possess") < idx("SetGrowth"))
local grown = nil
for _, c in ipairs(H.calls) do if c.what == "SetGrowth" then grown = c.args[1] end end
check("growth as set on the zone", grown == 0.75, tostring(grown))
check("vitals set after growth", idx("SetHealth") and idx("SetHealth") > idx("SetGrowth"))

say("\n-- 5b. nobody online: the game state's world, idle limit --")
local gsWorldAsked = false
_G.FindFirstOf = function(cls)
  H.touch("FindFirstOf")
  if cls == "TIGameStateBase" then
    return { IsValid = function() return true end, GetWorld = function() gsWorldAsked = true; return world end }
  end
end
local savedFind = _G.FindAllOf
_G.FindAllOf = function(cls)
  H.touch("FindAllOf")
  if cls == "PlayerController" then return {} end
  return aiPawns
end
fresh()
writeZones({ enabled = true, globalMax = 60, zones = { zone({ id = "z3", idleMax = 2, perTurn = 5 }) } })
reader.fn()
step(120)
check("spawns with nobody online, up to idleMax 2", spawns() == 2 and gsWorldAsked, tostring(spawns()))
_G.FindAllOf = savedFind

say("\n-- 6. never destroys, never bAlwaysRelevant --")
check("no K2_DestroyActor ever", H.countCalls("K2_DestroyActor") == 0)
local relevant = false
for _, p in ipairs(aiPawns) do if rawget(p, "bAlwaysRelevant") ~= nil then relevant = true end end
check("bAlwaysRelevant never set", not relevant)

say("\n-- 7. status for the panel --")
reader.fn()
local f = io.open(STATUS, "r")
local st = f and json.decode(f:read("*a"))
if f then f:close() end
check("status.json: enabled, the zone with its count and limit", st and st.enabled == true and st.zones.z3
  and st.zones.z3.count == 2 and st.zones.z3.limit == 2 and st.zones.z3.occupied == false, st and json.encode(st) or "no file")
check("…and the spawn counters", st and st.zones.z3.spawned == 2)

say("\n-- threads --")
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ", "))

say(string.format("=== AIZones: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
