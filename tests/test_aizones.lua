-- AIZones against the mock UE4SS: a zone is always kept at its minimum; with a
-- player inside, each turn adds a random few at different spots, up to its
-- maximum and the server-wide cap; with a brain, replicated, grown; nothing is
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
-- As on Windows (Wine): a rename does not replace an existing file.
local realRename = os.rename
os.rename = function(from, to)
  local f = io.open(to, "r")
  if f then f:close(); return nil, to .. ": file exists" end
  return realRename(from, to)
end
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
    max = 3, min = 1, perTurnMin = 2, perTurnMax = 2, every = 60, growthMin = 1, growthMax = 1,
    species = { { key = "Boar", cls = "BP_Boar_C", pawn = BOAR, ctrl = BOAR_AI, kind = "animal", lift = 100 } },
    points = { { 50000, 100, 2000 }, { 56000, -200, 2100 }, { 44000, 300, 1900 } },
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

say("\n-- 2. a player in the zone: each turn adds perTurn, at different spots, up to max --")
writeZones({ enabled = true, globalMax = 60, zones = { zone() } })
reader.fn()
step()
check("perTurn 2 boars this turn", spawns() == 2, tostring(spawns()))
check("each gets its brain", H.countCalls("Possess") == 2)
check("replicated", H.countCalls("SetReplicates") == 2 and H.countCalls("ForceNetUpdate") == 2)
local spots = {}
for _, c in ipairs(H.calls) do
  if c.what == "SpawnActor" and not c.args[1]:match("Controller$") then spots[#spots + 1] = c.args[2] end
end
check("at a known point, lifted, level", spots[1] and spots[1].Z >= 1900 + 100)
check("two different spots", spots[2] and (spots[1].X ~= spots[2].X or spots[1].Y ~= spots[2].Y))
check("not on top of the player (the spot 1 m from them is used last)",
  spots[1] and spots[2] and spots[1].X ~= 50000 and spots[2].X ~= 50000)
step(10)
check("not again before 'every' (60 s)", spawns() == 2)
step(60)
check("max 3: only one more", spawns() == 3, tostring(spawns()))
step(60)
check("full: no more", spawns() == 3)

say("\n-- 3. the minimum is always there, player or not --")
fresh()
playerAt(500000)                                   -- 4.5 km away
step(12)
check("empty zone: min 1 spawned", spawns() == 1, tostring(spawns()))
step(120)
check("stays at min (no turns while empty)", spawns() == 1)
table.remove(aiPawns, 1)                           -- someone ate it
step(12)
check("eaten: topped up at once, not after 'every'", spawns() == 2, tostring(spawns()))
playerAt(50000)
step(12)
check("a player arrives: a turn right away (+2)", spawns() == 4, tostring(spawns()))

say("\n-- 3b. a top-up is a few per tick; a turn is a random count in the range --")
fresh()
playerAt(500000)
writeZones({ enabled = true, globalMax = 5000, zones = { zone({ id = "zm", min = 8, max = 8 }) } })
reader.fn()
step(12)
check("min 8: 5 in the first tick", spawns() == 5, tostring(spawns()))
step(12)
check("…the other 3 in the next", spawns() == 8, tostring(spawns()))
fresh()
playerAt(50000)
writeZones({ enabled = true, globalMax = 5000, zones = { zone({ id = "zr", min = 0, max = 150, perTurnMin = 2, perTurnMax = 4 }) } })
reader.fn()
local seen, inRange, before = {}, true, 0
for _ = 1, 20 do
  step(60)
  local n = spawns() - before
  before = spawns()
  if n < 2 or n > 4 then inRange = false end
  seen[n] = true
end
local kinds = 0
for _ in pairs(seen) do kinds = kinds + 1 end
check("every turn 2–4", inRange)
check("…and not always the same number", kinds >= 2)

say("\n-- 4. the server-wide cap counts ALL living AI, the game's own too --")
fresh()
-- Two AI the game made itself (not ours), and one corpse (does not count).
for _, x in ipairs({ 900000, 910000 }) do
  aiPawns[#aiPawns + 1] = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Deer.BP_Deer_C", loc = { X = x, Y = 0, Z = 0 } })
end
aiPawns[#aiPawns + 1] = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Deer.BP_Deer_C", health = 0, loc = { X = 920000, Y = 0, Z = 0 } })
writeZones({ enabled = true, globalMax = 5, zones = { zone({ id = "zc", min = 0, max = 50, perTurnMin = 5, perTurnMax = 5 }) } })
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
writeZones({ enabled = true, globalMax = 60, zones = { zone({ id = "z2", max = 1, perTurnMin = 1, perTurnMax = 1, growthMin = 0.75, growthMax = 0.75,
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

say("\n-- 5b. nobody online: the game state's world; an old file's idleMax is the min --")
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
local old = zone({ id = "z3", perTurn = 5, idleMax = 2 })
old.min, old.perTurnMin, old.perTurnMax = nil, nil, nil
writeZones({ enabled = true, globalMax = 60, zones = { old } })
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
check("status.json: enabled, the zone with its count, min, max and limit", st and st.enabled == true and st.zones.z3
  and st.zones.z3.count == 2 and st.zones.z3.min == 2 and st.zones.z3.max == 3 and st.zones.z3.limit == 2
  and st.zones.z3.occupied == false, st and json.encode(st) or "no file")
playerAt(500000)
step(5)
reader.fn()
f = io.open(STATUS, "r")
st = f and json.decode(f:read("*a"))
if f then f:close() end
check("…kept between scans", st and st.zones.z3 and st.zones.z3.count == 2, st and json.encode(st) or "no file")
check("…and the spawn counters", st and st.zones.z3.spawned == 2)

say("\n-- 5c. spacing: no new AI closer than `spacing` to a living one --")
fresh()
playerAt(500000)
-- A deer the game made, standing on the first spot.
aiPawns[#aiPawns + 1] = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Deer.BP_Deer_C", loc = { X = 50000, Y = 100, Z = 2000 } })
writeZones({ enabled = true, globalMax = 60, zones = { zone({ id = "zs", min = 3, max = 3, spacing = 4000 }) } })
reader.fn()
step(12)
local onDeer = false
for _, c in ipairs(H.calls) do
  if c.what == "SpawnActor" and not c.args[1]:match("Controller$") and c.args[2].X == 50000 then onDeer = true end
end
check("min 3 but only 2 spots 40 m clear of other AI: 2", spawns() == 2, tostring(spawns()))
check("nothing next to the deer", not onDeer)
step(12)
check("no crowding later either", spawns() == 2, tostring(spawns()))

say("\n-- 5d. drop N AI next to a player, from the panel --")
local drops = nil
for _, l in ipairs(H.gameLoops) do if l.ms == 2000 then drops = l end end
check("a 2 s game-thread drop poll", drops ~= nil)
fresh()
writeZones({ enabled = false, globalMax = 0, zones = {} })   -- drops do not need zones on
reader.fn()
playerAt(100000)
local DROPS = RUN .. "/Mods/AIZones/Saved/drops.json"
local DONE = RUN .. "/Mods/AIZones/Saved/drops.done.json"
local function writeDrops(t) local f = assert(io.open(DROPS, "w")); f:write(json.encode({ drops = t })); f:close() end
local function readDone() local f = io.open(DONE, "r"); if not f then return nil end; local d = json.decode(f:read("*a")); f:close(); return d end
local rex = { key = "Rex", cls = "BP_Tyrannosaurus_C", pawn = REX, ctrl = REX_AI, kind = "dino", lift = 300 }
writeDrops({
  { id = 1, steamId = "76561190000000001", count = 2, distanceM = 30, growth = 0.5, sp = rex, expiresAt = clock + 30,
    spots = { { 100500, 0, 2000 }, { 103000, 0, 2000 }, { 103200, 0, 2000 }, { 97000, 0, 2000 }, { 120000, 0, 2000 } } },
})
drops.fn()
local at = {}
for _, c in ipairs(H.calls) do
  if c.what == "SpawnActor" and not c.args[1]:match("Controller$") then at[#at + 1] = c.args[2].X end
end
table.sort(at)
check("2 dropped ~30 m away, apart, not on the player", #at == 2 and at[1] == 97000 and at[2] == 103000, table.concat(at, ","))
local g = nil
for _, c in ipairs(H.calls) do if c.what == "SetGrowth" then g = c.args[1] end end
check("at the asked growth", g == 0.5, tostring(g))
local d = readDone()
check("done: id 1 ok, 2 made", d and d.lastId == 1 and d.results[1].ok == true and d.results[1].made == 2, d and json.encode(d) or "no file")
drops.fn()
check("run once only", spawns() == 2, tostring(spawns()))
writeDrops({
  { id = 2, steamId = "76561190000000001", count = 1, distanceM = 30, growth = 1, sp = rex, expiresAt = clock - 1, spots = { { 103000, 0, 2000 } } },
  { id = 3, steamId = "76561190000000099", count = 1, distanceM = 30, growth = 1, sp = rex, expiresAt = clock + 30, spots = { { 103000, 0, 2000 } } },
})
drops.fn()
d = readDone()
check("expired and offline: refused, nothing spawned", spawns() == 2 and d and d.lastId == 3
  and d.results[2].error == "expired" and d.results[3].ok == false, d and json.encode(d) or "no file")

say("\n-- 5e. a drop right beside the player: round them, at their height --")
local before = spawns()
playerAt(100000)
writeDrops({
  { id = 4, steamId = "76561190000000001", count = 3, distanceM = 3, growth = 1, sp = rex, expiresAt = clock + 30, spots = {} },
})
drops.fn()
local around, ok3 = {}, true
for _, c in ipairs(H.calls) do
  if c.what == "SpawnActor" and not c.args[1]:match("Controller$") then around[#around + 1] = c.args[2] end
end
for k = #around - 2, #around do
  local p = around[k]
  local dist = p and math.sqrt((p.X - 100000) ^ 2 + p.Y ^ 2)
  if not (dist and math.abs(dist - 300) < 1 and p.Z == 100 + 300) then ok3 = false end
end
check("3 dropped 3 m around the player, at their height + lift", spawns() - before == 3 and ok3, tostring(spawns() - before))
local p1, p2 = around[#around], around[#around - 1]
check("…not on the same spot", p1 and p2 and (math.abs(p1.X - p2.X) > 1 or math.abs(p1.Y - p2.Y) > 1))

say("\n-- 5f. reset: kill (never destroy) the AI, a batch per poll; players' dinos untouched --")
fresh()
local aiCtrl = { IsValid = function() return true end,
  GetClass = function() return { GetFName = function() return FName("TIAIBoarController") end } end }
local function aiPawn(cls)
  local p = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/" .. cls .. "." .. cls .. "_C", loc = { X = 900000, Y = 0, Z = 0 } })
  H.attachController(p, aiCtrl)
  aiPawns[#aiPawns + 1] = p
  return p
end
for _ = 1, 30 do aiPawn("BP_Boar") end
for _ = 1, 2 do aiPawn("BP_Deer") end
-- A dino left in the world by a player who logged out: no controller.
local body = H.makePawn({ loc = { X = 910000, Y = 0, Z = 0 } })
aiPawns[#aiPawns + 1] = body
local function alive(cls)
  local n = 0
  for _, p in ipairs(aiPawns) do
    if p:GetHealth() > 0 and (cls == nil or p:GetClass():GetFName():ToString():find(cls, 1, true)) then n = n + 1 end
  end
  return n
end
writeDrops({ { id = 10, kind = "reset", classes = {}, expiresAt = clock + 30 } })
drops.fn()
check("first poll: 25 killed", alive("BP_Boar") + alive("BP_Deer") == 7, tostring(alive("BP_Boar") + alive("BP_Deer")))
d = readDone()
check("…not reported until done", d and d.lastId == 10 and d.results[#d.results].id ~= 10)
drops.fn()
d = readDone()
check("next poll: the rest; reported with the count", alive("BP_Boar") + alive("BP_Deer") == 0
  and d.results[#d.results].id == 10 and d.results[#d.results].made == 32, d and json.encode(d.results[#d.results]))
check("the logged-out player's dino and the online one untouched", body:GetHealth() > 0 and playerPawn:GetHealth() > 0)
check("killed, not destroyed", H.countCalls("K2_DestroyActor") == 0)
for _ = 1, 3 do aiPawn("BP_Boar") end
for _ = 1, 2 do aiPawn("BP_Deer") end
writeDrops({ { id = 11, kind = "reset", classes = { "BP_Deer_C" }, expiresAt = clock + 30 } })
drops.fn()
d = readDone()
check("only the chosen kind", alive("BP_Deer") == 0 and alive("BP_Boar") == 3 and d.results[#d.results].made == 2,
  tostring(alive("BP_Boar")))
for _ = 1, 2 do aiPawn("BP_Rabbit") end
writeDrops({ { id = 12, kind = "reset", classes = {}, keep = { "BP_Boar_C", "BP_Deer_C" }, expiresAt = clock + 30 } })
drops.fn()
d = readDone()
check("keep the zones' kinds: the rabbits go, the boars stay", alive("BP_Rabbit") == 0 and alive("BP_Boar") == 3
  and d.results[#d.results].made == 2, tostring(alive("BP_Rabbit")) .. "/" .. tostring(alive("BP_Boar")))

say("\n-- 5g. a zone of any outline (a strip of beach): inside means inside the outline --")
fresh()
-- 400 m along X, 40 m across; the circle around it reaches 200 m.
local strip = zone({ id = "zp", min = 0, max = 5, perTurnMin = 1, perTurnMax = 1, radius = 20100,
  poly = { { 30000, -2000 }, { 70000, -2000 }, { 70000, 2000 }, { 30000, 2000 } },
  points = { { 50000, 0, 2000 }, { 62000, 500, 2000 } } })
writeZones({ enabled = true, globalMax = 60, zones = { strip } })
reader.fn()
playerAt(50000)
playerPawn.__props.Loc = { X = 50000, Y = 10000, Z = 100 }   -- 100 m off the strip, inside its circle
step(60)
check("beside the strip (inside its circle): not 'in the zone', no turn", spawns() == 0, tostring(spawns()))
playerPawn.__props.Loc = { X = 45000, Y = 0, Z = 100 }        -- on the strip
step(60)
check("on the strip: a turn", spawns() == 1, tostring(spawns()))
-- Counted only inside the outline: a boar beside the strip is not the zone's.
aiPawns[#aiPawns + 1] = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Boar.BP_Boar_C", loc = { X = 50000, Y = 9000, Z = 0 } })
step(60)
reader.fn()
local fz = io.open(STATUS, "r")
local sz = fz and json.decode(fz:read("*a"))
if fz then fz:close() end
check("status: the zone counts the boars on the strip only", sz and sz.zones.zp and sz.zones.zp.count == 2 and sz.zones.zp.occupied == true,
  sz and json.encode(sz.zones.zp) or "no status")

say("\n-- threads --")
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ", "))

say(string.format("=== AIZones: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
