-- Functional test: the shared game-thread scheduling helpers (H.every, H.defer).
--
-- On the server's experimental UE4SS, queuing a fresh ExecuteInGameThread from
-- the async thread every second lost callbacks ("Ref was not function",
-- 2026-09-24) and a "still queued" flag then stopped StatsLogger's reads for
-- good. H.every prefers LoopInGameThreadWithDelay; its fallback must recover
-- from a lost callback on its own.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end

local H = require("harness")
local Helpers = require("shared.isle.helpers")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local realTime = os.time
local clock = realTime()
os.time = function(t) if t then return realTime(t) end return clock end

say("")
say("-- 1. H.every with LoopInGameThreadWithDelay: one game-thread loop, nothing queued per tick --")
local runs, onGT = 0, nil
Helpers.every(1000, "test loop", function() runs = runs + 1; onGT = H.onGameThread end)
check("registered as a game-thread loop", #H.gameLoops == 1 and H.gameLoops[1].ms == 1000)
check("no async loop", #H.loops == 0)
H.gameLoops[1].fn(); H.gameLoops[1].fn()
check("each tick runs fn, on the game thread", runs == 2 and onGT == true)

say("")
say("-- 2. an error in fn is contained; the loop keeps going --")
local calls = 0
Helpers.every(500, "throws", function() calls = calls + 1; error("boom") end)
local gl = H.gameLoops[#H.gameLoops]
local ok = pcall(gl.fn); local ok2 = pcall(gl.fn)
check("fn errors do not escape the tick", ok and ok2 and calls == 2)

say("")
say("-- 3. fallback (older UE4SS): LoopAsync + ExecuteInGameThread, recovers from a lost callback --")
local savedLoop = _G.LoopInGameThreadWithDelay
_G.LoopInGameThreadWithDelay = nil
local fbRuns = 0
Helpers.every(1000, "fallback", function() fbRuns = fbRuns + 1 end)
local loop = H.loops[#H.loops]
check("an async loop is registered", loop ~= nil and loop.ms == 1000)
loop.fn(); H.advance(0)
check("first tick queues fn onto the game thread, which runs it", fbRuns == 1)
loop.fn()
H.timers = {}                               -- UE4SS drops that callback
H.advance(0)
check("the lost callback never ran", fbRuns == 1)
clock = clock + 5
loop.fn(); H.advance(0)
check("still waiting within 15 s: nothing re-queued", fbRuns == 1)
clock = clock + 11
local logBefore = #H.log
loop.fn(); H.advance(0)
check("after 15 s the loop re-queues and runs again", fbRuns == 2)
check("...and says a callback was lost", table.concat(H.log, "\n", logBefore + 1):find("callback lost", 1, true) ~= nil)
loop.fn(); H.advance(0)
check("back to normal afterwards", fbRuns == 3)
_G.LoopInGameThreadWithDelay = savedLoop

say("")
say("-- 4. H.defer: ExecuteInGameThreadWithDelay when present, on the game thread, after the delay --")
local dRan, dGT = false, nil
Helpers.defer(3000, function() dRan = true; dGT = H.onGameThread end)
H.advance(2999)
check("not before the delay", dRan == false)
H.advance(1)
check("runs after the delay, on the game thread", dRan == true and dGT == true)
local savedDelay = _G.ExecuteInGameThreadWithDelay
_G.ExecuteInGameThreadWithDelay = nil
local oRan, oGT = false, nil
Helpers.defer(1000, function() oRan = true; oGT = H.onGameThread end)
H.advance(1000)
check("older builds: ExecuteWithDelay then the game thread", oRan == true and oGT == true)
_G.ExecuteInGameThreadWithDelay = savedDelay

os.time = realTime
say("")
say("")
say("-- 5. timing: loops and hooks, one [perf] line every PERF_REPORT_S --")
local realClock = os.clock
local now = realTime()
os.time = function() return now end
local fake = 0
os.clock = function() return fake end
local hook = Helpers.timed("test hook", function(x) fake = fake + 0.002; return x * 2 end)
Helpers.perfReport(now)                                      -- start a fresh window
H.log = {}
check("a timed hook passes its value through", hook(21) == 42)
local boom = Helpers.timed("bad hook", function() error("kaboom") end)
check("an error in a timed hook is caught, not raised", pcall(boom) == true)
check("…and logged", table.concat(H.log, " "):find("bad hook: .*kaboom") ~= nil)
hook(1); hook(1)
now = now + Helpers.PERF_REPORT_S
hook(1)
local line
for _, l in ipairs(H.log) do if l:find("[perf]", 1, true) then line = l end end
check("a [perf] line after the window", line ~= nil, table.concat(H.log, " | "))
check("with the total and the share of the window", line and line:find("8 ms on the game thread", 1, true) and line:find("0.00%", 1, true), line)
check("and each entry, count and max", line and line:find("test hook 8 ms (4x, max 2)", 1, true), line)
os.clock = realClock

say(string.format("=== Helpers: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
