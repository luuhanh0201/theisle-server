-- PteraCarry: a flying Pteranodon grabs a light player's dino (the game's own
-- GrabPhysicsCharacter call), carries it under itself, lets go on landing /
-- !drop / time up; too heavy, off, cooldown; nothing touched off the game thread.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

os.execute('mkdir -p "' .. RUN .. '/Mods/PteraCarry/Saved"')
local SETTINGS = RUN .. "/Mods/PteraCarry/Saved/settings.json"
local function writeSettings(t)
  local f = assert(io.open(SETTINGS, "w")); f:write(json.encode(t)); f:close()
end
local clock = 1000
os.time = function() return clock end

local PTERA = "BlueprintGeneratedClass /Game/X/BP_Pteranodon.BP_Pteranodon_C"
local ptera = H.makePawn({ class = PTERA, weight = 90, loc = { X = 0, Y = 0, Z = 5000 }, grounded = false })
local pc = H.makeCtrl("76561190000000001", ptera, "Ptera")
H.attachController(ptera, pc)
local troo = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Troodon.BP_Troodon_C", weight = 40, loc = { X = 300, Y = 0, Z = 4800 } })
local tc = H.makeCtrl("76561190000000002", troo, "Troodon")
H.attachController(troo, tc)
local rex = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Tyrannosaurus.BP_Tyrannosaurus_C", weight = 7000, loc = { X = 500, Y = 0, Z = 4700 } })
local rc = H.makeCtrl("76561190000000003", rex, "Rex")
H.attachController(rex, rc)
_G.FindAllOf = function(c) if c == "PlayerController" then return { pc, tc, rc } end; return { ptera, troo, rex } end

writeSettings({ enabled = true, maxKg = 150, maxSeconds = 20, cooldown = 30, hintMeters = 10, belowCm = 300 })
dofile(RUN .. "/Mods/PteraCarry/Scripts/main.lua")
local hold, hint
for _, l in ipairs(H.gameLoops) do
  if l.ms == 100 then hold = l elseif l.ms == 1000 then hint = l end
end
check("hook registered, two game-thread loops", H.hooks["/Script/TheIsle.TICharacterBase:GrabPhysicsCharacter"] ~= nil and hold and hint)

local P = function(v) return { get = function() return v end } end
local function grab(who, what) H.fire("/Script/TheIsle.TICharacterBase:GrabPhysicsCharacter", P(who), P(what)) end
local function last(ctrl) local m = ctrl._messages; return m[#m] or "" end

say("\n-- 1. a hint when a light player is within reach --")
hint.fn()
check("the ptera is told it can grab the Troodon (40 kg), not the Rex", last(pc):find("Có thể gắp Troodon (40 kg)", 1, true) ~= nil, last(pc))
local n = #pc._messages
hint.fn()
check("…once, not every second", #pc._messages == n)

say("\n-- 2. the game's grab starts a carry; the target follows under the ptera --")
local offBefore = H.offThreadAccess
grab(ptera, troo)
check("the hook itself touched nothing but the addresses", #H.calls == 0 or H.countCalls("K2_SetActorLocation") == 0)
hold.fn()
check("carrier and target told", last(pc):find("Đang gắp Troodon (40 kg)", 1, true) ~= nil and last(tc):find("gắp đi", 1, true) ~= nil, last(pc))
check("the game's own picked-up flag set", H.countCalls("SetIsBeingPickedUp") == 1)
ptera.__props.Loc = { X = 10000, Y = 2000, Z = 6000 }
hold.fn()
local moved = nil
for _, c in ipairs(H.calls) do if c.what == "K2_SetActorLocation" then moved = c.args[1] end end
check("put 3 m under the ptera, as a teleport", moved and moved.X == 10000 and moved.Y == 2000 and moved.Z == 5700, moved and (moved.X .. "," .. moved.Z))
check("its fall speed cleared", H.countCalls("StopMovementImmediately") >= 1)
check("never off the game thread", H.offThreadAccess == offBefore, table.concat(H.offThreadWhat, ","))

say("\n-- 3. landing lets go (not in the first second) --")
clock = clock + 5
ptera.__props.Grounded = true
hold.fn()
check("landed: dropped, both told", last(pc):find("Đã thả Troodon", 1, true) ~= nil and last(tc):find("thả bạn", 1, true) ~= nil, last(pc))
local flags = {}
for _, c in ipairs(H.calls) do if c.what == "SetIsBeingPickedUp" then flags[#flags + 1] = tostring(c.args[1]) end end
check("the flag set back", flags[#flags] == "false", table.concat(flags, ","))

say("\n-- 4. cooldown, then too heavy, then time up and !drop --")
ptera.__props.Grounded = false
grab(ptera, troo)
hold.fn()
check("cooling down (30 s)", last(pc):find("Gắp đang hồi", 1, true) ~= nil, last(pc))
clock = clock + 40
grab(ptera, rex)
hold.fn()
check("the Rex (7000 kg) is too heavy", last(pc):find("Tyrannosaurus nặng 7000 kg", 1, true) ~= nil, last(pc))
grab(ptera, troo)
hold.fn()
clock = clock + 21
hold.fn()
check("time up after maxSeconds", last(pc):find("Đã thả", 1, true) ~= nil, last(pc))
clock = clock + 40
grab(ptera, troo)
hold.fn()
H.chat("/Script/TheIsle.TIPlayerController:GetChatMessage", pc, pc, "!drop")
H.advance(10)
hold.fn()
check("!drop lets go", last(pc):find("Đã thả", 1, true) ~= nil, last(pc))

say("\n-- 5. only a Pteranodon carries; off on the panel does nothing --")
clock = clock + 40
grab(troo, ptera)
hold.fn()
check("a Troodon's grab is not a carry", last(tc):find("Đang gắp", 1, true) == nil)
writeSettings({ enabled = false })
clock = clock + 10
grab(ptera, troo)
hold.fn()
check("off: no carry", last(pc):find("Đang gắp", 1, true) == nil or last(pc):find("Đã thả", 1, true) ~= nil, last(pc))

say(string.format("=== PteraCarry: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
