-- ZoneGuard: a dino grown past its species' limit inside a guarded zone is
-- warned, stung after the grace (pct of its max health every `every` s) until
-- it leaves; small ones, other zones and "off" are left alone; stepping out and
-- back in keeps the clock; all on the game thread.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

os.execute('mkdir -p "' .. RUN .. '/Mods/ZoneGuard/Saved"')
local RULES = "Mods/ZoneGuard/Saved/guard.json"
local function rules(t) local f = assert(io.open(RULES, "w")); f:write(json.encode(t)); f:close() end
local clock = 1000
os.time = function() return clock end

-- A square sanctuary 0..10000 (100 m) and a circle zone far away.
local SQUARE = { name = "Sanctuary 67", kind = "sanctuary", x = 5000, y = 5000, radius = 7072,
  poly = { { 0, 0 }, { 10000, 0 }, { 10000, 10000 }, { 0, 10000 } } }
local CIRCLE = { name = "Đồng cỏ", kind = "ai", x = 100000, y = 0, radius = 3000 }
local BASE = { enabled = true, grace = 30, every = 5, pct = 10, defaultMax = 0.5, max = { Carnotaurus = 0.3 }, zones = { SQUARE, CIRCLE } }
rules(BASE)

local carno = H.makePawn({ class = "BP_Carnotaurus_C", growth = 0.4, loc = { X = 5000, Y = 5000, Z = 0 } })
local cc = H.makeCtrl("76561190000000001", carno)
local troo = H.makePawn({ class = "BP_Troodon_C", growth = 0.4, loc = { X = 5000, Y = 5000, Z = 0 } })
local tc = H.makeCtrl("76561190000000002", troo)
_G.FindAllOf = function(c) if c == "PlayerController" then return { cc, tc } end; return {} end

dofile(RUN .. "/Mods/ZoneGuard/Scripts/main.lua")
local tick
for _, l in ipairs(H.gameLoops) do if l.ms == 1000 then tick = l end end
check("one game-thread loop", tick ~= nil)
local function last(ctrl) local m = ctrl._messages; return m[#m] or "" end
local function step(s) clock = clock + s; tick.fn() end

say("\n-- 1. the warning --")
tick.fn()
check("a Carnotaurus at 40% (limit 30%) is warned, with the zone and both numbers",
  last(cc):find("Sanctuary 67", 1, true) and last(cc):find("40%", 1, true) and last(cc):find("30%", 1, true) and last(cc):find("30 giây", 1, true), last(cc))
check("a Troodon at 40% (default 50%) is left alone", #tc._messages == 0)
local warned = #cc._messages
step(1)
check("warned once, not every tick", #cc._messages == warned)

say("\n-- 2. the stings --")
step(28)
check("no sting before the grace", carno.__props.Health == 100, tostring(carno.__props.Health))
step(1)
check("after the grace: 10% of the max health off", carno.__props.Health == 90, tostring(carno.__props.Health))
check("…and told it is being stung", last(cc):find("ong đốt", 1, true) and last(cc):find("10%", 1, true), last(cc))
local told = #cc._messages
step(2)
check("not again before `every`", carno.__props.Health == 90)
step(3)
check("again after `every`", carno.__props.Health == 80, tostring(carno.__props.Health))
check("the sting message only once", #cc._messages == told)

say("\n-- 3. out and back in --")
carno.__props.Loc = { X = 20000, Y = 20000, Z = 0 }
step(5)
check("outside the square (in its bounding circle's reach or not): no sting", carno.__props.Health == 80)
carno.__props.Loc = { X = 5000, Y = 5000, Z = 0 }
step(5)
check("back within a minute: no fresh warning, stung at once", carno.__props.Health == 70 and #cc._messages == told,
  tostring(carno.__props.Health) .. " " .. #cc._messages)
carno.__props.Loc = { X = 20000, Y = 20000, Z = 0 }
step(5); step(61)
carno.__props.Loc = { X = 5000, Y = 5000, Z = 0 }
step(1)
check("back after more than a minute: warned again, grace again", carno.__props.Health == 70 and #cc._messages == told + 1)

say("\n-- 4. small enough, polygon, other zone, off --")
carno.__props.Growth = 0.3
step(40)
check("at its limit: left alone", carno.__props.Health == 70)
carno.__props.Growth = 0.4
carno.__props.Loc = { X = 9000, Y = 1000, Z = 0 }     -- inside the square
troo.__props.Growth = 0.9
troo.__props.Loc = { X = 100000, Y = 2000, Z = 0 }    -- in the circle zone
local tWarn = #tc._messages
step(1)
check("the circle zone guards too (a grown Troodon)", #tc._messages == tWarn + 1 and last(tc):find("Đồng cỏ", 1, true), last(tc))
troo.__props.Loc = { X = 100000, Y = 3500, Z = 0 }    -- just outside the circle
step(40)
check("outside the circle: not stung", troo.__props.Health == 100, tostring(troo.__props.Health))
carno.__props.Loc = { X = 10500, Y = 5000, Z = 0 }    -- in the bounding circle, outside the square
local c0 = carno.__props.Health
step(40)
check("in the bounding circle but outside the polygon: not stung", carno.__props.Health == c0)
rules({ enabled = false, zones = { SQUARE } })
carno.__props.Loc = { X = 5000, Y = 5000, Z = 0 }
step(60)
check("off: nothing happens", carno.__props.Health == c0)

say("\n-- 5. staying kills --")
rules(BASE)
step(6)
local afterDeath
for _ = 1, 40 do
  step(5)
  if afterDeath == nil and carno.__props.Health == 0 then afterDeath = #cc._messages end
end
check("health never below 0; a dino that stays dies", carno.__props.Health == 0, tostring(carno.__props.Health))
check("the corpse is not warned again", #cc._messages == afterDeath, last(cc))
H.calls = {}
for _ = 1, 30 do step(5) end
check("nor stung", #cc._messages == afterDeath and H.countCalls("SetHealth") == 0, last(cc))

check("never off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))
os.remove(RULES)
say(string.format("=== ZoneGuard: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
