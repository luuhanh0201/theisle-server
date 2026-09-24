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

-- A game session / game state with a few config properties, as reflection has them.
local function fakeProp(name, ptype)
  return { GetFName = function() return _G.FName(name) end,
           GetClass = function() return { GetFName = function() return _G.FName(ptype) end } end }
end
local sessionValues = { ServerName = _G.FName("Test Server"), bSpawnAI = true, AIDensity = 1.5,
                        RconPassword = _G.FName("hunter2") }
local session = setmetatable({ IsValid = function() return true end },
  { __index = function(_, k) H.touch("session." .. k); return sessionValues[k] end })
local function fakeArray(items)
  return { GetArrayNum = function() return #items end,
           ForEach = function(_, fn) for i, v in ipairs(items) do fn(i, { get = function() return v end }) end end }
end
local stateValues = { WhitelistIDs = fakeArray({ "76561198000000001", "76561198000000002" }),
                      AllowedClasses = fakeArray({ _G.FName("Troodon"), _G.FName("Carnotaurus") }) }
local state = setmetatable({ IsValid = function() return true end },
  { __index = function(_, k) return stateValues[k] end })
local classes = {
  ["/Script/TheIsle.TIGameSession"] = { "ServerName:StrProperty", "bSpawnAI:BoolProperty",
                                        "AIDensity:FloatProperty", "RconPassword:StrProperty" },
  ["/Script/TheIsle.TIGameStateBase"] = { "WhitelistIDs:ArrayProperty", "AllowedClasses:ArrayProperty" },
}
_G.StaticFindObject = function(path)
  local props = classes[path]
  if not props then return nil end
  return { IsValid = function() return true end,
           ForEachProperty = function(_, fn)
             for _, p in ipairs(props) do
               local n, t = p:match("^(.-):(.*)$"); fn(fakeProp(n, t))
             end
           end }
end
_G.FindFirstOf = function(short)
  H.touch("FindFirstOf")
  if short == "TIGameSession" then return session end
  if short == "TIGameStateBase" then return state end
end

dofile(RUN .. "/Mods/IsleProbe/Scripts/main.lua")

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
check("relative path check ran", has("relative path Mods/IsleProbe/Scripts/main.lua readable: true"))
check("both hooks registered", has("hook /Script/TheIsle.TICharacterBase:ApplyDamage: registered")
      and has("hook /Script/TheIsle.TIPlayerController:GetChatMessage: registered"))

say("")
say("-- 2. hook samples: shapes logged, chat text never --")
H.fire("/Script/TheIsle.TICharacterBase:ApplyDamage", H.param(pawnA), H.param(pawnB), H.param(42))
H.chat("/Script/TheIsle.TIPlayerController:GetChatMessage", ctrlA, ctrlA, "my secret base is at the lake")
check("damage fire described", has("ApplyDamage #1 fired with 3 params"))
check("chat fire described", has("GetChatMessage #1 fired with 5 params"))
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
say("-- 3b. the game config is dumped once, with types and live values --")
check("session property with its value", has("config TIGameSession.ServerName : StrProperty = \"Test Server\""))
check("bool and float values", has("config TIGameSession.bSpawnAI : BoolProperty = true")
      and has("config TIGameSession.AIDensity : FloatProperty = 1.5"))
check("passwords masked", has("RconPassword : StrProperty = <masked>") and not has("hunter2"))
check("SteamID arrays as a count only", has("config TIGameStateBase.WhitelistIDs : ArrayProperty = array[2]")
      and not has("76561198000000001"))
check("name arrays list their elements", has('AllowedClasses : ArrayProperty = array[2] "Troodon", "Carnotaurus"'))
check("counted per class", has("config TIGameSession: 4 properties") and has("config TIGameStateBase: 2 properties"))

say("")
say("-- 4. same species again is not re-probed; a new one is --")
local before = #H.log
loop.fn(); H.advance(0)
check("no second dump for the same species", not table.concat(H.log, "", before + 1):find("=== pawn", 1, true))
check("config dumped only once", not table.concat(H.log, "", before + 1):find("config TIGameSession", 1, true))
online = { ctrlA, ctrlB }
loop.fn(); H.advance(0)
check("second species probed", has("=== pawn 2:") and has("BP_Rex.BP_Rex_C"))

say("")
say("-- 4b. world census: once after boot, pawns again once players are on --")
local realTime = os.time
local skew = 0
os.time = function(t) if t then return realTime(t) end return realTime() + skew end
before = #H.log
loop.fn(); H.advance(0)
check("no census before 2 min", not table.concat(H.log, "", before + 1):find("CENSUS", 1, true))
skew = 200
loop.fn(); H.advance(0)
check("actor census after boot", has("WORLD CENSUS: 2 actors") and has("END WORLD CENSUS"))
check("pawn census at boot, by controller", has("PAWN CENSUS (boot)"))
check("census counted in the summary", has("world census"))
before = #H.log
loop.fn(); H.advance(0)
check("boot census runs once", not table.concat(H.log, "", before + 1):find("WORLD CENSUS", 1, true))
skew = 200 + 181
loop.fn(); H.advance(0)
check("pawn census again with players online", has("PAWN CENSUS (players online)"))

-- A census that crashed the server must not run again after the restart.
local loops0 = #H.loops
dofile(RUN .. "/Mods/IsleProbe/Scripts/main.lua")
local again
for i = loops0 + 1, #H.loops do if H.loops[i].ms == 5000 then again = H.loops[i] end end
skew = 200 + 181 + 200
before = #H.log
again.fn(); H.advance(0)
local after = table.concat(H.log, "", before + 1)
check("census runs once per deploy (marker file)", after:find("world census skipped", 1, true) ~= nil
      and not after:find("WORLD CENSUS:", 1, true))
os.remove("Mods/IsleProbe/census-started")
os.time = realTime

say("")
say("-- 5. strictly read-only --")
local writes = {}
for _, n in ipairs(H.callNames()) do
  -- Getters are recorded by the harness too; only writes break "read-only".
  if not n:match("^Get") then writes[#writes + 1] = n end
end
check("no setter was called", #writes == 0, table.concat(writes, ","))
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ", "))

say("")
say("-- 6. without ExecuteInGameThread it refuses to read pawns at all --")
_G.ExecuteInGameThread = nil
H.log, H.loops = {}, {}
dofile(RUN .. "/Mods/IsleProbe/Scripts/main.lua")
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
