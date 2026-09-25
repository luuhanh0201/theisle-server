-- Functional test: commands from the bridge via DinoGarage's inbox — the
-- admin kill, and the player's own store / redeem from the web garage.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end

local H = require("harness")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local A, B = "76561198000000001", "76561198000000002"
local SAVED  = RUN .. "/Mods/DinoGarage/Saved/"
local EVENTS = RUN .. "/Mods/StatsLogger/Saved/events.ndjson"
os.remove(EVENTS)

local pawnA = H.makePawn({ growth = 0.8 })
local ctrlA = H.makeCtrl(A, pawnA, "Alpha")
local ctrlB = H.makeCtrl(B, nil, "Bravo")        -- in the spawn menu, no dino
local online = { ctrlA, ctrlB }
_G.FindAllOf = function() H.touch("FindAllOf"); return online end

dofile(RUN .. "/Mods/DinoGarage/Scripts/main.lua")
local json = require("shared.isle.json")

local function writeInbox(commands)
  local f = assert(io.open(SAVED .. "inbox.json", "w"))
  f:write(json.encode({ commands = commands }))
  f:close()
end

local function eventsOf(kind)
  local out = {}
  local f = io.open(EVENTS, "r")
  if not f then return out end
  for line in f:lines() do
    local ok, e = pcall(json.decode, line)
    if ok and e.type == kind then out[#out + 1] = e end
  end
  f:close()
  return out
end
local function results() return eventsOf("admin_kill") end

local function ackId()
  local f = io.open(SAVED .. "inbox.ack.json", "r")
  if not f then return nil end
  local d = json.decode(f:read("*a"))
  f:close()
  return d.lastId
end

local poll
for _, l in ipairs(H.gameLoops) do if l.ms == 2000 then poll = l end end
check("inbox poll is a game-thread loop, every 2 s", poll ~= nil)

local now = os.time()

say("")
say("-- 1. a kill runs in the poll, on the game thread; its outcome is written at once --")
writeInbox({ { id = 1, type = "kill", steamId = A, reason = "cheating",
               createdAt = now, expiresAt = now + 60 } })
H.calls = {}
poll.fn()
check("ack written before acting", ackId() == 1, tostring(ackId()))
check("SetHealth(0) called once on the game thread", H.countCalls("SetHealth") == 1
      and H.calls[1].args[1] == 0, table.concat(H.callNames(), ","))
local r = results()[1]
check("result event ok with species/growth/reason",
      r and r.ok == true and r.id == 1 and r.growth == 0.8 and r.reason == "cheating"
      and r.species ~= nil, r and json.encode(r))
check("player told why", ctrlA._messages[#ctrlA._messages]:find("cheating") ~= nil,
      tostring(ctrlA._messages[#ctrlA._messages]))

say("")
say("-- 2. the same command is never run twice --")
H.calls = {}
poll.fn(); H.advance(0)
poll.fn(); H.advance(0)
check("no second kill", H.countCalls("SetHealth") == 0)
check("still one result", #results() == 1, tostring(#results()))

say("")
say("-- 3. offline, no-dino and expired commands are refused with a reason --")
writeInbox({
  { id = 2, type = "kill", steamId = "76561198000000099", createdAt = now, expiresAt = now + 60 },
  { id = 3, type = "kill", steamId = B, createdAt = now, expiresAt = now + 60 },
  { id = 4, type = "kill", steamId = A, createdAt = now - 120, expiresAt = now - 60 },
  { id = 5, type = "teleport", steamId = A, createdAt = now, expiresAt = now + 60 },
})
H.calls = {}
poll.fn(); H.advance(0); poll.fn()
local rs = results()
local byId = {}
for _, e in ipairs(rs) do byId[e.id] = e end
check("offline", byId[2] and byId[2].ok == false and byId[2].error == "offline")
check("no dino", byId[3] and byId[3].ok == false and byId[3].error == "no_dino")
check("expired", byId[4] and byId[4].ok == false and byId[4].error == "expired")
check("unknown type refused", byId[5] and byId[5].ok == false and byId[5].error == "unknown_command")
check("none of them killed anything", H.countCalls("SetHealth") == 0,
      table.concat(H.callNames(), ","))
check("ack advanced to 5", ackId() == 5, tostring(ackId()))

say("")
say("-- 4. a player who left is reported offline --")
writeInbox({ { id = 6, type = "kill", steamId = A, createdAt = now, expiresAt = now + 60 } })
H.calls = {}
online = { ctrlB }            -- A disconnected before the poll
poll.fn()
local last = results()[#results()]
check("no kill on a player who left", H.countCalls("SetHealth") == 0)
check("reported as offline", last and last.id == 6 and last.ok == false and last.error == "offline",
      last and json.encode(last))

say("")
say("-- 5. a restart does not replay handled commands --")
package.loaded["garage.inbox"] = nil
local Inbox2 = require("garage.inbox")
online = { ctrlA }
H.calls = {}
H.game(Inbox2.poll); H.advance(0)
check("fresh module reads the ack and runs nothing", H.countCalls("SetHealth") == 0)

say("")
say("-- 6. the web garage: store / redeem run the chat commands' own checks --")
-- (the reloaded module above has no handlers: go back to the one main.lua wired)
package.loaded["garage.inbox"] = nil
_G.FindAllOf = function() H.touch("FindAllOf"); return online end
local realTime = os.time
local skew = 0
os.time = function(t) if t then return realTime(t) end return realTime() + skew end
local function cmds(list) for _, c in ipairs(list) do c.createdAt = os.time(); c.expiresAt = os.time() + 600 end; writeInbox(list) end
local function portal() return eventsOf("portal_command") end
local function portalById(id) for _, e in ipairs(portal()) do if e.id == id then return e end end end

local pawnW = H.makePawn({ growth = 0.6 })
local ctrlW = H.makeCtrl(A, pawnW, "Alpha")
online = { ctrlW }
H.calls = {}
cmds({ { id = 7, type = "store", steamId = A } })
poll.fn()
local st = portalById(7)
check("store accepted: the countdown started", st and st.ok == true and st.action == "store",
      st and json.encode(st))
check("the reply the player also gets in chat comes back to the web",
      st and st.messages and st.messages[1] and st.messages[1]:find("Bắt đầu cất sau 30 giây", 1, true) ~= nil,
      st and st.messages and st.messages[1])
check("nothing stored or killed during the countdown", H.countCalls("SetHealth") == 0)
H.advance(30000)
check("after the countdown: stored and removed", H.countCalls("SetHealth") == 1 and #eventsOf("garage_store") == 1,
      table.concat(H.callNames(), ","))

cmds({ { id = 8, type = "store", steamId = A } })
poll.fn()
local cd = portalById(8)
check("the garage cooldown applies to the web too", cd and cd.ok == false
      and (cd.messages[1] or ""):find("hồi", 1, true) ~= nil, cd and json.encode(cd))

skew = 61                                    -- past the 60 s cooldown
local pawnR = H.makePawn({ growth = 0.05 })  -- respawned, same species
local ctrlR = H.makeCtrl(A, pawnR, "Alpha")
online = { ctrlR }
cmds({ { id = 9, type = "redeem", steamId = A, slot = "1", where = "here" } })
poll.fn()
local rd = portalById(9)
check("redeem accepted: the slot is taken out, restore scheduled", rd and rd.ok == true
      and (rd.messages[#rd.messages] or ""):find("Restoring '1'", 1, true) ~= nil, rd and json.encode(rd))
H.advance(10000)
local red = eventsOf("garage_redeem")[1]
check("restored", red and red.ok == true and red.slot == "1", red and json.encode(red))

cmds({ { id = 10, type = "redeem", steamId = A, slot = "1" } })
skew = 200
poll.fn()
local again = portalById(10)
check("a slot is used once", again and again.ok == false, again and json.encode(again))

cmds({ { id = 11, type = "store", steamId = B, slot = "x" },
       { id = 12, type = "store", steamId = A, slot = "../etc" },
       { id = 13, type = "redeem", steamId = A, slot = "a", where = "moon" } })
online = { ctrlR }
poll.fn()
check("offline player refused", (portalById(11) or {}).error == "offline")
check("bad slot name refused before anything runs", (portalById(12) or {}).error == "bad_arguments")
check("unknown 'where' refused", (portalById(13) or {}).error == "bad_arguments")
os.time = realTime

say("")
say("")
say("-- threads: nothing the mod ran from an async callback touched the engine --")
check("no engine access off the game thread", H.offThreadAccess == 0,
      table.concat(H.offThreadWhat, ", "))

say(string.format("=== Inbox: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
