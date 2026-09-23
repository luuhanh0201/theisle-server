-- Functional test: IsleProbe reports what it finds and changes nothing.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end

local H = require("harness")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local A, B = "76561198000001234", "76561198000005678"
local pawnA = H.makePawn({ growth = 0.7, mutation = "Reniculate Kidneys" })
local pawnB = H.makePawn({ class = "BlueprintGeneratedClass /Game/BP_Rex.BP_Rex_C" })
local ctrlA, ctrlB = H.makeCtrl(A, pawnA, "Alpha"), H.makeCtrl(B, pawnB, "Bravo")
H.attachController(pawnA, ctrlA)
H.attachController(pawnB, ctrlB)
local online = { ctrlA }
_G.FindAllOf = function() H.touch("FindAllOf"); return online end

dofile(RUN .. "/ue4ss/Mods/IsleProbe/Scripts/main.lua")

local function logText() return table.concat(H.log, "") end
local function has(s) return logText():find(s, 1, true) ~= nil end
local function summaryLine(key)
  for _, l in ipairs(H.log) do
    if l:find("[isle-probe]", 1, true) and l:find(key, 1, true) and (l:find("OK  ", 1, true) or l:find("FAIL", 1, true) or l:find("WAIT", 1, true)) then
      return l
    end
  end
  return nil
end

say("")
say("-- 1. environment is reported at load, before any player --")
check("globals listed", has("global ExecuteInGameThread") and has("global LoopAsync"))
check("relative path check ran", has("relative path ue4ss/Mods/IsleProbe/Scripts/main.lua readable: true"))
check("both hooks registered", has("hook /Script/TheIsle.TICharacterBase:ApplyDamage: registered")
      and has("hook /Script/TheIsle.TIPlayerController:GetChatMessage: registered"))

say("")
say("-- 2. hook samples: shapes logged, chat text never --")
H.fire("/Script/TheIsle.TICharacterBase:ApplyDamage", H.param(pawnA), H.param(pawnB), H.param(42))
H.fire("/Script/TheIsle.TIPlayerController:GetChatMessage", H.param(ctrlA), H.param("my secret base is at the lake"))
check("damage fire described", has("ApplyDamage #1 fired with 3 params"))
check("chat fire described", has("GetChatMessage #1 fired with 2 params"))
check("chat text redacted", not has("secret base") and has("redacted"))

say("")
say("-- 3. the pawn probe runs on the game thread and prints a summary --")
local loop
for _, l in ipairs(H.loops) do if l.ms == 5000 then loop = l end end
check("probe loop registered", loop ~= nil)
H.calls = {}
loop.fn()
check("nothing read by the async tick itself", not has("=== pawn"))
H.advance(0)
-- (the harness's GetFName returns the full path; the real one is short)
check("pawn probed", has("=== pawn 1:"))
check("SteamID masked", has("…1234") and not has(A), "full SteamID must not appear")
check("player name only as a length", has("ok (5 chars)") and not has("Alpha"))
check("summary printed", has("PROBE SUMMARY") and has("END SUMMARY"))
check("health found", (summaryLine("field health") or ""):find("OK  ", 1, true) ~= nil, summaryLine("field health"))
check("classPath reported", (summaryLine("classPath") or ""):find("BP_Dilo.BP_Dilo_C", 1, true) ~= nil,
      summaryLine("classPath"))
check("mutation value logged as the game has it", has('"Reniculate Kidneys"'))
check("hook param order confirmed", (summaryLine("ApplyDamage param order") or ""):find("OK  ", 1, true) ~= nil,
      summaryLine("ApplyDamage param order"))
-- The fake pawn has no MutationsRequirementsData: a miss must be reported,
-- not crash the probe or vanish.
check("a missing struct is reported, not fatal", has("UnlockRequiredMutations: unreadable")
      and has("PROBE SUMMARY"))
-- The fake mutation struct only has 3 of the 16 fields: that must be a FAIL
-- with the real count, never "16 readable".
check("partial mutation fields reported as FAIL with the count",
      (summaryLine(" mutations ") or ""):find("FAIL", 1, true) ~= nil
      and (summaryLine(" mutations ") or ""):find("3/16", 1, true) ~= nil, summaryLine(" mutations "))

say("")
say("-- 4. same species again is not re-probed; a new one is --")
local before = #H.log
loop.fn(); H.advance(0)
check("no second dump for the same species", not table.concat(H.log, "", before + 1):find("=== pawn", 1, true))
online = { ctrlA, ctrlB }
loop.fn(); H.advance(0)
check("second species probed", has("=== pawn 2:") and has("BP_Rex.BP_Rex_C"))

say("")
say("-- 5. strictly read-only --")
check("no setter was called", #H.calls == 0, table.concat(H.callNames(), ","))
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ", "))

say("")
say("-- 6. without ExecuteInGameThread it refuses to read pawns at all --")
_G.ExecuteInGameThread = nil
H.log, H.loops = {}, {}
dofile(RUN .. "/ue4ss/Mods/IsleProbe/Scripts/main.lua")
local loop2
for _, l in ipairs(H.loops) do if l.ms == 5000 then loop2 = l end end
loop2.fn()
check("pawn probe skipped", has("pawn probe skipped"))
check("summary says so", (summaryLine("ExecuteInGameThread") or ""):find("FAIL", 1, true) ~= nil,
      summaryLine("ExecuteInGameThread"))
check("still no off-thread access", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ", "))
check("unfired hooks show as WAIT, not OK", (summaryLine("ApplyDamage param order") or ""):find("WAIT", 1, true) ~= nil,
      summaryLine("ApplyDamage param order"))

say("")
say(string.format("=== IsleProbe: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
