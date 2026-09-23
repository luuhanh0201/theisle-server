-- Functional test: admin commands from the bridge via DinoGarage's inbox.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end

local H = require("harness")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local A, B = "76561198000000001", "76561198000000002"
local SAVED  = RUN .. "/ue4ss/Mods/DinoGarage/Saved/"
local EVENTS = RUN .. "/ue4ss/Mods/StatsLogger/Saved/events.ndjson"
os.remove(EVENTS)

local pawnA = H.makePawn({ growth = 0.8 })
local ctrlA = H.makeCtrl(A, pawnA, "Alpha")
local ctrlB = H.makeCtrl(B, nil, "Bravo")        -- in the spawn menu, no dino
local online = { ctrlA, ctrlB }
_G.FindAllOf = function() H.touch("FindAllOf"); return online end

dofile(RUN .. "/ue4ss/Mods/DinoGarage/Scripts/main.lua")
local json = require("shared.isle.json")

local function writeInbox(commands)
  local f = assert(io.open(SAVED .. "inbox.json", "w"))
  f:write(json.encode({ commands = commands }))
  f:close()
end

local function results()
  local out = {}
  local f = io.open(EVENTS, "r")
  if not f then return out end
  for line in f:lines() do
    local ok, e = pcall(json.decode, line)
    if ok and e.type == "admin_kill" then out[#out + 1] = e end
  end
  f:close()
  return out
end

local function ackId()
  local f = io.open(SAVED .. "inbox.ack.json", "r")
  if not f then return nil end
  local d = json.decode(f:read("*a"))
  f:close()
  return d.lastId
end

local poll
for _, l in ipairs(H.loops) do if l.ms == 2000 then poll = l end end
check("inbox loop registered at 2s", poll ~= nil)

local now = os.time()

say("")
say("-- 1. a kill runs on the game thread, not in the poll --")
writeInbox({ { id = 1, type = "kill", steamId = A, reason = "cheating",
               createdAt = now, expiresAt = now + 60 } })
H.calls = {}
poll.fn()
check("nothing killed inside the poll", H.countCalls("SetHealth") == 0)
check("ack written before acting", ackId() == 1, tostring(ackId()))
H.advance(0)
check("SetHealth(0) called once on the game thread", H.countCalls("SetHealth") == 1
      and H.calls[1].args[1] == 0, table.concat(H.callNames(), ","))
check("no file I/O on the game thread: result not written yet", #results() == 0)
poll.fn()                     -- the next poll writes the outcome
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
say("-- 4. the player leaving between poll and game thread is handled --")
writeInbox({ { id = 6, type = "kill", steamId = A, createdAt = now, expiresAt = now + 60 } })
H.calls = {}
poll.fn()
online = { ctrlB }            -- A disconnects before the game thread runs
H.advance(0)
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
H.async(Inbox2.poll); H.advance(0)
check("fresh module reads the ack and runs nothing", H.countCalls("SetHealth") == 0)

say("")
say("")
say("-- threads: nothing the mod ran from an async callback touched the engine --")
check("no engine access off the game thread", H.offThreadAccess == 0,
      table.concat(H.offThreadWhat, ", "))

say(string.format("=== Inbox: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
