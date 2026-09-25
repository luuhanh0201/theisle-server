-- shared/messages.lua: the texts players get, as the admin edited them on the
-- panel (Mods/shared/isle-messages.json), else the default in the mod's call.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")
local Msg = require("shared.isle.messages")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local clock = 1000
os.time = function() return clock end
local function writeTexts(t)
  local f = assert(io.open(Msg.PATH, "w")); f:write(json.encode({ texts = t })); f:close()
  clock = clock + 10; Msg.reset()
end
os.remove(Msg.PATH)
Msg.reset()

say("\n-- 1. defaults, vars --")
check("no file: the default, vars filled",
  Msg.text("garage.cooldown", "Gara đang hồi: chờ {seconds} giây.", { seconds = 42 }) == "Gara đang hồi: chờ 42 giây.")
check("an unknown {name} is left as written", Msg.text("k", "a {x} b", {}) == "a {x} b")
check("a var with % or $ is kept literally", Msg.text("k", "{v}", { v = "50% $1" }) == "50% $1")

say("\n-- 2. the admin's texts --")
writeTexts({ ["garage.cooldown"] = "Chờ {seconds}s nữa nhé", ["cmd.slay.done"] = "" })
check("an edited text wins", Msg.text("garage.cooldown", "default {seconds}", { seconds = 5 }) == "Chờ 5s nữa nhé")
check("empty = turned off", Msg.text("cmd.slay.done", "Dino của bạn đã chết.") == nil)
check("others keep their default", Msg.text("garage.full", "Gara đã đầy.") == "Gara đã đầy.")

say("\n-- 3. re-read every few seconds; a broken file keeps the last texts --")
local f = assert(io.open(Msg.PATH, "w")); f:write(json.encode({ texts = { ["garage.cooldown"] = "new" } })); f:close()
clock = clock + 1
check("not re-read within 5 s", Msg.text("garage.cooldown", "d") == "Chờ {seconds}s nữa nhé")
clock = clock + 5
check("re-read after", Msg.text("garage.cooldown", "d") == "new")
f = assert(io.open(Msg.PATH, "w")); f:write("{ torn"); f:close()
clock = clock + 6
check("broken file: the last good texts", Msg.text("garage.cooldown", "d") == "new")

say("\n-- 4. a mod sends the edited text; a turned-off one is not sent --")
local STEAM = "76561198000000001"
local pawn = H.makePawn({ health = 80, loc = { X = 0, Y = 0, Z = 0 } })
local ctrl = H.makeCtrl(STEAM, pawn, "Alpha")
H.attachController(pawn, ctrl)
_G.FindAllOf = function() return { ctrl } end
writeTexts({ ["cmd.slay.done"] = "RIP {nope}", ["cmd.prime.info"] = "" })
dofile(RUN .. "/Mods/PlayerCommands/Scripts/main.lua")
local CHAT = "/Script/TheIsle.TIPlayerController:GetChatMessage"
H.chat(CHAT, ctrl, ctrl, "!slay")
H.advance(10)
local m = ctrl._messages
check("!slay: the admin's text", m[#m] == "RIP {nope}", tostring(m[#m]))
local before = #m
H.chat(CHAT, ctrl, ctrl, "!prime ")
H.advance(10)
check("!prime: its text turned off, nothing sent", #ctrl._messages == before, tostring(ctrl._messages[#ctrl._messages]))
os.remove(Msg.PATH)

say(string.format("=== Messages: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
