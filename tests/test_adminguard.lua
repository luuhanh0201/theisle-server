-- AdminGuard: an admin switched off in game (shared/isle-admins.json "off") has
-- the game's admin flags that read true cleared on their controller and player
-- state; others are left alone; switched on again, the flags it cleared come
-- back; nothing when nobody is off; all on the game thread.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local FILE = "Mods/shared/isle-admins.json"
local function list(t) local f = assert(io.open(FILE, "w")); f:write(json.encode(t)); f:close() end
os.remove(FILE)
local clock = 1000
os.time = function() return clock end

local OFF, ON = "76561190000000001", "76561190000000002"
local offCtrl = H.makeCtrl(OFF, H.makePawn({}), "T-Rex")
local onCtrl = H.makeCtrl(ON, H.makePawn({}), "Dã Tượng")
-- The game's flags: on the controller (bIsAdmin) and the player state (bSafeIsAdmin); bIsAdminCred false.
for _, c in ipairs({ offCtrl, onCtrl }) do
  rawset(c, "bIsAdmin", true)
  c.PlayerState.bSafeIsAdmin = true
  c.PlayerState.bIsAdminCred = false
end
_G.FindAllOf = function(cls) if cls == "PlayerController" then return { offCtrl, onCtrl } end; return {} end

dofile(RUN .. "/Mods/AdminGuard/Scripts/main.lua")
local tick
for _, l in ipairs(H.gameLoops) do if l.ms == 2000 then tick = l end end
check("one game-thread loop", tick ~= nil)
local function step(s) clock = clock + s; tick.fn() end

say("\n-- 1. nobody off: nothing touched --")
step(6)
check("no file: flags as they were", rawget(offCtrl, "bIsAdmin") == true and offCtrl.PlayerState.bSafeIsAdmin == true)

say("\n-- 2. switched off: the flags that read true are cleared, the others left --")
list({ off = { OFF }, on = { ON } })
step(6)
check("controller bIsAdmin cleared", rawget(offCtrl, "bIsAdmin") == false)
check("player state bSafeIsAdmin cleared", offCtrl.PlayerState.bSafeIsAdmin == false)
check("a false flag stays false", offCtrl.PlayerState.bIsAdminCred == false)
check("another admin untouched", rawget(onCtrl, "bIsAdmin") == true and onCtrl.PlayerState.bSafeIsAdmin == true)
rawset(offCtrl, "bIsAdmin", true)              -- the game sets it again
step(2)
check("set again by the game: cleared again", rawget(offCtrl, "bIsAdmin") == false)

say("\n-- 3. switched on again: what it cleared comes back --")
list({ off = {}, on = { OFF, ON } })
step(6)
check("controller bIsAdmin back", rawget(offCtrl, "bIsAdmin") == true)
check("player state bSafeIsAdmin back", offCtrl.PlayerState.bSafeIsAdmin == true)
check("the one it never cleared stays false", offCtrl.PlayerState.bIsAdminCred == false)

say("\n-- 4. a torn file keeps the last list --")
local f = assert(io.open(FILE, "w")); f:write('{"off":["7656'); f:close()
step(6)
check("still on", rawget(offCtrl, "bIsAdmin") == true)

say("\n-- threads --")
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ", "))
os.remove(FILE)

say(string.format("=== AdminGuard: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
