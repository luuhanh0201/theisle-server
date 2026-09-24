-- Functional test: PlayerCommands — !slay, !unstuck, !prime, !status, the
-- panel's cooldown / on-off settings, and the ground-spot tracker.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end

local H = require("harness")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

-- A clock the test drives: cooldowns and spot ages use os.time().
local clock = 1000000
os.time = function() return clock end

local CHAT = "/Script/TheIsle.TIPlayerController:GetChatMessage"
local STEAM = "76561198000000001"
local SETTINGS = "Mods/PlayerCommands/Saved/settings.json"
os.remove(SETTINGS)

local pawn = H.makePawn({ gasVitals = true, health = 80, growth = 0.5, loc = { X = 0, Y = 0, Z = 0 },
  class = "BlueprintGeneratedClass /Game/BP_Carnotaurus.BP_Carnotaurus_C" })
local ctrl = H.makeCtrl(STEAM, pawn, "Alpha")
H.attachController(pawn, ctrl)
_G.FindAllOf = function() H.touch("FindAllOf"); return { ctrl } end

dofile(RUN .. "/Mods/PlayerCommands/Scripts/main.lua")

local loop
for _, l in ipairs(H.loops) do if l.ms == 3000 then loop = l end end
local function tick(seconds)            -- one tracker sample, `seconds` later
  clock = clock + seconds
  loop.fn(); H.advance(0)
end
local n = 0
local function cmd(text)                -- a fresh string each time (the chat hook dedups)
  n = n + 1
  clock = clock + 1
  H.chat(CHAT, ctrl, ctrl, text .. string.rep(" ", n))
  H.advance(10)
end
local function lastMsg() local m = ctrl._messages; return m[#m] or "" end
local function moveTo(x, y, z) pawn.__props.Loc = { X = x, Y = y, Z = z } end

say("")
say("-- 1. loads and samples ground spots on the game thread --")
check("tracker loop registered", loop ~= nil)
local off = H.offThreadAccess
tick(3)
check("the async tick itself read nothing", H.offThreadAccess == off, table.concat(H.offThreadWhat, ","))

say("")
say("-- 2. !status: growth and vitals with their maxima --")
cmd("!status")
check("species, growth %, vitals", lastMsg():find("Carnotaurus", 1, true) and lastMsg():find("growth 50%%")
      and lastMsg():find("Máu 80/100", 1, true), lastMsg())

say("")
say("-- 3. !prime reads the game's own getters --")
cmd("!prime")
check("not prime / not eligible", lastMsg():find("Prime elder: không", 1, true)
      and lastMsg():find("Đủ điều kiện lên prime: không", 1, true), lastMsg())

say("")
say("-- 4. !unstuck: only to a recorded GROUND spot, old enough and far enough --")
moveTo(0, 0, 0); tick(3)                 -- walking on the ground here
moveTo(1000, 0, 0); tick(3)              -- and here, 10 m further
pawn.__props.Grounded = false; pawn.__props.Falling = true
moveTo(1000, 0, 9000); tick(3)           -- falling off a cliff: never recorded
moveTo(1010, 0, 0)
pawn.__props.Grounded = true; pawn.__props.Falling = false
clock = clock + 10
H.calls = {}
cmd("!unstuck")
local tp
for _, c in ipairs(H.calls) do if c.what == "K2_SetActorLocation" then tp = c end end
check("teleported", tp ~= nil, lastMsg())
check("to the ground spot 10 m back, not the one it stands on, not mid-air",
      tp and tp.args[1].X == 0 and tp.args[1].Z == 50, tp and (tp.args[1].X .. "," .. tp.args[1].Z) or "-")
check("as a teleport", tp and tp.args[2] == false and tp.args[4] == true)
cmd("!unstuck")
check("cooldown (default 10 min) enforced", lastMsg():find("chờ thêm", 1, true) ~= nil, lastMsg())

say("")
say("-- 5. !unstuck with no usable spot says so and does not move --")
local fresh = H.makePawn({ gasVitals = true })
local fctrl = H.makeCtrl("76561198000000002", fresh, "Bravo")
_G.FindAllOf = function() H.touch("FindAllOf"); return { fctrl } end
H.calls = {}
clock = clock + 1
H.chat(CHAT, fctrl, fctrl, "!unstuck")
H.advance(10)
local fm = fctrl._messages
check("refused with a reason", (fm[#fm] or ""):find("chưa có điểm an toàn", 1, true) ~= nil, fm[#fm])
check("no teleport", H.countCalls("K2_SetActorLocation") == 0)
_G.FindAllOf = function() H.touch("FindAllOf"); return { ctrl } end

say("")
say("-- 6. !slay kills, then respects the cooldown from the panel --")
local f = assert(io.open(SETTINGS, "w"))
f:write('{"slayCooldown":60,"unstuckCooldown":600,"enabled":{"status":false}}'); f:close()
H.calls = {}
cmd("!slay")
check("SetHealth(0)", H.countCalls("SetHealth") == 1 and H.calls[#H.calls].args[1] == 0)
cmd("!slay")
check("second !slay within 60 s refused", H.countCalls("SetHealth") == 1 and lastMsg():find("chờ thêm", 1, true) ~= nil, lastMsg())
clock = clock + 61
cmd("!slay")
check("allowed again after the cooldown", H.countCalls("SetHealth") == 2)

say("")
say("-- 7. a command switched off in the panel --")
cmd("!status")
check("status off: told, not answered", lastMsg():find("đang bị tắt", 1, true) ~= nil, lastMsg())

say("")
say("-- 8. other chat is ignored --")
local before = #ctrl._messages
cmd("hello")
cmd("!redeem default")
check("no reply to non-commands or other mods' commands", #ctrl._messages == before)

say("")
say("-- threads --")
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ", "))

say(string.format("=== PlayerCommands: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
