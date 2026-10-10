-- DinoGarage speciescap: a player the bridge lists past the common slots of a
-- full species is told once, and at killAt the same dino (still alive, same
-- species, same pawn) is removed; another dino since is left alone; the garage
-- refuses them a redeem while listed; all on the game thread.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local FILE = "Mods/DinoGarage/Saved/species-cap.json"
local function over(list) local f = assert(io.open(FILE, "w")); f:write(json.encode({ over = list })); f:close() end
local clock = 1000
os.time = function() return clock end

local A, B, C = "76561190000004401", "76561190000004402", "76561190000004403"
local rexA = H.makePawn({ class = "BP_Tyrannosaurus_C", growth = 0.25 })
local rexB = H.makePawn({ class = "BP_Tyrannosaurus_C", growth = 0.25 })
local allo = H.makePawn({ class = "BP_Allosaurus_C", growth = 0.25 })
local ca, cb, cc = H.makeCtrl(A, rexA), H.makeCtrl(B, rexB), H.makeCtrl(C, allo)
_G.FindAllOf = function(c) if c == "PlayerController" then return { ca, cb, cc } end; return {} end

local Cap = require("garage.speciescap")
-- As DinoGarage runs it: a game-thread loop (H.every).
local Helpers = require("shared.isle.helpers")
Helpers.every(Cap.TICK_MS, "species limit", Cap.guard)
local loop = H.gameLoops[#H.gameLoops]
local function tick() loop.fn() end
local function last(ctrl) local m = ctrl._messages; return m[#m] or "" end
local function step(s) clock = clock + s; tick() end

say("\n-- 1. nobody listed --")
tick()
check("no file: nothing done, nothing blocked", #ca._messages == 0 and not Cap.blocked(A))

say("\n-- 2. listed: told, then removed --")
over({ { id = 1, steamId = A, species = "Tyrannosaurus", killAt = clock + 30 },
       { id = 2, steamId = C, species = "Tyrannosaurus", killAt = clock + 30 } })
step(3)
check("told once, with the species and the seconds left",
  last(ca):find("Tyrannosaurus", 1, true) and last(ca):find("27 giây", 1, true), last(ca))
check("the garage refuses them a redeem", Cap.blocked(A))
check("not one who is not listed", not Cap.blocked(B))
local told = #ca._messages
step(5)
check("told only once", #ca._messages == told)
check("alive before killAt", rexA.__props.Health == 100)
check("a listed player now playing another species: left alone", allo.__props.Health == 100 and #cc._messages == 0)
step(25)
check("at killAt: health 0", rexA.__props.Health == 0, tostring(rexA.__props.Health))
check("…and told it was removed", last(ca):find("đã được xoá", 1, true), last(ca))
check("done: no longer blocked", not Cap.blocked(A))
step(5)
check("removed once", #ca._messages == told + 1)

say("\n-- 3. another dino since: not this one --")
local rexB2 = H.makePawn({ class = "BP_Tyrannosaurus_C", growth = 0.25 })
over({ { id = 3, steamId = B, species = "Tyrannosaurus", killAt = clock + 30 } })
step(3)
check("B told", last(cb):find("Tyrannosaurus", 1, true), last(cb))
cb.__setPawn(rexB2)   -- stored the young one, or died and came back
step(40)
check("the new dino is not removed", rexB2.__props.Health == 100)
check("nor the old one", rexB.__props.Health == 100)
check("and no longer blocked", not Cap.blocked(B))

say("\n-- 4. a torn file keeps the last list --")
over({ { id = 4, steamId = B, species = "Tyrannosaurus", killAt = clock + 30 } })
step(3)
local f = assert(io.open(FILE, "w")); f:write("{\"over\": [ {"); f:close()
step(3)
check("still blocked after a torn write", Cap.blocked(B))

check("never off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))
os.remove(FILE)
say(string.format("=== SpeciesCap: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
